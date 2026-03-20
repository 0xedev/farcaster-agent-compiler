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
    // Deduplicate actions across files (prefer versions with more parameters)
    const uniqueActions = new Map();
    for (const action of actions) {
        const existing = uniqueActions.get(action.name);
        if (!existing || (action.parameters && Object.keys(action.parameters.properties).length > Object.keys(existing.parameters.properties).length)) {
            uniqueActions.set(action.name, action);
        }
    }
    const generator = new json_1.ManifestGenerator();
    const manifest = generator.generate(Array.from(uniqueActions.values()), parser.getAppMetadata(), parser.getCapabilities());
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, JSON.stringify(manifest, null, 2));
    console.log(`✅ Manifest generated at: ${outputPath}`);
});
program.parse();
