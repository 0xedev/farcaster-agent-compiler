import * as fs from 'fs';
import * as path from 'path';
import { glob } from 'tinyglobby';

export class DiscoveryService {
  constructor(private projectPath: string) {}

  async findRelevantFiles(): Promise<string[]> {
    const relevantFiles: string[] = [];

    // 0. Find Farcaster manifest
    const manifests = await glob([
      '.well-known/farcaster.json',
      'public/.well-known/farcaster.json'
    ], { cwd: this.projectPath, absolute: true });
    relevantFiles.push(...manifests);

    // 0.5 Find ABI files
    const abis = await glob([
      '**/*ABI.json',
      '**/abi/*.json',
      'contracts/*.json'
    ], { cwd: this.projectPath, absolute: true });
    relevantFiles.push(...abis);

    // 1. Find API routes (Next.js)
    const apiRoutes = await glob([
      'pages/api/**/*.{ts,js,tsx,jsx}',
      'app/api/**/*.{ts,js,tsx,jsx}',
      'api/**/*.{ts,js,tsx,jsx}' // Generic API folder
    ], { cwd: this.projectPath, absolute: true });
    
    relevantFiles.push(...apiRoutes);

    // 2. Find files with @agent-action annotation
    const allTsFiles = await glob([
      '**/*.{ts,tsx}',
      '!node_modules/**',
      '!.next/**',
      '!dist/**'
    ], { cwd: this.projectPath, absolute: true });

    for (const file of allTsFiles) {
      if (relevantFiles.includes(file)) continue;
      
      const content = fs.readFileSync(file, 'utf8');
      if (
        content.includes('@agent-action') || 
        content.includes('useWriteContract') || 
        content.includes('useContractWrite') ||
        content.includes('writeContract')
      ) {
        relevantFiles.push(file);
      }
    }

    return Array.from(new Set(relevantFiles));
  }
}
