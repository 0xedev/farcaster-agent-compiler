import { Project, SourceFile, JSDoc, Node, Type } from 'ts-morph';
import { AgentAction, AppMetadata } from '../types';
import * as path from 'path';
import * as fs from 'fs';
import { ContractParser } from './contract-parser';
import { ZodExtractor } from './zod-extractor';
import { CapabilityDetector } from './capability-detector';
import { inferIntent, classifySafety, deriveAgentSafe } from './intent-classifier';

const HTTP_METHODS = new Set(['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS']);

export class TSParser {
  private project: Project;
  private contractParser: ContractParser;
  private zodExtractor: ZodExtractor;
  private capabilityDetector: CapabilityDetector;
  private _appMetadata: AppMetadata = {};

  constructor(private projectPath: string) {
    this.project = new Project({
      compilerOptions: { allowJs: true, checkJs: false },
    });
    this.contractParser = new ContractParser(projectPath);
    this.zodExtractor = new ZodExtractor();
    this.capabilityDetector = new CapabilityDetector();
  }

  async parseFile(filePath: string): Promise<AgentAction[]> {
    const relativePath = path.relative(this.projectPath, filePath).replace(/\\/g, '/');

    // 1. farcaster.json — extract full app metadata and declared capabilities
    if (relativePath.endsWith('farcaster.json')) {
      try {
        const content = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        const frame = content.frame ?? {};
        this._appMetadata = {
          name:                 frame.name,
          description:          frame.buttonTitle || (frame.name ? `Farcaster App: ${frame.name}` : undefined),
          iconUrl:              frame.iconUrl,
          homeUrl:              frame.homeUrl,
          imageUrl:             frame.imageUrl,
          splashImageUrl:       frame.splashImageUrl,
          splashBackgroundColor: frame.splashBackgroundColor,
        };
        this.capabilityDetector.readManifest(frame);
      } catch { /* ignore */ }
      return [];
    }

    // 2. ABI JSON — delegate entirely to contract parser
    if (filePath.endsWith('.json')) {
      return this.contractParser.parseAbiFile(filePath);
    }

    // 3. TypeScript / TSX
    const sourceFile = this.project.addSourceFileAtPath(filePath);
    const actions: AgentAction[] = [];

    // 3a. @agent-action JSDoc annotations (highest priority, any file)
    const exported = sourceFile.getExportedDeclarations();
    for (const [name, declarations] of exported) {
      for (const declaration of declarations) {
        if (!('getJsDocs' in declaration)) continue;
        const jsDocs = (declaration as any).getJsDocs() as JSDoc[];
        for (const jsDoc of jsDocs) {
          if (jsDoc.getTags().some(tag => tag.getTagName() === 'agent-action')) {
            actions.push(this.parseAnnotatedFunction(name, declaration as any, jsDoc, filePath, relativePath));
          }
        }
      }
    }

    // 3b. App Router route handlers: app/api/**/route.(ts|tsx|js|jsx)
    const isAppRouterRoute = /app\/api\/.+\/route\.(ts|tsx|js|jsx)$/.test(relativePath);
    if (isAppRouterRoute) {
      const zodSchemas = this.zodExtractor.extractSchemas(sourceFile);
      const zodInputs = this.zodExtractor.findUsedSchema(sourceFile, zodSchemas) ?? {};
      const routeName = this.routeNameFromPath(relativePath);
      const location = this.routeLocationFromPath(relativePath);

      // export async function POST(request: Request) { ... }
      for (const func of sourceFile.getFunctions()) {
        if (!func.isExported()) continue;
        const methodName = func.getName();
        if (!methodName || !HTTP_METHODS.has(methodName)) continue;
        const actionName = `${routeName}_${methodName}`;
        if (actions.some(a => a.name === actionName)) continue;

        const safety = classifySafety({ name: actionName, httpMethod: methodName, type: 'api' });
        actions.push({
          name: actionName,
          description: `${methodName} ${location}`,
          intent: inferIntent(actionName),
          type: 'api',
          location,
          method: methodName,
          safety,
          agentSafe: deriveAgentSafe(safety),
          inputs: zodInputs,
          outputs: { type: 'any' },
        });
      }

      // export const POST = async (request: Request) => { ... }
      for (const varDecl of sourceFile.getVariableDeclarations()) {
        const methodName = varDecl.getName();
        if (!HTTP_METHODS.has(methodName)) continue;
        const stmt = varDecl.getVariableStatement();
        if (!stmt?.isExported()) continue;
        const actionName = `${routeName}_${methodName}`;
        if (actions.some(a => a.name === actionName)) continue;

        const safety = classifySafety({ name: actionName, httpMethod: methodName, type: 'api' });
        actions.push({
          name: actionName,
          description: `${methodName} ${location}`,
          intent: inferIntent(actionName),
          type: 'api',
          location,
          method: methodName,
          safety,
          agentSafe: deriveAgentSafe(safety),
          inputs: zodInputs,
          outputs: { type: 'any' },
        });
      }
    }

    // 3c. Pages Router API routes: pages/api/**
    const isPagesRoute = relativePath.startsWith('pages/api/');
    if (isPagesRoute && actions.length === 0) {
      const zodSchemas = this.zodExtractor.extractSchemas(sourceFile);
      const zodShape = this.zodExtractor.findUsedSchema(sourceFile, zodSchemas);
      const method = this.detectHttpMethod(sourceFile);
      const actionName = path.basename(filePath, path.extname(filePath));
      const location = '/' + relativePath.replace(/\.[^/.]+$/, '').replace(/^pages\/api\//, 'api/');
      const safety = classifySafety({ name: actionName, httpMethod: method, type: 'api' });

      actions.push({
        name: actionName,
        description: `API endpoint at /${relativePath}`,
        intent: inferIntent(actionName),
        type: 'api',
        location,
        method,
        safety,
        agentSafe: deriveAgentSafe(safety),
        inputs: zodShape ?? {},
        outputs: { type: 'any' },
      });
    }

    // 3d. Generic non-Next.js API routes: api/**
    const isGenericApiRoute =
      relativePath.startsWith('api/') && !isAppRouterRoute && !isPagesRoute;
    if (isGenericApiRoute && actions.length === 0) {
      const zodSchemas = this.zodExtractor.extractSchemas(sourceFile);
      const zodShape = this.zodExtractor.findUsedSchema(sourceFile, zodSchemas);
      const method = this.detectHttpMethod(sourceFile);
      const actionName = path.basename(filePath, path.extname(filePath));
      const location = '/' + relativePath.replace(/\.[^/.]+$/, '');
      const safety = classifySafety({ name: actionName, httpMethod: method, type: 'api' });

      actions.push({
        name: actionName,
        description: `API endpoint at /${relativePath}`,
        intent: inferIntent(actionName),
        type: 'api',
        location,
        method,
        safety,
        agentSafe: deriveAgentSafe(safety),
        inputs: zodShape ?? {},
        outputs: { type: 'any' },
      });
    }

    // 3e. Server Actions: files with 'use server' directive
    if (this.hasUseServerDirective(sourceFile)) {
      // Named function declarations
      for (const func of sourceFile.getFunctions()) {
        if (!func.isExported()) continue;
        const name = func.getName();
        if (!name || actions.some(a => a.name === name)) continue;

        const jsDocs = func.getJsDocs();
        actions.push(this.parseAnnotatedFunction(name, func as any, jsDocs[0] ?? null, filePath, relativePath));
      }

      // Arrow functions / function expressions in exported variables
      for (const varDecl of sourceFile.getVariableDeclarations()) {
        const stmt = varDecl.getVariableStatement();
        if (!stmt?.isExported()) continue;
        const name = varDecl.getName();
        if (actions.some(a => a.name === name)) continue;

        const init = varDecl.getInitializer();
        if (!init || (!Node.isArrowFunction(init) && !Node.isFunctionExpression(init))) continue;

        const safety = classifySafety({ name, type: 'function' });
        actions.push({
          name,
          description: `Server Action: ${name}`,
          intent: inferIntent(name),
          type: 'function',
          location: `./${relativePath}`,
          safety,
          agentSafe: deriveAgentSafe(safety),
          inputs: this.extractFunctionParams(init as any),
          outputs: { type: 'any' },
        });
      }
    }

    // 3f. Wagmi contract hooks (detectHooks is additive — never overrides annotated actions)
    const hookActions = await this.contractParser.detectHooks(sourceFile);
    for (const hook of hookActions) {
      if (!actions.some(a => a.name === hook.name)) {
        actions.push(hook);
      }
    }

    // 3g. Scan file content for Farcaster SDK capability signals
    try {
      this.capabilityDetector.scanContent(fs.readFileSync(filePath, 'utf8'));
    } catch { /* ignore */ }

    return actions;
  }

  public getAppMetadata(): AppMetadata {
    return this._appMetadata;
  }

  public getCapabilities(): string[] {
    return this.capabilityDetector.getCapabilities();
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────

  private hasUseServerDirective(sourceFile: SourceFile): boolean {
    const text = sourceFile.getFullText().trimStart();
    return text.startsWith("'use server'") || text.startsWith('"use server"');
  }

  /** Detect the HTTP method a Pages-Router handler accepts from req.method checks. */
  private detectHttpMethod(sourceFile: SourceFile): string {
    const methods = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'];
    // Prefer methods seen in inequality guards (req.method !== "POST" means POST is accepted)
    const text = sourceFile.getFullText();
    for (const m of methods) {
      if (text.includes(`!== "${m}"`) || text.includes(`!== '${m}'`)) return m;
    }
    // Fall back to any method string literal present
    for (const m of methods) {
      if (text.includes(`"${m}"`) || text.includes(`'${m}'`)) return m;
    }
    return 'POST';
  }

  /** Derive a clean action name from an App Router route path. */
  private routeNameFromPath(relativePath: string): string {
    return relativePath
      .replace(/^.*app\/api\//, '')
      .replace(/\/route\.[^/]+$/, '')
      .replace(/\[/g, '')
      .replace(/\]/g, '')
      .replace(/\//g, '_') || 'root';
  }

  /** Derive the URL path from an App Router route file path. */
  private routeLocationFromPath(relativePath: string): string {
    return '/' + relativePath
      .replace(/^.*app\/api\//, 'api/')
      .replace(/\/route\.[^/]+$/, '');
  }

  private parseAnnotatedFunction(
    name: string,
    declaration: any,
    jsDoc: JSDoc | null,
    filePath: string,
    relativePath: string
  ): AgentAction {
    const description =
      jsDoc?.getDescription().trim() ||
      jsDoc?.getTags().find(t => t.getTagName() === 'description')?.getComment()?.toString().trim() ||
      `Function ${name}`;

    // Allow @agent-action intent=finance.transfer override
    const intentOverride = jsDoc
      ?.getTags()
      .find(t => t.getTagName() === 'agent-action')
      ?.getComment()
      ?.toString()
      .match(/intent=(\S+)/)?.[1];

    // Allow @agent-action safety=financial override
    const safetyOverride = jsDoc
      ?.getTags()
      .find(t => t.getTagName() === 'agent-action')
      ?.getComment()
      ?.toString()
      .match(/safety=(read|write|financial|destructive)/)?.[1] as any;

    const inputs: Record<string, any> = {};
    if ('getParameters' in declaration) {
      for (const param of declaration.getParameters()) {
        const paramName = param.getName();
        const paramDoc = jsDoc
          ?.getTags()
          .find(t => t.getTagName() === 'param' && (t as any).getName() === paramName);

        inputs[paramName] = {
          type: this.mapType(param.getType()),
          description: paramDoc?.getComment()?.toString().trim() || '',
          required: !param.isOptional(),
        };
      }
    }

    const returnType = 'getReturnType' in declaration ? declaration.getReturnType() : null;
    const safety = safetyOverride ?? classifySafety({ name, type: 'function' });

    return {
      name,
      description,
      intent: inferIntent(name, intentOverride),
      type: 'function',
      location: `./${relativePath}`,
      safety,
      agentSafe: deriveAgentSafe(safety),
      inputs,
      outputs: {
        type: returnType ? this.mapType(returnType) : 'any',
        description:
          jsDoc?.getTags().find(t => t.getTagName() === 'returns')?.getComment()?.toString().trim() || '',
      },
    };
  }

  /** Extract parameter info from an arrow function or function expression node. */
  private extractFunctionParams(func: any): Record<string, any> {
    const params: Record<string, any> = {};
    if (!('getParameters' in func)) return params;
    for (const param of func.getParameters()) {
      params[param.getName()] = {
        type: this.mapType(param.getType()),
        required: !param.isOptional(),
      };
    }
    return params;
  }

  private mapType(type: Type): string {
    if (type.isString()) return 'string';
    if (type.isNumber()) return 'number';
    if (type.isBoolean()) return 'boolean';
    if (type.isArray()) return 'array';
    if (type.isObject()) return 'object';
    return type.getText();
  }
}
