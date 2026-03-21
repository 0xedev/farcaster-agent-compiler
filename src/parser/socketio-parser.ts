import { Project, Node } from 'ts-morph';
import { AgentAction } from '../types';
import { inferIntent, classifySafety, deriveAgentSafe, inferActionAuth } from './intent-classifier';
import * as path from 'path';

/**
 * Parses Socket.IO server files and extracts socket event handlers as agent actions.
 *
 * Detects patterns like:
 *   socket.on("create-room", ({ playerName, fid }: { playerName: string; fid?: number }) => { ... })
 *   socket.on("make-move", async ({ col }: { col: number }) => { ... })
 *
 * Infrastructure events (connection, disconnect, error, etc.) are skipped.
 */

const SKIP_EVENTS = new Set([
  'connection', 'disconnect', 'disconnecting', 'connect',
  'connect_error', 'reconnect', 'reconnect_attempt', 'reconnect_error',
  'reconnect_failed', 'error', 'ping', 'pong', 'close', 'open',
]);

export class SocketIOParser {
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
    const seen = new Set<string>();

    sourceFile.forEachDescendant(node => {
      if (!Node.isCallExpression(node)) return;

      const expr = node.getExpression();
      if (!Node.isPropertyAccessExpression(expr)) return;
      if (expr.getName() !== 'on') return;

      const args = node.getArguments();
      if (args.length < 2) return;

      const eventArg = args[0];
      if (!Node.isStringLiteral(eventArg)) return;

      const eventName = eventArg.getLiteralValue();
      if (SKIP_EVENTS.has(eventName)) return;
      if (seen.has(eventName)) return;
      seen.add(eventName);

      const handler = args[1];
      if (!Node.isArrowFunction(handler) && !Node.isFunctionExpression(handler)) return;

      // Extract description from JSDoc on the handler
      let description = `Socket event: ${eventName}`;
      const jsDocs = (handler as any).getJsDocs?.() ?? [];
      if (jsDocs.length > 0) {
        const text = jsDocs[0].getDescription().trim();
        if (text) description = text;
      }

      const inputs = this.extractInputs(handler);

      // Normalize kebab-case event names to camelCase for intent/safety classification
      const camelName = eventName.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());

      const safety = classifySafety({ name: camelName, type: 'socket' });
      const intent  = inferIntent(camelName);

      actions.push({
        name: eventName,
        description,
        intent,
        type: 'socket',
        location: relativePath,
        socketEvent: eventName,
        safety,
        agentSafe: deriveAgentSafe(safety, camelName),
        requiredAuth: inferActionAuth({ safety, type: 'socket' }),
        parameters: { properties: inputs },
        returns: { type: 'object' },
      } as any);
    });

    return actions;
  }

  private extractInputs(handler: any): Record<string, any> {
    const params = handler.getParameters?.() ?? [];
    if (params.length === 0) return {};

    const firstParam = params[0];
    const bindingPattern = firstParam.getNameNode?.();
    if (!bindingPattern || !Node.isObjectBindingPattern(bindingPattern)) return {};

    // Prefer explicit type annotation on the parameter: ({ col }: { col: number })
    const typeNode = firstParam.getTypeNode?.();
    if (typeNode && Node.isTypeLiteral(typeNode)) {
      const inputs: Record<string, any> = {};
      for (const member of typeNode.getMembers()) {
        if (!Node.isPropertySignature(member)) continue;
        const name = member.getName();
        const optional = member.hasQuestionToken();
        const tsType = member.getTypeNode()?.getText() ?? 'any';
        inputs[name] = {
          type: this.tsTypeToJsonType(tsType),
          required: !optional,
        };
      }
      return inputs;
    }

    // Fallback: read names from the destructuring pattern only (no type info)
    const inputs: Record<string, any> = {};
    for (const element of bindingPattern.getElements()) {
      if (Node.isBindingElement(element)) {
        inputs[element.getName()] = { type: 'any', required: true };
      }
    }
    return inputs;
  }

  private tsTypeToJsonType(ts: string): string {
    const t = ts.trim();
    if (t === 'string') return 'string';
    if (t === 'number' || t === 'bigint') return 'number';
    if (t === 'boolean') return 'boolean';
    return 'object';
  }
}

/** Quick check: does this file look like it registers Socket.IO event handlers? */
export function looksLikeSocketIOFile(content: string): boolean {
  return (
    /socket\.on\s*\(\s*['"`]/.test(content) ||
    /io\.on\s*\(\s*['"`]connection['"`]/.test(content)
  );
}
