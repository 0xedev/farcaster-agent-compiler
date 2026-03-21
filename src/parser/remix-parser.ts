import { Project, Node } from 'ts-morph';
import { AgentAction } from '../types';
import { inferIntent, classifySafety, deriveAgentSafe, inferActionAuth } from './intent-classifier';
import * as path from 'path';

/**
 * Parses Remix route files and extracts `action` and `loader` exports.
 *
 * Remix v2 file-based routing:
 *   app/routes/users.tsx         → /users
 *   app/routes/users.$id.tsx     → /users/:id
 *   app/routes/_index.tsx        → /  (layout route — leading _ stripped)
 *   app/routes/users.$id.edit.tsx → /users/:id/edit
 *
 * - `loader`  export → GET  (read)
 * - `action`  export → POST (write)
 */
export class RemixParser {
  private project: Project;

  constructor(sharedProject?: Project) {
    this.project = sharedProject ?? new Project({
      compilerOptions: { allowJs: true, checkJs: false },
    });
  }

  async parseFile(filePath: string, projectPath: string): Promise<AgentAction[]> {
    const sourceFile = this.project.addSourceFileAtPath(filePath);
    const routePath = this.filePathToRoute(filePath, projectPath);
    const actions: AgentAction[] = [];

    // Look for: export async function action / export async function loader
    // or: export const action = async ({ request }) => { ... }
    const exportedNames = this.getExportedNames(sourceFile);

    for (const exportName of exportedNames) {
      if (exportName !== 'action' && exportName !== 'loader') continue;

      const httpMethod = exportName === 'loader' ? 'GET' : 'POST';
      const actionName = this.routeToActionName(routePath, exportName);
      const safety = classifySafety({ name: actionName, httpMethod, type: 'api' });

      actions.push({
        name: actionName,
        description: `Remix ${exportName}: ${httpMethod} ${routePath}`,
        intent: inferIntent(actionName),
        type: 'api',
        location: routePath,
        method: httpMethod,
        safety,
        agentSafe: deriveAgentSafe(safety),
        requiredAuth: inferActionAuth({ safety, httpMethod, type: 'api' }),
        inputs: this.extractRouteParams(routePath),
        outputs: { type: 'object' },
      });
    }

    return actions;
  }

  private getExportedNames(sourceFile: any): string[] {
    const names: string[] = [];

    // export function name / export async function name
    for (const fn of sourceFile.getFunctions()) {
      if (fn.isExported()) names.push(fn.getName() ?? '');
    }

    // export const name = ...
    for (const varStatement of sourceFile.getVariableStatements()) {
      if (!varStatement.isExported()) continue;
      for (const decl of varStatement.getDeclarations()) {
        names.push(decl.getName());
      }
    }

    return names.filter(Boolean);
  }

  /**
   * Convert a Remix v2 file path to a URL route path.
   *
   * Rules:
   *  - Strip leading `app/routes/` prefix
   *  - Strip file extension
   *  - Split on `.` → each segment becomes a path segment
   *  - `$param` → `:param`
   *  - Segments starting with `_` are layout markers — skip (unless it's the whole segment)
   *  - `_index` → empty (index route)
   */
  filePathToRoute(filePath: string, projectPath: string): string {
    const rel = path.relative(projectPath, filePath).replace(/\\/g, '/');
    // Strip known prefix variations: app/routes/, routes/
    const withoutPrefix = rel
      .replace(/^.*?(?:app\/routes|routes)\//, '')
      .replace(/\.[jt]sx?$/, '');

    const segments = withoutPrefix.split('.');
    const routeSegments: string[] = [];

    for (const seg of segments) {
      if (seg === '_index') continue;          // index route
      if (seg.startsWith('_')) continue;       // layout route (e.g. _auth, _app)
      routeSegments.push(seg.replace(/^\$/, ':'));  // $id → :id
    }

    return '/' + routeSegments.join('/');
  }

  private routeToActionName(routePath: string, exportName: string): string {
    const slug = routePath
      .replace(/^\//, '')
      .replace(/\/:([^/]+)/g, '_$1')
      .replace(/\//g, '_')
      .replace(/[^a-zA-Z0-9_]/g, '');
    return slug ? `${slug}_${exportName}` : `root_${exportName}`;
  }

  private extractRouteParams(routePath: string): Record<string, any> {
    const params: Record<string, any> = {};
    for (const match of routePath.matchAll(/:([a-zA-Z][a-zA-Z0-9_]*)/g)) {
      params[match[1]] = { type: 'string', description: `Path parameter: ${match[1]}`, required: true };
    }
    return params;
  }
}

export function looksLikeRemixRouteFile(content: string): boolean {
  return (
    (content.includes('export') && content.includes('function loader')) ||
    (content.includes('export') && content.includes('function action')) ||
    content.includes('LoaderFunctionArgs') ||
    content.includes('ActionFunctionArgs') ||
    content.includes('LoaderFunction') ||
    content.includes('ActionFunction')
  );
}
