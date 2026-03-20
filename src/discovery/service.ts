import * as fs from 'fs';
import * as path from 'path';
import { glob } from 'tinyglobby';

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

export class DiscoveryService {
  constructor(private projectPath: string) {}

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

      const content = fs.readFileSync(file, 'utf8');
      if (
        content.includes('@agent-action') ||
        content.includes('useWriteContract') ||
        content.includes('useContractWrite') ||
        content.includes('writeContract') ||
        content.includes("'use server'") ||
        content.includes('"use server"')
      ) {
        relevantFiles.push(file);
      }
    }

    return Array.from(new Set(relevantFiles));
  }
}
