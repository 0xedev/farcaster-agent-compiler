import { Project, Node } from 'ts-morph';
import { AgentAction } from '../types';
import { inferIntent, deriveAgentSafe, inferActionAuth } from './intent-classifier';
import * as path from 'path';

/**
 * Detects Server-Sent Event (SSE) streaming endpoints.
 *
 * Patterns detected:
 *   // Express
 *   res.setHeader('Content-Type', 'text/event-stream')
 *   res.writeHead(200, { 'Content-Type': 'text/event-stream' })
 *
 *   // Next.js App Router (route handler)
 *   return new Response(stream, { headers: { 'Content-Type': 'text/event-stream' } })
 *   return new StreamingTextResponse(stream)
 *
 *   // AI SDK
 *   return result.toDataStreamResponse()
 *   return result.toTextStreamResponse()
 *
 * SSE endpoints are classified as 'read' safety + streaming output.
 */
export class SSEParser {
  private project: Project;

  constructor(sharedProject?: Project) {
    this.project = sharedProject ?? new Project({
      compilerOptions: { allowJs: true, checkJs: false },
    });
  }

  async parseFile(filePath: string, projectPath: string): Promise<AgentAction[]> {
    const sourceFile = this.project.addSourceFileAtPath(filePath);
    const relativePath = './' + path.relative(projectPath, filePath).replace(/\\/g, '/');
    const actions: AgentAction[] = [];

    // Collect functions/arrow-fns that contain SSE signals
    const sseFunctions = new Set<any>();

    sourceFile.forEachDescendant(node => {
      if (!this.isSSESignal(node)) return;

      // Walk up to the nearest function/arrow/method to name the action
      const fn =
        node.getFirstAncestorByKind(213 /* ArrowFunction */) ??
        node.getFirstAncestorByKind(259 /* FunctionDeclaration */) ??
        node.getFirstAncestorByKind(171 /* MethodDeclaration */) ??
        node.getFirstAncestorByKind(215 /* FunctionExpression */);

      if (fn && !sseFunctions.has(fn)) {
        sseFunctions.add(fn);
      }
    });

    for (const fn of sseFunctions) {
      const name = this.resolveFunctionName(fn, filePath);
      const safety = 'read' as const;

      actions.push({
        name,
        description: `Streaming SSE endpoint — ${path.basename(filePath)}`,
        intent: inferIntent(name),
        type: 'api',
        location: relativePath,
        method: 'GET',
        safety,
        agentSafe: deriveAgentSafe(safety, name),
        requiredAuth: inferActionAuth({ safety, httpMethod: 'GET', type: 'api' }),
        parameters: { properties: {} },
        returns: { type: 'stream', description: 'Server-Sent Events stream' },
      });
    }

    return actions;
  }

  private isSSESignal(node: any): boolean {
    if (Node.isStringLiteral(node)) {
      return node.getLiteralValue() === 'text/event-stream';
    }
    if (Node.isCallExpression(node)) {
      const text = node.getText();
      return (
        text.includes('toDataStreamResponse') ||
        text.includes('toTextStreamResponse') ||
        text.includes('toUIMessageStreamResponse') ||
        text.includes('StreamingTextResponse')
      );
    }
    return false;
  }

  private resolveFunctionName(fn: any, filePath: string): string {
    // Named function declaration
    const decl = fn.getName?.();
    if (decl) return decl;

    // Arrow function assigned to a variable
    const varDecl = fn.getFirstAncestorByKind(249 /* VariableDeclaration */);
    if (varDecl) {
      const varName = (varDecl as any).getName?.();
      if (varName) return varName;
    }

    // Fallback: derive from filename
    const base = path.basename(filePath, path.extname(filePath));
    return `${base}_stream`;
  }
}

export function looksLikeSSEFile(content: string): boolean {
  return (
    content.includes('text/event-stream') ||
    content.includes('toDataStreamResponse') ||
    content.includes('toTextStreamResponse') ||
    content.includes('toUIMessageStreamResponse') ||
    content.includes('StreamingTextResponse') ||
    content.includes('event-stream')
  );
}
