#!/usr/bin/env node
import { Command } from 'commander';
import * as fs from 'fs';
import * as path from 'path';
import { DiscoveryService } from './discovery/service';
import { TSParser } from './parser/ts-parser';
import { ManifestGenerator } from './generator/json';
import { AgentAction } from './types';

const program = new Command();

program
  .name('farcaster-agent-compiler')
  .description('Universal compiler for Farcaster Agent Manifests')
  .version('1.0.0')
  .option('-p, --path <path>', 'path to the project root', '.')
  .option('-o, --output <output>', 'output path for agent.json', './agent.json')
  .action(async (options) => {
    const projectPath = path.resolve(options.path);
    const outputPath = path.resolve(options.output);

    console.log(`🚀 Scanning project at: ${projectPath}`);

    const discovery = new DiscoveryService(projectPath);
    const files = await discovery.findRelevantFiles();

    console.log(`🔍 Found ${files.length} relevant files.`);

    const parser = new TSParser(projectPath);
    const actions = [];

    for (const file of files) {
      console.log(`📄 Parsing: ${path.relative(projectPath, file)}`);
      const fileActions = await parser.parseFile(file);
      actions.push(...fileActions);
    }

    console.log(`✨ Detected ${actions.length} agent actions.`);

    // Deduplicate actions across files (prefer versions with more parameters)
    const uniqueActions = new Map<string, AgentAction>();
    for (const action of actions) {
      const existing = uniqueActions.get(action.name);
      if (!existing || (action.parameters && Object.keys(action.parameters.properties).length > Object.keys(existing.parameters.properties).length)) {
        uniqueActions.set(action.name, action);
      }
    }

    const generator = new ManifestGenerator();
    const manifest = generator.generate(Array.from(uniqueActions.values()), parser.getAppMetadata());

    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, JSON.stringify(manifest, null, 2));

    console.log(`✅ Manifest generated at: ${outputPath}`);
  });

program.parse();
