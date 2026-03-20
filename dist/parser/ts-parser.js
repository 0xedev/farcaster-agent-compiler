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
exports.TSParser = void 0;
const ts_morph_1 = require("ts-morph");
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
const contract_parser_1 = require("./contract-parser");
const zod_extractor_1 = require("./zod-extractor");
const HTTP_METHODS = new Set(['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS']);
class TSParser {
    projectPath;
    project;
    contractParser;
    zodExtractor;
    constructor(projectPath) {
        this.projectPath = projectPath;
        this.project = new ts_morph_1.Project({
            compilerOptions: { allowJs: true, checkJs: false },
        });
        this.contractParser = new contract_parser_1.ContractParser(projectPath);
        this.zodExtractor = new zod_extractor_1.ZodExtractor();
    }
    async parseFile(filePath) {
        const relativePath = path.relative(this.projectPath, filePath).replace(/\\/g, '/');
        // 1. farcaster.json — extract app metadata, no actions
        if (relativePath.endsWith('farcaster.json')) {
            try {
                const content = JSON.parse(fs.readFileSync(filePath, 'utf8'));
                if (content.frame) {
                    this._appMetadata = {
                        name: content.frame.name,
                        description: content.frame.buttonTitle || `Farcaster App: ${content.frame.name}`,
                    };
                }
            }
            catch { /* ignore */ }
            return [];
        }
        // 2. ABI JSON — delegate entirely to contract parser
        if (filePath.endsWith('.json')) {
            return this.contractParser.parseAbiFile(filePath);
        }
        // 3. TypeScript / TSX
        const sourceFile = this.project.addSourceFileAtPath(filePath);
        const actions = [];
        // 3a. @agent-action JSDoc annotations (highest priority, any file)
        const exported = sourceFile.getExportedDeclarations();
        for (const [name, declarations] of exported) {
            for (const declaration of declarations) {
                if (!('getJsDocs' in declaration))
                    continue;
                const jsDocs = declaration.getJsDocs();
                for (const jsDoc of jsDocs) {
                    if (jsDoc.getTags().some(tag => tag.getTagName() === 'agent-action')) {
                        actions.push(this.parseAnnotatedFunction(name, declaration, jsDoc, filePath, relativePath));
                    }
                }
            }
        }
        // 3b. App Router route handlers: app/api/**/route.(ts|tsx|js|jsx)
        const isAppRouterRoute = /app\/api\/.+\/route\.(ts|tsx|js|jsx)$/.test(relativePath);
        if (isAppRouterRoute) {
            const zodSchemas = this.zodExtractor.extractSchemas(sourceFile);
            const zodShape = this.zodExtractor.findUsedSchema(sourceFile, zodSchemas);
            const parameters = { properties: zodShape ?? {} };
            const routeName = this.routeNameFromPath(relativePath);
            const location = this.routeLocationFromPath(relativePath);
            // export async function POST(request: Request) { ... }
            for (const func of sourceFile.getFunctions()) {
                if (!func.isExported())
                    continue;
                const methodName = func.getName();
                if (!methodName || !HTTP_METHODS.has(methodName))
                    continue;
                if (actions.some(a => a.name === `${routeName}_${methodName}`))
                    continue;
                actions.push({
                    name: `${routeName}_${methodName}`,
                    description: `${methodName} ${location}`,
                    type: 'api',
                    location,
                    method: methodName,
                    parameters,
                    returns: { type: 'any' },
                });
            }
            // export const POST = async (request: Request) => { ... }
            for (const varDecl of sourceFile.getVariableDeclarations()) {
                const methodName = varDecl.getName();
                if (!HTTP_METHODS.has(methodName))
                    continue;
                const stmt = varDecl.getVariableStatement();
                if (!stmt?.isExported())
                    continue;
                if (actions.some(a => a.name === `${routeName}_${methodName}`))
                    continue;
                actions.push({
                    name: `${routeName}_${methodName}`,
                    description: `${methodName} ${location}`,
                    type: 'api',
                    location,
                    method: methodName,
                    parameters,
                    returns: { type: 'any' },
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
            actions.push({
                name: actionName,
                description: `API endpoint at /${relativePath}`,
                type: 'api',
                location,
                method,
                parameters: { properties: zodShape ?? {} },
                returns: { type: 'any' },
            });
        }
        // 3d. Generic non-Next.js API routes: api/**
        const isGenericApiRoute = relativePath.startsWith('api/') && !isAppRouterRoute && !isPagesRoute;
        if (isGenericApiRoute && actions.length === 0) {
            const zodSchemas = this.zodExtractor.extractSchemas(sourceFile);
            const zodShape = this.zodExtractor.findUsedSchema(sourceFile, zodSchemas);
            const method = this.detectHttpMethod(sourceFile);
            const actionName = path.basename(filePath, path.extname(filePath));
            const location = '/' + relativePath.replace(/\.[^/.]+$/, '');
            actions.push({
                name: actionName,
                description: `API endpoint at /${relativePath}`,
                type: 'api',
                location,
                method,
                parameters: { properties: zodShape ?? {} },
                returns: { type: 'any' },
            });
        }
        // 3e. Server Actions: files with 'use server' directive
        if (this.hasUseServerDirective(sourceFile)) {
            // Named function declarations
            for (const func of sourceFile.getFunctions()) {
                if (!func.isExported())
                    continue;
                const name = func.getName();
                if (!name || actions.some(a => a.name === name))
                    continue;
                const jsDocs = func.getJsDocs();
                actions.push(this.parseAnnotatedFunction(name, func, jsDocs[0] ?? null, filePath, relativePath));
            }
            // Arrow functions / function expressions in exported variables
            for (const varDecl of sourceFile.getVariableDeclarations()) {
                const stmt = varDecl.getVariableStatement();
                if (!stmt?.isExported())
                    continue;
                const name = varDecl.getName();
                if (actions.some(a => a.name === name))
                    continue;
                const init = varDecl.getInitializer();
                if (!init || (!ts_morph_1.Node.isArrowFunction(init) && !ts_morph_1.Node.isFunctionExpression(init)))
                    continue;
                actions.push({
                    name,
                    description: `Server Action: ${name}`,
                    type: 'function',
                    location: `./${relativePath}`,
                    parameters: { properties: this.extractFunctionParams(init) },
                    returns: { type: 'any' },
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
        return actions;
    }
    getAppMetadata() {
        return this._appMetadata;
    }
    // ─── Helpers ─────────────────────────────────────────────────────────────
    hasUseServerDirective(sourceFile) {
        const text = sourceFile.getFullText().trimStart();
        return text.startsWith("'use server'") || text.startsWith('"use server"');
    }
    /** Detect the HTTP method a Pages-Router handler accepts from req.method checks. */
    detectHttpMethod(sourceFile) {
        const methods = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'];
        // Prefer methods seen in inequality guards (req.method !== "POST" means POST is accepted)
        const text = sourceFile.getFullText();
        for (const m of methods) {
            if (text.includes(`!== "${m}"`) || text.includes(`!== '${m}'`))
                return m;
        }
        // Fall back to any method string literal present
        for (const m of methods) {
            if (text.includes(`"${m}"`) || text.includes(`'${m}'`))
                return m;
        }
        return 'POST';
    }
    /** Derive a clean action name from an App Router route path. */
    routeNameFromPath(relativePath) {
        return relativePath
            .replace(/^.*app\/api\//, '')
            .replace(/\/route\.[^/]+$/, '')
            .replace(/\[/g, '')
            .replace(/\]/g, '')
            .replace(/\//g, '_') || 'root';
    }
    /** Derive the URL path from an App Router route file path. */
    routeLocationFromPath(relativePath) {
        return '/' + relativePath
            .replace(/^.*app\/api\//, 'api/')
            .replace(/\/route\.[^/]+$/, '');
    }
    parseAnnotatedFunction(name, declaration, jsDoc, filePath, relativePath) {
        const description = jsDoc?.getDescription().trim() ||
            jsDoc?.getTags().find(t => t.getTagName() === 'description')?.getComment()?.toString().trim() ||
            `Function ${name}`;
        const parameters = {};
        if ('getParameters' in declaration) {
            for (const param of declaration.getParameters()) {
                const paramName = param.getName();
                const paramDoc = jsDoc
                    ?.getTags()
                    .find(t => t.getTagName() === 'param' && t.getName() === paramName);
                parameters[paramName] = {
                    type: this.mapType(param.getType()),
                    description: paramDoc?.getComment()?.toString().trim() || '',
                    required: !param.isOptional(),
                };
            }
        }
        const returnType = 'getReturnType' in declaration ? declaration.getReturnType() : null;
        return {
            name,
            description,
            type: 'function',
            location: `./${relativePath}`,
            parameters: { properties: parameters },
            returns: {
                type: returnType ? this.mapType(returnType) : 'any',
                description: jsDoc?.getTags().find(t => t.getTagName() === 'returns')?.getComment()?.toString().trim() || '',
            },
        };
    }
    /** Extract parameter info from an arrow function or function expression node. */
    extractFunctionParams(func) {
        const params = {};
        if (!('getParameters' in func))
            return params;
        for (const param of func.getParameters()) {
            params[param.getName()] = {
                type: this.mapType(param.getType()),
                required: !param.isOptional(),
            };
        }
        return params;
    }
    mapType(type) {
        if (type.isString())
            return 'string';
        if (type.isNumber())
            return 'number';
        if (type.isBoolean())
            return 'boolean';
        if (type.isArray())
            return 'array';
        if (type.isObject())
            return 'object';
        return type.getText();
    }
}
exports.TSParser = TSParser;
