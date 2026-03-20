import { SourceFile, Node } from 'ts-morph';
import { AgentAction } from '../types';
import * as fs from 'fs';
import * as path from 'path';

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

        actions.push({
          name: item.name,
          description: isReadOnly
            ? `Read contract: ${item.name}`
            : `Write contract: ${item.name}`,
          type: 'contract',
          location: `./${path.relative(this.projectPath, filePath)}`,
          abiFunction: item.name,
          isReadOnly,
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

      actions.push({
        name: functionName,
        description: `Contract interaction: ${functionName}`,
        type: 'contract',
        location: sourceFile.getFilePath(),
        abiFunction: functionName,
        ...(chainId !== undefined ? { chainId } : {}),
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
   */
  private buildAbiImportMap(sourceFile: SourceFile): Map<string, any[]> {
    const map = new Map<string, any[]>();
    const sourceDir = path.dirname(sourceFile.getFilePath());

    for (const importDecl of sourceFile.getImportDeclarations()) {
      const spec = importDecl.getModuleSpecifierValue();
      if (!spec.startsWith('.')) continue;

      const candidates = [
        path.resolve(sourceDir, spec),
        path.resolve(sourceDir, `${spec}.json`),
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
