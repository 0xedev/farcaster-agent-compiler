#!/usr/bin/env node
import { Command } from 'commander';
import * as fs from 'fs';
import * as path from 'path';
import {
  DiscoveryService,
  TSParser,
  ExpressParser,
  SocketIOParser,
  TRPCParser,
  SSEParser,
  RemixParser,
  WebSocketParser,
  OpenAPIParser,
  PrismaParser,
  ManifestGenerator,
  looksLikeRouteFile,
  looksLikeSocketIOFile,
  looksLikeTRPCFile,
  looksLikeSSEFile,
  looksLikeRemixRouteFile,
  looksLikeWebSocketFile,
  OPENAPI_PATTERNS,
  PRISMA_PATTERNS,
} from './index';
import { AgentAction, AgentManifest, AuthConfig, AuthType, DataModelEntry } from './types';

const program = new Command();

// ─── compile ─────────────────────────────────────────────────────────────────

program
  .name('agentjson')
  .description('Universal agent manifest compiler — generates agent.json for any web app')
  .version('3.1.0')
  .option('-p, --path <path>', 'path to the project root', '.')
  .option('-o, --output <output>', 'output path for agent.json', './public/agent.json')
  .option('--author <author>', 'author name or organization')
  .option('--url <url>', 'app homepage URL')
  .option(
    '--auth-type <type>',
    'override detected auth type: none | bearer | api-key | oauth2 | basic | farcaster-frame | cookie'
  )
  .option('--auth-header <header>', 'auth header name (default: Authorization)')
  .option('--auth-docs <url>', 'URL where agents can obtain credentials')
  .action(async (options) => {
    const projectPath = path.resolve(options.path);
    const outputPath  = path.resolve(options.output);

    console.log(`🚀 Scanning project at: ${projectPath}`);

    const discovery = new DiscoveryService(projectPath);
    const files = await discovery.findRelevantFiles();

    console.log(`🔍 Found ${files.length} relevant files.`);

    const tsParser      = new TSParser(projectPath);
    const sharedProject = tsParser.getProject();
    const expressParser = new ExpressParser(sharedProject);
    const socketParser  = new SocketIOParser(sharedProject);
    const trpcParser    = new TRPCParser(sharedProject);
    const sseParser     = new SSEParser(sharedProject);
    const remixParser   = new RemixParser(sharedProject);
    const wsParser      = new WebSocketParser(sharedProject);
    const openApiParser = new OpenAPIParser();
    const prismaParser  = new PrismaParser();
    const actions: AgentAction[] = [];
    const dataModel: Record<string, DataModelEntry> = {};

    // Determine which files are OpenAPI / Prisma by extension/name
    const openApiExts  = new Set(['.json', '.yaml', '.yml']);
    const prismaExt    = '.prisma';

    for (const file of files) {
      console.log(`📄 Parsing: ${path.relative(projectPath, file)}`);

      const ext  = path.extname(file).toLowerCase();
      const base = path.basename(file).toLowerCase();

      // ── OpenAPI spec ──────────────────────────────────────────────────────
      if (openApiExts.has(ext) && OPENAPI_PATTERNS.some(p => {
        const pat = p.replace('**/', '').replace('*', '');
        return base.includes(pat.split('.')[0]);
      })) {
        try {
          actions.push(...openApiParser.parseFile(file, projectPath));
        } catch { /* ignore */ }
        continue;
      }

      // ── Prisma schema ─────────────────────────────────────────────────────
      if (ext === prismaExt || base === 'schema.prisma') {
        try {
          const prismaResult = prismaParser.parseFile(file);
          Object.assign(dataModel, prismaResult.dataModel);
        } catch { /* ignore */ }
        continue;
      }

      // ── TypeScript / JavaScript source files ──────────────────────────────
      if (ext === '.ts' || ext === '.tsx' || ext === '.js' || ext === '.jsx') {
        // Standard TS server-action / contract / annotation parsing
        try {
          const fileActions = await tsParser.parseFile(file);
          actions.push(...fileActions);
        } catch { /* ignore */ }

        try {
          const content = fs.readFileSync(file, 'utf8');

          if (looksLikeRouteFile(content)) {
            actions.push(...await expressParser.parseFile(file, projectPath));
          }
          if (looksLikeSocketIOFile(content)) {
            actions.push(...await socketParser.parseFile(file, projectPath));
          }
          if (looksLikeTRPCFile(content)) {
            actions.push(...await trpcParser.parseFile(file, projectPath));
          }
          if (looksLikeSSEFile(content)) {
            actions.push(...await sseParser.parseFile(file, projectPath));
          }
          if (looksLikeRemixRouteFile(content)) {
            actions.push(...await remixParser.parseFile(file, projectPath));
          }
          if (looksLikeWebSocketFile(content)) {
            actions.push(...await wsParser.parseFile(file, projectPath));
          }
        } catch { /* ignore */ }
      }
    }

    console.log(`✨ Detected ${actions.length} agent actions.`);

    const uniqueActions = new Map<string, AgentAction>();
    for (const action of actions) {
      const existing = uniqueActions.get(action.name);
      if (!existing || Object.keys(action.parameters?.properties ?? {}).length > Object.keys(existing.parameters?.properties ?? {}).length) {
        uniqueActions.set(action.name, action);
      }
    }

    const appMetadata = tsParser.getAppMetadata();
    if (options.author) appMetadata.author = options.author;
    if (options.url)    appMetadata.url    = options.url;

    const detectedAuth = tsParser.getAuth();
    const auth: AuthConfig = {
      ...detectedAuth,
      ...(options.authType   && { type:    options.authType as AuthType }),
      ...(options.authHeader && { header:  options.authHeader }),
      ...(options.authDocs   && { docsUrl: options.authDocs }),
    };

    const generator = new ManifestGenerator();
    const manifest = generator.generate(
      Array.from(uniqueActions.values()),
      appMetadata,
      tsParser.getCapabilities(),
      auth,
      undefined,
      Object.keys(dataModel).length > 0 ? dataModel : undefined
    );

    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, JSON.stringify(manifest, null, 2));

    console.log(`✅ agent.json generated at: ${outputPath}`);
    console.log(`   ${uniqueActions.size} actions · ${manifest.capabilities.length} capabilities · auth: ${auth.type}`);
  });

