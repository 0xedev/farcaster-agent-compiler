#!/usr/bin/env node
import { Command } from 'commander';
import * as fs from 'fs';
import * as path from 'path';
import { DiscoveryService } from './discovery/service';
import { TSParser } from './parser/ts-parser';
import { ManifestGenerator } from './generator/json';
import { AgentAction, AgentManifest } from './types';

const program = new Command();

// ─── compile ─────────────────────────────────────────────────────────────────

program
  .name('farcaster-agent-compiler')
  .description('Universal compiler for Farcaster Agent Manifests')
  .version('2.0.0')
  .option('-p, --path <path>', 'path to the project root', '.')
  .option('-o, --output <output>', 'output path for agent.json', './agent.json')
  .option('--author <author>', 'author name or organization')
  .option('--url <url>', 'mini app homepage or Farcaster frame URL')
  .action(async (options) => {
    const projectPath = path.resolve(options.path);
    const outputPath = path.resolve(options.output);

    console.log(`🚀 Scanning project at: ${projectPath}`);

    const discovery = new DiscoveryService(projectPath);
    const files = await discovery.findRelevantFiles();

    console.log(`🔍 Found ${files.length} relevant files.`);

    const parser = new TSParser(projectPath);
    const actions: AgentAction[] = [];

    for (const file of files) {
      console.log(`📄 Parsing: ${path.relative(projectPath, file)}`);
      const fileActions = await parser.parseFile(file);
      actions.push(...fileActions);
    }

    console.log(`✨ Detected ${actions.length} agent actions.`);

    // Deduplicate actions across files (prefer versions with more inputs)
    const uniqueActions = new Map<string, AgentAction>();
    for (const action of actions) {
      const existing = uniqueActions.get(action.name);
      if (!existing || Object.keys(action.inputs).length > Object.keys(existing.inputs).length) {
        uniqueActions.set(action.name, action);
      }
    }

    const appMetadata = parser.getAppMetadata();
    if (options.author) appMetadata.author = options.author;
    if (options.url)    appMetadata.url    = options.url;

    const generator = new ManifestGenerator();
    const manifest = generator.generate(
      Array.from(uniqueActions.values()),
      appMetadata,
      parser.getCapabilities()
    );

    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, JSON.stringify(manifest, null, 2));

    console.log(`✅ Manifest generated at: ${outputPath}`);
    console.log(`   ${uniqueActions.size} actions · ${manifest.capabilities.length} capabilities`);
  });

// ─── validate ────────────────────────────────────────────────────────────────

program
  .command('validate [file]')
  .description('Validate an agent.json manifest against the schema')
  .action((file = './agent.json') => {
    const manifestPath = path.resolve(file);

    if (!fs.existsSync(manifestPath)) {
      console.error(`❌ File not found: ${manifestPath}`);
      process.exit(1);
    }

    let manifest: AgentManifest;
    try {
      manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    } catch {
      console.error(`❌ Invalid JSON in: ${manifestPath}`);
      process.exit(1);
    }

    const errors = validateManifest(manifest);
    if (errors.length === 0) {
      console.log(`✅ ${manifestPath} is valid`);
      console.log(`   ${manifest.actions.length} actions · ${manifest.capabilities.length} capabilities`);
    } else {
      console.error(`❌ Validation failed (${errors.length} error${errors.length > 1 ? 's' : ''}):`);
      for (const err of errors) console.error(`   • ${err}`);
      process.exit(1);
    }
  });

// ─── Structural validator (no external deps) ─────────────────────────────────

const SAFETY_LEVELS = new Set(['read', 'write', 'financial', 'destructive']);
const ACTION_TYPES  = new Set(['api', 'contract', 'function']);
const INTENT_RE     = /^[a-z][a-z0-9]*\.[a-z][a-z0-9]*$/;

function validateManifest(m: any): string[] {
  const errors: string[] = [];

  if (typeof m.name !== 'string' || !m.name)
    errors.push('`name` must be a non-empty string');
  if (typeof m.description !== 'string')
    errors.push('`description` must be a string');
  if (typeof m.version !== 'string' || !/^\d+\.\d+\.\d+$/.test(m.version))
    errors.push('`version` must be a semver string (e.g. "1.0.0")');
  if (!Array.isArray(m.capabilities))
    errors.push('`capabilities` must be an array');
  if (!Array.isArray(m.actions))
    errors.push('`actions` must be an array');
  else {
    m.actions.forEach((action: any, i: number) => {
      const prefix = `actions[${i}] ("${action.name ?? '?'}")`;
      if (!action.name)               errors.push(`${prefix}: missing \`name\``);
      if (!action.description)        errors.push(`${prefix}: missing \`description\``);
      if (!action.intent)             errors.push(`${prefix}: missing \`intent\``);
      else if (!INTENT_RE.test(action.intent))
        errors.push(`${prefix}: \`intent\` must match domain.verb format, got "${action.intent}"`);
      if (!ACTION_TYPES.has(action.type))
        errors.push(`${prefix}: \`type\` must be one of api|contract|function`);
      if (!action.location)           errors.push(`${prefix}: missing \`location\``);
      if (!SAFETY_LEVELS.has(action.safety))
        errors.push(`${prefix}: \`safety\` must be one of read|write|financial|destructive`);
      if (typeof action.agentSafe !== 'boolean')
        errors.push(`${prefix}: \`agentSafe\` must be a boolean`);
      if (typeof action.inputs !== 'object' || Array.isArray(action.inputs))
        errors.push(`${prefix}: \`inputs\` must be an object`);
      if (!action.outputs || typeof action.outputs.type !== 'string')
        errors.push(`${prefix}: \`outputs.type\` must be a string`);
    });
  }

  return errors;
}

program.parse();
