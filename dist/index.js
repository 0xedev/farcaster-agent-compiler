#!/usr/bin/env node
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
const commander_1 = require("commander");
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const service_1 = require("./discovery/service");
const ts_parser_1 = require("./parser/ts-parser");
const json_1 = require("./generator/json");
const program = new commander_1.Command();
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
    const discovery = new service_1.DiscoveryService(projectPath);
    const files = await discovery.findRelevantFiles();
    console.log(`🔍 Found ${files.length} relevant files.`);
    const parser = new ts_parser_1.TSParser(projectPath);
    const actions = [];
    for (const file of files) {
        console.log(`📄 Parsing: ${path.relative(projectPath, file)}`);
        const fileActions = await parser.parseFile(file);
        actions.push(...fileActions);
    }
    console.log(`✨ Detected ${actions.length} agent actions.`);
    // Deduplicate actions across files (prefer versions with more inputs)
    const uniqueActions = new Map();
    for (const action of actions) {
        const existing = uniqueActions.get(action.name);
        if (!existing || Object.keys(action.inputs).length > Object.keys(existing.inputs).length) {
            uniqueActions.set(action.name, action);
        }
    }
    const appMetadata = parser.getAppMetadata();
    if (options.author)
        appMetadata.author = options.author;
    if (options.url)
        appMetadata.url = options.url;
    const generator = new json_1.ManifestGenerator();
    const manifest = generator.generate(Array.from(uniqueActions.values()), appMetadata, parser.getCapabilities());
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
    let manifest;
    try {
        manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    }
    catch {
        console.error(`❌ Invalid JSON in: ${manifestPath}`);
        process.exit(1);
    }
    const errors = validateManifest(manifest);
    if (errors.length === 0) {
        console.log(`✅ ${manifestPath} is valid`);
        console.log(`   ${manifest.actions.length} actions · ${manifest.capabilities.length} capabilities`);
    }
    else {
        console.error(`❌ Validation failed (${errors.length} error${errors.length > 1 ? 's' : ''}):`);
        for (const err of errors)
            console.error(`   • ${err}`);
        process.exit(1);
    }
});
// ─── Structural validator (no external deps) ─────────────────────────────────
const SAFETY_LEVELS = new Set(['read', 'write', 'financial', 'destructive']);
const ACTION_TYPES = new Set(['api', 'contract', 'function']);
const INTENT_RE = /^[a-z][a-z0-9]*\.[a-z][a-z0-9]*$/;
function validateManifest(m) {
    const errors = [];
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
        m.actions.forEach((action, i) => {
            const prefix = `actions[${i}] ("${action.name ?? '?'}")`;
            if (!action.name)
                errors.push(`${prefix}: missing \`name\``);
            if (!action.description)
                errors.push(`${prefix}: missing \`description\``);
            if (!action.intent)
                errors.push(`${prefix}: missing \`intent\``);
            else if (!INTENT_RE.test(action.intent))
                errors.push(`${prefix}: \`intent\` must match domain.verb format, got "${action.intent}"`);
            if (!ACTION_TYPES.has(action.type))
                errors.push(`${prefix}: \`type\` must be one of api|contract|function`);
            if (!action.location)
                errors.push(`${prefix}: missing \`location\``);
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
