import { SourceFile, Node } from 'ts-morph';
import { AgentAction } from '../types';
import * as fs from 'fs';
import * as path from 'path';
import { inferIntent, classifySafety, deriveAgentSafe, inferActionAuth } from './intent-classifier';

/** viem/wagmi chain variable names → EIP-155 chain IDs */
const KNOWN_CHAINS: Record<string, number> = {
  mainnet:      1,
  goerli:       5,
  sepolia:      11155111,
  optimism:     10,
  optimismGoerli: 420,
  optimismSepolia: 11155420,
  base:         8453,
  baseSepolia:  84532,
  arbitrum:     42161,
  arbitrumSepolia: 421614,
  polygon:      137,
  polygonMumbai: 80001,
  polygonAmoy:  80002,
  zora:         7777777,
  zoraSepolia:  999999999,
  avalanche:    43114,
  bsc:          56,
  gnosis:       100,
  celo:         42220,
  linea:        59144,
  scroll:       534352,
  mode:         34443,
  blast:        81457,
  mantle:       5000,
  fraxtal:      252,
};

export class ContractParser {
  constructor(private projectPath: string) {}

  async parseAbiFile(filePath: string): Promise<AgentAction[]> {
    try {
      const content = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      if (!Array.isArray(content)) return [];

      const actions: AgentAction[] = [];
      for (const item of content) {
        if (item.type !== 'function') continue;

        const isReadOnly = item.stateMutability === 'view' || item.stateMutability === 'pure';

        const safety = classifySafety({ name: item.name, isReadOnly, type: 'contract' });
        actions.push({
          name: item.name,
          description: isReadOnly
            ? `Read contract: ${item.name}`
            : `Write contract: ${item.name}`,
          intent: inferIntent(item.name),
          type: 'contract',
          location: `./${path.relative(this.projectPath, filePath)}`,
          abiFunction: item.name,
          isReadOnly,
          safety,
          agentSafe: deriveAgentSafe(safety, item.name),
          requiredAuth: inferActionAuth({ safety, isReadOnly, type: 'contract' }),
          parameters: { properties: this.mapAbiInputs(item.inputs ?? []) },
          returns: {
            type: this.mapAbiOutputs(item.outputs ?? []),
            description: '',
          },
        });
      }
      return actions;
    } catch {
      return [];
    }
  }

  /**
   * Detect wagmi contract interactions (useWriteContract, writeContract, etc.)
   * and cross-reference imported ABI files to extract real parameter types.
   */
  async detectHooks(sourceFile: SourceFile): Promise<AgentAction[]> {
    const actions: AgentAction[] = [];
    const abiMap = this.buildAbiImportMap(sourceFile);

    sourceFile.forEachDescendant(node => {
      if (!Node.isObjectLiteralExpression(node)) return;

      const props = node.getProperties();

      // Collect relevant property assignments by key name
      let abiVarName: string | null = null;
      let functionName: string | null = null;
      let chainId: number | undefined;
      let contractAddress: string | { $env: string } | undefined;

      for (const prop of props) {
        if (!Node.isPropertyAssignment(prop)) continue;
        const key = prop.getName();
        const init = prop.getInitializer();
        if (!init) continue;

        if (key === 'abi') {
          abiVarName = init.getText().trim();
        }

        if (key === 'functionName' && Node.isStringLiteral(init)) {
          functionName = init.getLiteralValue();
        }

        // Explicit numeric chainId: { chainId: 8453 }
        if (key === 'chainId' && Node.isNumericLiteral(init)) {
          chainId = Number(init.getLiteralValue());
        }

        // Chain object reference: { chain: base } → resolve known chain names
        if (key === 'chain') {
          chainId = KNOWN_CHAINS[init.getText().trim()] ?? chainId;
        }

        // Contract address: literal or env var reference
        if (key === 'address') {
          contractAddress = resolveAddressNode(init);
        }
      }

      if (!abiVarName || !functionName) return;

      // Cross-reference against imported ABI for real parameter types
      let parameters: Record<string, any> = {};
      const abi = abiMap.get(abiVarName);
      if (abi) {
        const abiFunc = abi.find(
          (item: any) => item.type === 'function' && item.name === functionName
        );
        if (abiFunc) {
          parameters = this.mapAbiInputs(abiFunc.inputs ?? []);
        }
      }

      const safety = classifySafety({ name: functionName, isReadOnly: false, type: 'contract' });
      actions.push({
        name: functionName,
        description: `Contract interaction: ${functionName}`,
        intent: inferIntent(functionName),
        type: 'contract',
        location: sourceFile.getFilePath(),
        abiFunction: functionName,
        ...(chainId !== undefined ? { chainId } : {}),
        ...(contractAddress !== undefined ? { contractAddress } : {}),
        safety,
        agentSafe: deriveAgentSafe(safety, functionName),
        requiredAuth: inferActionAuth({ safety, isReadOnly: false, type: 'contract' }),
        parameters: { properties: parameters },
        returns: { type: 'any' },
      });
    });

    return actions;
  }

  // ─── Private helpers ─────────────────────────────────────────────────────

