import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { glob } from 'tinyglobby';
import { looksLikeRouteFile } from '../parser/express-parser';

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
  // Never scan env files — they may contain secrets
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

    // 0. Farcaster manifest (app identity / metadata)
    const manifests = await glob([
      '.well-known/farcaster.json',
      'public/.well-known/farcaster.json',
      '**/public/.well-known/farcaster.json',
    ], { cwd: this.projectPath, absolute: true });
    relevantFiles.push(...manifests);

    // 0.5. ABI JSON files (smart contract definitions)
    const abis = await glob([
      '**/*ABI.json',
      '**/abi/*.json',
      '**/abis/*.json',
      'contracts/*.json',
      '**/contracts/*.json',
      ...ALWAYS_EXCLUDE,
    ], { cwd: this.projectPath, absolute: true });
    relevantFiles.push(...abis);

    // 1. API routes — support monorepo layouts (apps/*/src/app/api, apps/*/pages/api, etc.)
    const apiRoutes = await glob([
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
    const allTsFiles = await glob([
      '**/*.{ts,tsx}',
      ...ALWAYS_EXCLUDE,
    ], { cwd: this.projectPath, absolute: true });

    for (const file of allTsFiles) {
      if (relevantFiles.includes(file)) continue;

      const hash = fileHash(file);
      const cached = this.cache[file];

      // Cache hit: file unchanged, reuse previous relevance decision
      if (cached && cached.hash === hash) {
        if (cached.relevant) relevantFiles.push(file);
        continue;
      }

      // Cache miss: read and classify
      const content = fs.readFileSync(file, 'utf8');
      const relevant =
        content.includes('@agent-action') ||
        content.includes('useWriteContract') ||
        content.includes('useContractWrite') ||
        content.includes('writeContract') ||
        content.includes("'use server'") ||
        content.includes('"use server"') ||
        looksLikeRouteFile(content);

      this.cache[file] = { hash, relevant };
      this.cacheModified = true;
      if (relevant) relevantFiles.push(file);
    }

    this.saveCache();
    return Array.from(new Set(relevantFiles));
  }
}
