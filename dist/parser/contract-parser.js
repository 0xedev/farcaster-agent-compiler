"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.ContractParser = void 0;
const ts_morph_1 = require("ts-morph");
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const intent_classifier_1 = require("./intent-classifier");
/** viem/wagmi chain variable names → EIP-155 chain IDs */
const KNOWN_CHAINS = {
    mainnet: 1,
    goerli: 5,
    sepolia: 11155111,
    optimism: 10,
    optimismGoerli: 420,
    optimismSepolia: 11155420,
    base: 8453,
    baseSepolia: 84532,
    arbitrum: 42161,
    arbitrumSepolia: 421614,
    polygon: 137,
    polygonMumbai: 80001,
    polygonAmoy: 80002,
    zora: 7777777,
    zoraSepolia: 999999999,
    avalanche: 43114,
    bsc: 56,
    gnosis: 100,
    celo: 42220,
    linea: 59144,
    scroll: 534352,
    mode: 34443,
    blast: 81457,
    mantle: 5000,
    fraxtal: 252,
};
class ContractParser {
    projectPath;
    constructor(projectPath) {
        this.projectPath = projectPath;
    }
    async parseAbiFile(filePath) {
        try {
            const content = JSON.parse(fs.readFileSync(filePath, 'utf8'));
            if (!Array.isArray(content))
                return [];
            const actions = [];
            for (const item of content) {
                if (item.type !== 'function')
                    continue;
                const isReadOnly = item.stateMutability === 'view' || item.stateMutability === 'pure';
                const safety = (0, intent_classifier_1.classifySafety)({ name: item.name, isReadOnly, type: 'contract' });
                actions.push({
                    name: item.name,
                    description: isReadOnly
                        ? `Read contract: ${item.name}`
                        : `Write contract: ${item.name}`,
                    intent: (0, intent_classifier_1.inferIntent)(item.name),
                    type: 'contract',
                    location: `./${path.relative(this.projectPath, filePath)}`,
                    abiFunction: item.name,
                    isReadOnly,
                    safety,
                    agentSafe: (0, intent_classifier_1.deriveAgentSafe)(safety),
                    inputs: this.mapAbiInputs(item.inputs ?? []),
                    outputs: {
                        type: this.mapAbiOutputs(item.outputs ?? []),
                        description: '',
                    },
                });
            }
            return actions;
        }
        catch {
            return [];
        }
    }
    /**
     * Detect wagmi contract interactions (useWriteContract, writeContract, etc.)
     * and cross-reference imported ABI files to extract real parameter types.
     */
    async detectHooks(sourceFile) {
        const actions = [];
        const abiMap = this.buildAbiImportMap(sourceFile);
        sourceFile.forEachDescendant(node => {
            if (!ts_morph_1.Node.isObjectLiteralExpression(node))
                return;
            const props = node.getProperties();
            // Collect relevant property assignments by key name
            let abiVarName = null;
            let functionName = null;
            let chainId;
            for (const prop of props) {
                if (!ts_morph_1.Node.isPropertyAssignment(prop))
                    continue;
                const key = prop.getName();
                const init = prop.getInitializer();
                if (!init)
                    continue;
                if (key === 'abi') {
                    abiVarName = init.getText().trim();
                }
                if (key === 'functionName' && ts_morph_1.Node.isStringLiteral(init)) {
                    functionName = init.getLiteralValue();
                }
                // Explicit numeric chainId: { chainId: 8453 }
                if (key === 'chainId' && ts_morph_1.Node.isNumericLiteral(init)) {
                    chainId = Number(init.getLiteralValue());
                }
                // Chain object reference: { chain: base } → resolve known chain names
                if (key === 'chain') {
                    chainId = KNOWN_CHAINS[init.getText().trim()] ?? chainId;
                }
            }
            if (!abiVarName || !functionName)
                return;
            // Cross-reference against imported ABI for real parameter types
            let parameters = {};
            const abi = abiMap.get(abiVarName);
            if (abi) {
                const abiFunc = abi.find((item) => item.type === 'function' && item.name === functionName);
                if (abiFunc) {
                    parameters = this.mapAbiInputs(abiFunc.inputs ?? []);
                }
            }
            const safety = (0, intent_classifier_1.classifySafety)({ name: functionName, isReadOnly: false, type: 'contract' });
            actions.push({
                name: functionName,
                description: `Contract interaction: ${functionName}`,
                intent: (0, intent_classifier_1.inferIntent)(functionName),
                type: 'contract',
                location: sourceFile.getFilePath(),
                abiFunction: functionName,
                ...(chainId !== undefined ? { chainId } : {}),
                safety,
                agentSafe: (0, intent_classifier_1.deriveAgentSafe)(safety),
                inputs: parameters,
                outputs: { type: 'any' },
            });
        });
        return actions;
    }
    // ─── Private helpers ─────────────────────────────────────────────────────
    /**
     * Resolve relative imports that point to JSON ABI files.
     * Returns a map of imported identifier -> ABI array.
     */
    buildAbiImportMap(sourceFile) {
        const map = new Map();
        const sourceDir = path.dirname(sourceFile.getFilePath());
        for (const importDecl of sourceFile.getImportDeclarations()) {
            const spec = importDecl.getModuleSpecifierValue();
            if (!spec.startsWith('.'))
                continue;
            const candidates = [
                path.resolve(sourceDir, spec),
                path.resolve(sourceDir, `${spec}.json`),
            ];
            for (const candidate of candidates) {
                if (!fs.existsSync(candidate))
                    continue;
                try {
                    const parsed = JSON.parse(fs.readFileSync(candidate, 'utf8'));
                    if (!Array.isArray(parsed))
                        break;
                    for (const namedImport of importDecl.getNamedImports()) {
                        map.set(namedImport.getName(), parsed);
                    }
                    const defaultImport = importDecl.getDefaultImport();
                    if (defaultImport) {
                        map.set(defaultImport.getText(), parsed);
                    }
                    break;
                }
                catch { /* ignore */ }
            }
        }
        return map;
    }
    mapAbiInputs(inputs) {
        const props = {};
        for (const input of inputs) {
            props[input.name || 'arg'] = {
                type: this.mapSolidityType(input.type),
                description: `Solidity type: ${input.type}`,
                required: true,
            };
        }
        return props;
    }
    mapAbiOutputs(outputs) {
        if (!outputs.length)
            return 'void';
        if (outputs.length === 1)
            return this.mapSolidityType(outputs[0].type);
        return 'object';
    }
    mapSolidityType(type) {
        if (type.startsWith('uint') || type.startsWith('int'))
            return 'number';
        if (type === 'bool')
            return 'boolean';
        if (type === 'address')
            return 'string';
        if (type.startsWith('bytes'))
            return 'string';
        if (type.endsWith('[]'))
            return 'array';
        return 'string';
    }
}
exports.ContractParser = ContractParser;
