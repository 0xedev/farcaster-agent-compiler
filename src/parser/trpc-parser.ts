import { Project, Node } from 'ts-morph';
import { AgentAction } from '../types';
import { inferIntent, classifySafety, deriveAgentSafe, inferActionAuth } from './intent-classifier';
import * as path from 'path';

/**
 * Parses tRPC router files and extracts procedures as agent actions.
 *
 * Detects patterns like:
 *   export const userRouter = createTRPCRouter({
 *     list:   publicProcedure.query(({ ctx }) => { ... }),
 *     create: protectedProcedure.input(z.object({ name: z.string() })).mutation(({ ctx, input }) => { ... }),
 *   });
 */
export class TRPCParser {
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

      const methodName = expr.getName();
      if (methodName !== 'query' && methodName !== 'mutation' && methodName !== 'subscription') return;

      // Walk up to find the PropertyAssignment that gives us the procedure name.
      // Structure: createTRPCRouter({ procedureName: procedure.input(...).query(handler) })
      const propAssignment = node.getFirstAncestorByKind(147 /* SyntaxKind.PropertyAssignment */);
      if (!propAssignment) return;

      const procedureName = (propAssignment as any).getName?.()?.replace(/['"]/g, '') ?? '';
      if (!procedureName || seen.has(procedureName)) return;
      seen.add(procedureName);

      // Determine if protected (auth required) by scanning the chain text
      const chainText = expr.getExpression().getText();
      const isProtected =
        /protected|authed|private|admin|requireAuth/i.test(chainText);

      // Description from JSDoc on the PropertyAssignment
      let description = `tRPC ${methodName}: ${procedureName}`;
      const jsDocs = (propAssignment as any).getJsDocs?.() ?? [];
      if (jsDocs.length > 0) {
        const text = jsDocs[0].getDescription?.().trim();
        if (text) description = text;
      }

      // Extract inputs from .input(z.object({...})) in the chain
      const inputs = this.extractInputsFromChain(expr.getExpression());

      // query → GET semantics, mutation → POST, subscription → streaming
      const httpLike = methodName === 'query' ? 'GET' : 'POST';
      const safety = classifySafety({ name: procedureName, httpMethod: httpLike, type: 'function' });

      actions.push({
        name: procedureName,
        description,
        intent: inferIntent(procedureName),
        type: 'function',
        location: relativePath,
        method: methodName,
        safety,
        agentSafe: deriveAgentSafe(safety),
        requiredAuth: inferActionAuth({
          safety,
          httpMethod: httpLike,
          appAuthType: isProtected ? 'bearer' : undefined,
          type: 'function',
        }),
        inputs,
        outputs: { type: 'object' },
      });
    });

    return actions;
  }

  /**
   * Walk the call expression chain (e.g. procedure.use(mid).input(schema).query(handler))
   * looking for an .input(zodObject) call and extract its fields.
   */
  private extractInputsFromChain(chainExpr: any): Record<string, any> {
    // Traverse the chain: each link is a PropertyAccessExpression whose object
    // is another CallExpression.  We're looking for the one named "input".
    let current = chainExpr;
    while (current) {
      if (Node.isCallExpression(current)) {
        const callExpr = current as any;
        const callCallee = callExpr.getExpression?.();
        if (Node.isPropertyAccessExpression(callCallee) && callCallee.getName() === 'input') {
          const inputArg = callExpr.getArguments?.()[0];
          if (inputArg) return this.extractZodObjectFields(inputArg);
        }
        current = callExpr.getExpression?.();
      } else if (Node.isPropertyAccessExpression(current)) {
        current = (current as any).getExpression?.();
      } else {
        break;
      }
    }
    return {};
  }

  /** Extract field names/types from a z.object({ ... }) argument node. */
  private extractZodObjectFields(node: any): Record<string, any> {
    if (!Node.isCallExpression(node)) return {};
    const callee = node.getExpression();
    if (!Node.isPropertyAccessExpression(callee) || callee.getName() !== 'object') return {};

    const arg = node.getArguments()[0];
    if (!Node.isObjectLiteralExpression(arg)) return {};

    const inputs: Record<string, any> = {};
    for (const prop of arg.getProperties()) {
      if (!Node.isPropertyAssignment(prop)) continue;
      const name = (prop as any).getName().replace(/['"]/g, '');
      const valText = prop.getInitializer()?.getText() ?? '';
      const optional = valText.includes('.optional()') || valText.includes('.nullish()');
      inputs[name] = {
        type: this.inferZodType(valText),
        required: !optional,
      };
    }
    return inputs;
  }

  private inferZodType(zodText: string): string {
    if (/z\.string/i.test(zodText)) return 'string';
    if (/z\.number|z\.int/i.test(zodText)) return 'number';
    if (/z\.boolean/i.test(zodText)) return 'boolean';
    if (/z\.array/i.test(zodText)) return 'array';
    if (/z\.object/i.test(zodText)) return 'object';
    if (/z\.enum/i.test(zodText)) return 'string';
    return 'any';
  }
}

export function looksLikeTRPCFile(content: string): boolean {
  return (
    content.includes('createTRPCRouter') ||
    content.includes('initTRPC') ||
    content.includes('publicProcedure') ||
    content.includes('protectedProcedure') ||
    (content.includes('.query(') && content.includes('procedure'))
  );
}
