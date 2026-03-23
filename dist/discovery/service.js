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
const path = __importStar(require("path"));
const crypto = __importStar(require("crypto"));
const tinyglobby_1 = require("tinyglobby");
const express_parser_1 = require("../parser/express-parser");
const socketio_parser_1 = require("../parser/socketio-parser");
const trpc_parser_1 = require("../parser/trpc-parser");
const sse_parser_1 = require("../parser/sse-parser");
const remix_parser_1 = require("../parser/remix-parser");
const websocket_parser_1 = require("../parser/websocket-parser");
const openapi_parser_1 = require("../parser/openapi-parser");
const prisma_parser_1 = require("../parser/prisma-parser");
/** SHA-1 of a file's content — used for change detection caching. */
function fileHash(filePath) {
    try {
        return crypto.createHash('sha1').update(fs.readFileSync(filePath)).digest('hex');
    }
    catch {
        return '';
    }
}
const CACHE_FILE = '.agentjson-cache.json';
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
    '!**/.env',
    '!**/.env.*',
    '!**/secrets/**',
    '!**/credentials/**',
];
/**
 * Checks if a path is strictly within the project directory.
 * Prevents path traversal via symbolic links or malformed paths.
 */
function isPathWithinProject(filePath, projectPath) {
    const resolved = path.resolve(filePath);
    const root = path.resolve(projectPath);
    return resolved.startsWith(root);
}
class DiscoveryService {
    projectPath;
    cache = {};
    cachePath;
    cacheModified = false;
    constructor(projectPath) {
        this.projectPath = projectPath;
        this.cachePath = path.join(projectPath, CACHE_FILE);
        this.loadCache();
    }
    loadCache() {
        try {
            this.cache = JSON.parse(fs.readFileSync(this.cachePath, 'utf8'));
        }
        catch {
            this.cache = {};
        }
    }
    saveCache() {
        if (!this.cacheModified)
            return;
        try {
            fs.writeFileSync(this.cachePath, JSON.stringify(this.cache, null, 2));
        }
        catch { /* ignore */ }
    }
    async findRelevantFiles() {
        const relevantFiles = [];
        // 0. Farcaster manifest
        const manifests = await (0, tinyglobby_1.glob)([
            '.well-known/farcaster.json',
            'public/.well-known/farcaster.json',
            '**/public/.well-known/farcaster.json',
        ], { cwd: this.projectPath, absolute: true });
        relevantFiles.push(...manifests);
        // 0.5. ABI JSON files
        const abis = await (0, tinyglobby_1.glob)([
            '**/*ABI.json',
            '**/abi/*.json',
            '**/abis/*.json',
            'contracts/*.json',
            '**/contracts/*.json',
            ...ALWAYS_EXCLUDE,
        ], { cwd: this.projectPath, absolute: true });
        relevantFiles.push(...abis);
        // 0.6. OpenAPI / Swagger specs
        const openApiFiles = await (0, tinyglobby_1.glob)([
            ...openapi_parser_1.OPENAPI_PATTERNS,
            ...ALWAYS_EXCLUDE,
        ], { cwd: this.projectPath, absolute: true });
        relevantFiles.push(...openApiFiles);
        // 0.7. Prisma schema files
        const prismaFiles = await (0, tinyglobby_1.glob)([
            ...prisma_parser_1.PRISMA_PATTERNS,
            ...ALWAYS_EXCLUDE,
        ], { cwd: this.projectPath, absolute: true });
        relevantFiles.push(...prismaFiles);
        // 1. Next.js API routes
        const apiRoutes = await (0, tinyglobby_1.glob)([
            '**/app/api/**/*.{ts,js,tsx,jsx}',
            '**/pages/api/**/*.{ts,js,tsx,jsx}',
            '**/api/**/*.{ts,js,tsx,jsx}',
            ...ALWAYS_EXCLUDE,
        ], { cwd: this.projectPath, absolute: true });
        relevantFiles.push(...apiRoutes);
        // 2. Remix route files
        const remixRoutes = await (0, tinyglobby_1.glob)([
            '**/app/routes/**/*.{ts,js,tsx,jsx}',
            '**/routes/**/*.{ts,js,tsx,jsx}',
            ...ALWAYS_EXCLUDE,
        ], { cwd: this.projectPath, absolute: true });
        relevantFiles.push(...remixRoutes);
        // 3. Scan all TS/TSX/JS files for signal keywords
        const allTsFiles = await (0, tinyglobby_1.glob)([
            '**/*.{ts,tsx,js,jsx}',
            ...ALWAYS_EXCLUDE,
        ], { cwd: this.projectPath, absolute: true });
        for (const file of allTsFiles) {
            if (!isPathWithinProject(file, this.projectPath))
                continue;
            if (relevantFiles.includes(file))
                continue;
            const hash = fileHash(file);
            const cached = this.cache[file];
            if (cached && cached.hash === hash) {
                if (cached.relevant)
                    relevantFiles.push(file);
                continue;
            }
            const content = fs.readFileSync(file, 'utf8');
            const relevant = content.includes('@agent-action') ||
                content.includes('useWriteContract') ||
                content.includes('useContractWrite') ||
                content.includes('writeContract') ||
                content.includes("'use server'") ||
                content.includes('"use server"') ||
                (0, express_parser_1.looksLikeRouteFile)(content) ||
                (0, socketio_parser_1.looksLikeSocketIOFile)(content) ||
                (0, trpc_parser_1.looksLikeTRPCFile)(content) ||
                (0, sse_parser_1.looksLikeSSEFile)(content) ||
                (0, remix_parser_1.looksLikeRemixRouteFile)(content) ||
                (0, websocket_parser_1.looksLikeWebSocketFile)(content);
            this.cache[file] = { hash, relevant };
            this.cacheModified = true;
            if (relevant)
                relevantFiles.push(file);
        }
        this.saveCache();
        return Array.from(new Set(relevantFiles));
    }
}
exports.DiscoveryService = DiscoveryService;
