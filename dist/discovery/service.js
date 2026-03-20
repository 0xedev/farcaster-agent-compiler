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
exports.DiscoveryService = void 0;
const fs = __importStar(require("fs"));
const tinyglobby_1 = require("tinyglobby");
/** Glob negations applied to every pattern to keep node_modules and build artifacts out. */
const ALWAYS_EXCLUDE = [
    '!**/node_modules/**',
    '!**/.next/**',
    '!**/dist/**',
    '!**/.turbo/**',
    '!**/.cache/**',
    '!**/.git/**',
    '!**/out/**',
    '!**/build/**',
    '!**/.vercel/**',
];
class DiscoveryService {
    projectPath;
    constructor(projectPath) {
        this.projectPath = projectPath;
    }
    async findRelevantFiles() {
        const relevantFiles = [];
        // 0. Farcaster manifest (app identity / metadata)
        const manifests = await (0, tinyglobby_1.glob)([
            '.well-known/farcaster.json',
            'public/.well-known/farcaster.json',
            '**/public/.well-known/farcaster.json',
        ], { cwd: this.projectPath, absolute: true });
        relevantFiles.push(...manifests);
        // 0.5. ABI JSON files (smart contract definitions)
        const abis = await (0, tinyglobby_1.glob)([
            '**/*ABI.json',
            '**/abi/*.json',
            '**/abis/*.json',
            'contracts/*.json',
            '**/contracts/*.json',
            ...ALWAYS_EXCLUDE,
        ], { cwd: this.projectPath, absolute: true });
        relevantFiles.push(...abis);
        // 1. API routes — support monorepo layouts (apps/*/src/app/api, apps/*/pages/api, etc.)
        const apiRoutes = await (0, tinyglobby_1.glob)([
            // Next.js App Router
            '**/app/api/**/*.{ts,js,tsx,jsx}',
            // Next.js Pages Router
            '**/pages/api/**/*.{ts,js,tsx,jsx}',
            // Generic api/ folder
            '**/api/**/*.{ts,js,tsx,jsx}',
            ...ALWAYS_EXCLUDE,
        ], { cwd: this.projectPath, absolute: true });
        relevantFiles.push(...apiRoutes);
        // 2. Scan all TS/TSX files for signal keywords
        const allTsFiles = await (0, tinyglobby_1.glob)([
            '**/*.{ts,tsx}',
            ...ALWAYS_EXCLUDE,
        ], { cwd: this.projectPath, absolute: true });
        for (const file of allTsFiles) {
            if (relevantFiles.includes(file))
                continue;
            const content = fs.readFileSync(file, 'utf8');
            if (content.includes('@agent-action') ||
                content.includes('useWriteContract') ||
                content.includes('useContractWrite') ||
                content.includes('writeContract') ||
                content.includes("'use server'") ||
                content.includes('"use server"')) {
                relevantFiles.push(file);
            }
        }
        return Array.from(new Set(relevantFiles));
    }
}
exports.DiscoveryService = DiscoveryService;
