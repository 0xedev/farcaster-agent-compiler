import { Project, Node } from 'ts-morph';
import { AgentAction } from '../types';
import { inferIntent, classifySafety, deriveAgentSafe, inferActionAuth } from './intent-classifier';
import * as path from 'path';

/**
 * Parses raw WebSocket servers (the `ws` npm package) and extracts
 * message type handlers as agent actions.
 *
 * Detects:
 *   // ws library
 *   const wss = new WebSocketServer({ port: 8080 })
 *   wss.on('connection', (ws) => {
 *     ws.on('message', (data) => {
 *       const { type, payload } = JSON.parse(data)
 *       if (type === 'ping') { ... }
 *       switch (type) { case 'chat': ... }
 *     })
 *   })
 *
 * When individual message types are discriminated by a `type` / `action`
 * string field, each branch is emitted as a separate action. Otherwise
 * a single `ws_message` action is emitted for the whole handler.
 */
export class WebSocketParser {
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
      if (eventArg.getLiteralValue() !== 'message') return;

      const handler = args[1];
      if (!Node.isArrowFunction(handler) && !Node.isFunctionExpression(handler)) return;

      // Try to detect discriminated message types inside the handler body
      const messageTypes = this.extractMessageTypes(handler);

      if (messageTypes.length > 0) {
        for (const msgType of messageTypes) {
          if (seen.has(msgType)) continue;
          seen.add(msgType);

          const safety = classifySafety({ name: msgType, type: 'socket' });
          actions.push({
            name: msgType,
            description: `WebSocket message type: ${msgType}`,
            intent: inferIntent(msgType),
            type: 'socket',
            location: relativePath,
            socketEvent: msgType,
            safety,
            agentSafe: deriveAgentSafe(safety),
            requiredAuth: inferActionAuth({ safety, type: 'socket' }),
            inputs: { type: { type: 'string', required: true }, payload: { type: 'object', required: false } },
            outputs: { type: 'object' },
          } as any);
        }
      } else {
        // Generic message handler — emit a single action
        const name = 'ws_message';
        if (!seen.has(name)) {
          seen.add(name);
          actions.push({
            name,
            description: 'Raw WebSocket message handler',
            intent: 'util.action',
            type: 'socket',
            location: relativePath,
            socketEvent: 'message',
            safety: 'write',
            agentSafe: true,
            requiredAuth: inferActionAuth({ safety: 'write', type: 'socket' }),
            inputs: { data: { type: 'string', required: true } },
            outputs: { type: 'object' },
          } as any);
        }
      }
    });

    return actions;
  }

  /**
   * Look inside the message handler body for discriminated type patterns:
   *   if (type === 'chat')  →  extracts 'chat'
   *   switch (type) { case 'ping':  →  extracts 'ping'
   *   if (msg.type === 'join')  →  extracts 'join'
   */
  private extractMessageTypes(handler: any): string[] {
    const types: string[] = [];
    const body = handler.getBody?.();
    if (!body) return types;

    const text = body.getText();

    // switch (type) { case 'value': ... }
    for (const match of text.matchAll(/case\s+['"`]([^'"`]+)['"`]\s*:/g)) {
      types.push(match[1]);
    }

    // if (type === 'value') or if (msg.type === 'value')
    for (const match of text.matchAll(/(?:type|action|event)\s*(?:===?|==)\s*['"`]([^'"`]+)['"`]/g)) {
      if (!types.includes(match[1])) types.push(match[1]);
    }

    // Filter out framework noise
    return types.filter(t => t !== 'message' && t !== 'error' && t !== 'close' && t !== 'open');
  }
}

export function looksLikeWebSocketFile(content: string): boolean {
  return (
    content.includes('WebSocketServer') ||
    content.includes('new WebSocket.Server') ||
    (content.includes("'ws'") && content.includes(".on('message'")) ||
    (content.includes('"ws"') && content.includes('.on("message"'))
  );
}