  /**
   * Resolve relative imports that point to JSON ABI files.
   * Returns a map of imported identifier -> ABI array.
   * Also resolves TypeScript path aliases (e.g. @/abis/GameABI).
   */
  private buildAbiImportMap(sourceFile: SourceFile): Map<string, any[]> {
    const map = new Map<string, any[]>();
    const sourceDir = path.dirname(sourceFile.getFilePath());
    const aliasMap = this.loadTsAliases();

    for (const importDecl of sourceFile.getImportDeclarations()) {
      const spec = importDecl.getModuleSpecifierValue();

      // Resolve the specifier to a filesystem path
      let resolvedSpec: string | null = null;
      if (spec.startsWith('.')) {
        resolvedSpec = path.resolve(sourceDir, spec);
      } else {
        // Try TS path aliases
        const aliasResolved = this.resolveAlias(spec, aliasMap);
        if (aliasResolved) resolvedSpec = aliasResolved;
      }

      if (!resolvedSpec) continue;

      const candidates = [
        resolvedSpec,
        `${resolvedSpec}.json`,
      ];

      for (const candidate of candidates) {
        if (!fs.existsSync(candidate)) continue;
        try {
          const parsed = JSON.parse(fs.readFileSync(candidate, 'utf8'));
          if (!Array.isArray(parsed)) break;

          for (const namedImport of importDecl.getNamedImports()) {
            map.set(namedImport.getName(), parsed);
          }
          const defaultImport = importDecl.getDefaultImport();
          if (defaultImport) {
            map.set(defaultImport.getText(), parsed);
          }
          break;
        } catch { /* ignore */ }
      }
    }

    return map;
  }

  /**
   * Read tsconfig.json compilerOptions.paths and baseUrl.
   * Returns a map of alias prefix → array of filesystem root paths.
   * e.g. { "@/*": ["/project/src/*"] }
   */
  private loadTsAliases(): Map<string, string[]> {
    const aliases = new Map<string, string[]>();
    const tsconfigPath = path.join(this.projectPath, 'tsconfig.json');
    if (!fs.existsSync(tsconfigPath)) return aliases;

    try {
      // Strip JSON comments before parsing (tsconfig allows them)
      const raw = fs.readFileSync(tsconfigPath, 'utf8')
        .replace(/\/\/[^\n]*/g, '')
        .replace(/\/\*[\s\S]*?\*\//g, '');
      const tsconfig = JSON.parse(raw);
      const opts = tsconfig.compilerOptions ?? {};
      const baseUrl = opts.baseUrl
        ? path.resolve(this.projectPath, opts.baseUrl)
        : this.projectPath;

      for (const [alias, targets] of Object.entries(opts.paths ?? {})) {
        const resolved = (targets as string[]).map(t =>
          path.resolve(baseUrl, t)
        );
        aliases.set(alias, resolved);
      }
    } catch { /* ignore malformed tsconfig */ }

    return aliases;
  }

  /**
   * Resolve a module specifier against tsconfig path aliases.
   * e.g. "@/abis/GameABI" → "/project/src/abis/GameABI"
   */
  private resolveAlias(spec: string, aliases: Map<string, string[]>): string | null {
    for (const [pattern, targets] of aliases) {
      if (pattern.endsWith('/*')) {
        const prefix = pattern.slice(0, -2);   // "@/"
        if (!spec.startsWith(prefix)) continue;
        const rest = spec.slice(prefix.length); // "abis/GameABI"
        for (const target of targets) {
          const resolvedTarget = target.endsWith('/*')
            ? path.join(target.slice(0, -2), rest)
            : path.join(target, rest);
          if (fs.existsSync(resolvedTarget) || fs.existsSync(`${resolvedTarget}.json`)) {
            return resolvedTarget;
          }
        }
      } else if (spec === pattern) {
        // Exact match
        return targets[0] ?? null;
      }
    }
    return null;
  }

  private mapAbiInputs(inputs: any[]): Record<string, any> {
    const props: Record<string, any> = {};
    for (const input of inputs) {
      props[input.name || 'arg'] = {
        type: this.mapSolidityType(input.type),
        description: `Solidity type: ${input.type}`,
        required: true,
      };
    }
    return props;
  }

  private mapAbiOutputs(outputs: any[]): string {
    if (!outputs.length) return 'void';
    if (outputs.length === 1) return this.mapSolidityType(outputs[0].type);
    return 'object';
  }

  private mapSolidityType(type: string): string {
    if (type.startsWith('uint') || type.startsWith('int')) return 'number';
    if (type === 'bool') return 'boolean';
    if (type === 'address') return 'string';
    if (type.startsWith('bytes')) return 'string';
    if (type.endsWith('[]')) return 'array';
    return 'string';
  }
}

// ─── Module-level helpers ─────────────────────────────────────────────────────

/**
 * Resolve a wagmi `address` node to either:
 *   - a literal `0x...` string (safe — on-chain public data)
 *   - `{ $env: "VAR_NAME" }` when referencing process.env.* (never leak actual value)
 *   - undefined if not resolvable
 */
function resolveAddressNode(node: Node): string | { $env: string } | undefined {
  // Literal string: address: '0xABC...'
  if (Node.isStringLiteral(node)) {
    const val = node.getLiteralValue();
    if (/^0x[0-9a-fA-F]{40}$/i.test(val)) return val;
    return undefined;
  }

  // Type assertion: address: '0xABC...' as `0x${string}`
  if (Node.isAsExpression(node)) {
    return resolveAddressNode(node.getExpression());
  }

  // process.env.NEXT_PUBLIC_CONTRACT_ADDRESS → { $env: "NEXT_PUBLIC_CONTRACT_ADDRESS" }
  // Also handles: process.env.NEXT_PUBLIC_CONTRACT_ADDRESS as `0x${string}`
  const text = node.getText().trim();
  const envMatch = text.match(/process\.env\.([A-Z0-9_]+)/);
  if (envMatch) return { $env: envMatch[1] };

  return undefined;
}
