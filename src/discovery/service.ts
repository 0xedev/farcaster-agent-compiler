import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { glob } from 'tinyglobby';
import { looksLikeRouteFile } from '../parser/express-parser';
import { looksLikeSocketIOFile } from '../parser/socketio-parser';
import { looksLikeTRPCFile } from '../parser/trpc-parser';
import { looksLikeSSEFile } from '../parser/sse-parser';
import { looksLikeRemixRouteFile } from '../parser/remix-parser';
import { looksLikeWebSocketFile } from '../parser/websocket-parser';
import { OPENAPI_PATTERNS } from '../parser/openapi-parser';
import { PRISMA_PATTERNS } from '../parser/prisma-parser';

/** SHA-1 of a file's content — used for change detection caching. */
function fileHash(filePath: string): string {
  try {
    return crypto.createHash('sha1').update(fs.readFileSync(filePath)).digest('hex');
  } catch {
    return '';
  }
}

const CACHE_FILE = '.agentjson-cache.json';

interface CacheEntry { hash: string; relevant: boolean; }
type Cache = Record<string, CacheEntry>;

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

export class DiscoveryService {
  private cache: Cache = {};
  private cachePath: string;
  private cacheModified = false;

  constructor(private projectPath: string) {
    this.cachePath = path.join(projectPath, CACHE_FILE);
    this.loadCache();
  }

  private loadCache(): void {
    try {
      this.cache = JSON.parse(fs.readFileSync(this.cachePath, 'utf8'));
    } catch { this.cache = {}; }
  }

  private saveCache(): void {
    if (!this.cacheModified) return;
    try { fs.writeFileSync(this.cachePath, JSON.stringify(this.cache, null, 2)); } catch { /* ignore */ }
  }

  async findRelevantFiles(): Promise<string[]> {
    const relevantFiles: string[] = [];

    // 0. Farcaster manifest
    const manifests = await glob([
      '.well-known/farcaster.json',
      'public/.well-known/farcaster.json',
      '**/public/.well-known/farcaster.json',
    ], { cwd: this.projectPath, absolute: true });
    relevantFiles.push(...manifests);

    // 0.5. ABI JSON files
    const abis = await glob([
      '**/*ABI.json',
      '**/abi/*.json',
      '**/abis/*.json',
      'contracts/*.json',
      '**/contracts/*.json',
      ...ALWAYS_EXCLUDE,
    ], { cwd: this.projectPath, absolute: true });
    relevantFiles.push(...abis);

    // 0.6. OpenAPI / Swagger specs
    const openApiFiles = await glob([
      ...OPENAPI_PATTERNS,
      ...ALWAYS_EXCLUDE,
    ], { cwd: this.projectPath, absolute: true });
    relevantFiles.push(...openApiFiles);

    // 0.7. Prisma schema files
    const prismaFiles = await glob([
      ...PRISMA_PATTERNS,
      ...ALWAYS_EXCLUDE,
    ], { cwd: this.projectPath, absolute: true });
    relevantFiles.push(...prismaFiles);

    // 1. Next.js API routes
    const apiRoutes = await glob([
      '**/app/api/**/*.{ts,js,tsx,jsx}',
      '**/pages/api/**/*.{ts,js,tsx,jsx}',
      '**/api/**/*.{ts,js,tsx,jsx}',
      ...ALWAYS_EXCLUDE,
    ], { cwd: this.projectPath, absolute: true });
    relevantFiles.push(...apiRoutes);

    // 2. Remix route files
    const remixRoutes = await glob([
      '**/app/routes/**/*.{ts,js,tsx,jsx}',
      '**/routes/**/*.{ts,js,tsx,jsx}',
      ...ALWAYS_EXCLUDE,
    ], { cwd: this.projectPath, absolute: true });
    relevantFiles.push(...remixRoutes);

    // 3. Scan all TS/TSX/JS files for signal keywords
    const allTsFiles = await glob([
      '**/*.{ts,tsx,js,jsx}',
      ...ALWAYS_EXCLUDE,
    ], { cwd: this.projectPath, absolute: true });

    for (const file of allTsFiles) {
      if (relevantFiles.includes(file)) continue;

      const hash = fileHash(file);
      const cached = this.cache[file];

      if (cached && cached.hash === hash) {
        if (cached.relevant) relevantFiles.push(file);
        continue;
      }

      const content = fs.readFileSync(file, 'utf8');
      const relevant =
        content.includes('@agent-action') ||
        content.includes('useWriteContract') ||
        content.includes('useContractWrite') ||
        content.includes('writeContract') ||
        content.includes("'use server'") ||
        content.includes('"use server"') ||
        looksLikeRouteFile(content) ||
        looksLikeSocketIOFile(content) ||
        looksLikeTRPCFile(content) ||
        looksLikeSSEFile(content) ||
        looksLikeRemixRouteFile(content) ||
        looksLikeWebSocketFile(content);

      this.cache[file] = { hash, relevant };
      this.cacheModified = true;
      if (relevant) relevantFiles.push(file);
    }

    this.saveCache();
    return Array.from(new Set(relevantFiles));
  }
}