// ─── validate ────────────────────────────────────────────────────────────────

program
  .command('validate [file]')
  .description('Validate an agent.json manifest against the schema')
  .action((file = './public/agent.json') => {
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
      console.log(`   ${manifest.actions.length} actions · ${manifest.capabilities.length} capabilities · auth: ${manifest.auth.type}`);
    } else {
      console.error(`❌ Validation failed (${errors.length} error${errors.length > 1 ? 's' : ''}):`);
      for (const err of errors) console.error(`   • ${err}`);
      process.exit(1);
    }
  });

// ─── Structural validator ────────────────────────────────────────────────────

const SAFETY_LEVELS  = new Set(['read', 'write', 'financial', 'destructive', 'confidential']);
const ACTION_TYPES   = new Set(['api', 'contract', 'function', 'socket']);
const AUTH_TYPES     = new Set(['none', 'bearer', 'api-key', 'oauth2', 'basic', 'farcaster-frame', 'cookie']);
const INTENT_RE      = /^[a-z][a-z0-9]*\.[a-z][a-z0-9]*$/;

function validateManifest(m: any): string[] {
  const errors: string[] = [];

  if (typeof m.name !== 'string' || !m.name)
    errors.push('`name` must be a non-empty string');
  if (typeof m.version !== 'string' || !/^\d+\.\d+\.\d+$/.test(m.version))
    errors.push('`version` must be a semver string');

  if (!m.auth || !AUTH_TYPES.has(m.auth.type))
    errors.push('`auth.type` must be one of: ' + [...AUTH_TYPES].join(' | '));

  if (!Array.isArray(m.capabilities))
    errors.push('`capabilities` must be an array');
  if (!Array.isArray(m.actions))
    errors.push('`actions` must be an array');
  else {
    m.actions.forEach((action: any, i: number) => {
      const prefix = `actions[${i}] ("${action.name ?? '?'}")`;
      if (!action.name)              errors.push(`${prefix}: missing \`name\``);
      if (!action.intent)            errors.push(`${prefix}: missing \`intent\``);
      else if (!INTENT_RE.test(action.intent))
        errors.push(`${prefix}: \`intent\` must match domain.verb format`);
      if (!ACTION_TYPES.has(action.type))
        errors.push(`${prefix}: \`type\` must be one of api|contract|function`);
      if (!SAFETY_LEVELS.has(action.safety))
        errors.push(`${prefix}: \`safety\` must be one of read|write|financial|destructive|confidential`);
      if (typeof action.agentSafe !== 'boolean')
        errors.push(`${prefix}: \`agentSafe\` must be a boolean`);
      if (!action.requiredAuth)
        errors.push(`${prefix}: \`requiredAuth\` is missing`);
    });
  }

  return errors;
}

program.parse();
