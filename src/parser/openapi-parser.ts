import * as fs from 'fs';
import { AgentAction } from '../types';
import { inferIntent, classifySafety, deriveAgentSafe, inferActionAuth } from './intent-classifier';
import * as path from 'path';

/**
 * Ingests existing OpenAPI 3.x / Swagger 2.x spec files and converts
 * each operation into an agent action.
 *
 * Supports JSON natively. YAML is supported if `js-yaml` is installed
 * in the target project (optional peer dep — we require() it at runtime
 * so the compiler doesn't hard-depend on it).
 */
export class OpenAPIParser {
  parseFile(filePath: string, projectPath: string): AgentAction[] {
    const content = fs.readFileSync(filePath, 'utf8');
    const spec = this.parseSpec(filePath, content);
    if (!spec) return [];

    // Support both OpenAPI 3.x (paths) and Swagger 2.x (basePath + paths)
    const paths: Record<string, any> = spec.paths ?? {};
    const actions: AgentAction[] = [];

    for (const [routePath, pathItem] of Object.entries(paths)) {
      for (const method of ['get', 'post', 'put', 'patch', 'delete', 'head']) {
        const operation = pathItem[method];
        if (!operation) continue;

        const operationId: string =
          operation.operationId ?? this.pathToActionName(routePath, method);

        const description: string =
          operation.summary ?? operation.description ?? `${method.toUpperCase()} ${routePath}`;

        const httpMethod = method.toUpperCase();
        const safety = classifySafety({ name: operationId, httpMethod, type: 'api' });

        // Extract parameters (path + query + header)
        const props: Record<string, any> = {};
        for (const param of operation.parameters ?? []) {
          props[param.name] = {
            type: param.schema?.type ?? 'string',
            description: param.description,
            required: param.required ?? false,
          };
        }

        // Extract requestBody schema fields (OpenAPI 3.x)
        const bodySchema =
          operation.requestBody?.content?.['application/json']?.schema;
        if (bodySchema?.properties) {
          const required: string[] = bodySchema.required ?? [];
          for (const [field, schema] of Object.entries(bodySchema.properties as Record<string, any>)) {
            props[field] = {
              type: schema.type ?? 'any',
              description: schema.description,
              required: required.includes(field),
            };
          }
        }

        // Derive auth requirement from OpenAPI security field
        const hasSecurity =
          (operation.security && operation.security.length > 0) ||
          (spec.security && spec.security.length > 0);

        actions.push({
          name: operationId,
          description,
          intent: inferIntent(operationId),
          type: 'api',
          location: routePath,
          method: httpMethod,
          safety,
          agentSafe: deriveAgentSafe(safety, operationId),
          requiredAuth: hasSecurity
            ? { required: 'required' }
            : inferActionAuth({ safety, httpMethod, type: 'api' }),
          parameters: { properties: props },
          returns: this.extractOutputSchema(operation),
        });
      }
    }

    return actions;
  }

  private parseSpec(filePath: string, content: string): any {
    // JSON
    if (filePath.endsWith('.json')) {
      try { return JSON.parse(content); } catch { return null; }
    }
    // YAML — optional peer dep
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const yaml = require('js-yaml');
      return yaml.load(content);
    } catch {
      // js-yaml not installed or parse error
      return null;
    }
  }

  private pathToActionName(routePath: string, method: string): string {
    const slug = routePath
      .replace(/^\//, '')
      .replace(/\{([^}]+)\}/g, '_$1')
      .replace(/\//g, '_')
      .replace(/[^a-zA-Z0-9_]/g, '');
    return slug ? `${slug}_${method.toUpperCase()}` : `root_${method.toUpperCase()}`;
  }

  private extractOutputSchema(operation: any): { type: string; description?: string } {
    const response200 =
      operation.responses?.['200'] ?? operation.responses?.['201'];
    if (!response200) return { type: 'any' };
    const schema = response200.content?.['application/json']?.schema;
    return { type: schema?.type ?? 'object', description: response200.description };
  }
}

/** File patterns that contain OpenAPI specs */
export const OPENAPI_PATTERNS = [
  '**/openapi.json',
  '**/openapi.yaml',
  '**/openapi.yml',
  '**/swagger.json',
  '**/swagger.yaml',
  '**/swagger.yml',
  '**/api-spec.json',
  '**/api.json',
];
