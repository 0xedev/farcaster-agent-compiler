import { Project, Node, SourceFile } from 'ts-morph';
import { AgentAction } from '../types';
import { inferIntent, classifySafety, deriveAgentSafe } from './intent-classifier';
import * as path from 'path';

/**
 * Parses Express, Hono, and Fastify route definitions.
 *
 * Detects patterns like:
 *   // Express / Express Router
 *   app.get('/api/users', handler)
 *   router.post('/api/payments', handler)
 *
 *   // Hono
 *   app.get('/api/users', (c) => { ... })
 *   const app = new Hono()
 *
 *   // Fastify
 *   fastify.get('/api/users', handler)
 *   app.register(fastifyPlugin)
 */

const HTTP_METHODS = ['get', 'post', 'put', 'delete', 'patch', 'head', 'options', 'all'];
const HTTP_METHODS_UPPER: Record<string, string> = {
  get: 'GET', post: 'POST', put: 'PUT', delete: 'DELETE',
  patch: 'PATCH', head: 'HEAD', options: 'OPTIONS', all: 'POST',
};

export class ExpressParser {
  private project: Project;

  constructor() {
    this.project = new Project({
      compilerOptions: { allowJs: true, checkJs: false },
    });
  }

  async parseFile(filePath: string, projectPath: string): Promise<AgentAction[]> {
    const sourceFile = this.project.addSourceFileAtPath(filePath);
    const relativePath = path.relative(projectPath, filePath).replace(/\\/g, '/');
    const actions: AgentAction[] = [];

    // Walk all call expressions looking for app.METHOD / router.METHOD / fastify.METHOD
    sourceFile.forEachDescendant(node => {
      if (!Node.isCallExpression(node)) return;

      const expr = node.getExpression();
      if (!Node.isPropertyAccessExpression(expr)) return;

      const methodName = expr.getName().toLowerCase();
      if (!HTTP_METHODS.includes(methodName)) return;

      const args = node.getArguments();
      if (args.length < 2) return;

      // First arg must be a string literal route path
      const routeArg = args[0];
      if (!Node.isStringLiteral(routeArg)) return;

      const routePath = routeArg.getLiteralValue();
      if (!routePath.startsWith('/')) return;

      const httpMethod = HTTP_METHODS_UPPER[methodName];
      const actionName = this.routeToActionName(routePath, httpMethod);
      if (actions.some(a => a.name === actionName)) return;

      // Extract JSDoc from the handler if it's an inline function
      let description = `${httpMethod} ${routePath}`;
      const handler = args[args.length - 1];
      if (Node.isArrowFunction(handler) || Node.isFunctionExpression(handler)) {
        const jsDocs = (handler as any).getJsDocs?.() ?? [];
        if (jsDocs.length > 0) {
          description = jsDocs[0].getDescription().trim() || description;
        }
      }

      const safety = classifySafety({ name: actionName, httpMethod, type: 'api' });
      actions.push({
        name: actionName,
        description,
        intent: inferIntent(actionName),
        type: 'api',
        location: routePath,
        method: httpMethod,
        safety,
        agentSafe: deriveAgentSafe(safety),
        inputs: this.extractRouteParams(routePath),
        outputs: { type: 'any' },
      });
    });

    return actions;
  }

  /** Convert a route path like /api/users/:id to a snake_case action name */
  private routeToActionName(routePath: string, method: string): string {
    const slug = routePath
      .replace(/^\//, '')
      .replace(/\/:([^/]+)/g, '_$1')   // :param → _param
      .replace(/\//g, '_')
      .replace(/[^a-zA-Z0-9_]/g, '');
    return slug ? `${slug}_${method}` : `root_${method}`;
  }

  /** Extract path params like :id, :userId as required string inputs */
  private extractRouteParams(routePath: string): Record<string, any> {
    const params: Record<string, any> = {};
    const matches = routePath.matchAll(/:([a-zA-Z][a-zA-Z0-9_]*)/g);
    for (const match of matches) {
      params[match[1]] = {
        type: 'string',
        description: `Path parameter: ${match[1]}`,
        required: true,
      };
    }
    return params;
  }
}

/**
 * Quick check: does this file look like it registers Express/Hono/Fastify routes?
 * Used by DiscoveryService to filter files before expensive AST parsing.
 */
export function looksLikeRouteFile(content: string): boolean {
  return (
    // Express / Hono app method calls
    /\.(get|post|put|delete|patch)\s*\(\s*['"`]\//.test(content) ||
    // Fastify route registration
    /fastify\.(get|post|put|delete|patch)\s*\(/.test(content) ||
    // Hono new Hono()
    /new\s+Hono\s*\(/.test(content) ||
    // Express Router
    /Router\s*\(\s*\)/.test(content) ||
    /express\.Router/.test(content)
  );
}
