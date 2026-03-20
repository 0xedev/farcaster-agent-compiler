import { Node, SourceFile, CallExpression } from 'ts-morph';
import { ParameterProperty } from '../types';

export type ZodFieldSchema = ParameterProperty & { required: boolean };

/**
 * Extracts parameter schemas from Zod validators in a source file.
 *
 * Handles patterns like:
 *   const Schema = z.object({ field: z.string().min(1).default('x'), ... })
 *   Schema.safeParse(req.body) / Schema.parse(await request.json())
 */
export class ZodExtractor {
  extractSchemas(sourceFile: SourceFile): Map<string, Record<string, ZodFieldSchema>> {
    const schemas = new Map<string, Record<string, ZodFieldSchema>>();

    for (const varDecl of sourceFile.getVariableDeclarations()) {
      const init = varDecl.getInitializer();
      if (!init) continue;

      const shape = this.tryExtractObjectShape(init);
      if (shape) {
        schemas.set(varDecl.getName(), shape);
      }
    }

    return schemas;
  }

  findUsedSchema(
    sourceFile: SourceFile,
    schemas: Map<string, Record<string, ZodFieldSchema>>
  ): Record<string, ZodFieldSchema> | null {
    let found: Record<string, ZodFieldSchema> | null = null;

    sourceFile.forEachDescendant(node => {
      if (found) return;
      if (!Node.isCallExpression(node)) return;

      const expr = node.getExpression();
      if (!Node.isPropertyAccessExpression(expr)) return;

      const method = expr.getName();
      if (method !== 'safeParse' && method !== 'parse') return;

      const schemaName = expr.getExpression().getText().trim();
      if (schemas.has(schemaName)) {
        found = schemas.get(schemaName)!;
      }
    });

    return found;
  }

  private tryExtractObjectShape(node: Node): Record<string, ZodFieldSchema> | null {
    const base = this.getZodBase(node);
    if (!base || base.method !== 'object') return null;

    const args = base.node.getArguments();
    if (!args.length) return null;

    const shapeArg = args[0];
    if (!Node.isObjectLiteralExpression(shapeArg)) return null;

    const shape: Record<string, ZodFieldSchema> = {};
    for (const prop of shapeArg.getProperties()) {
      if (!Node.isPropertyAssignment(prop)) continue;
      const init = prop.getInitializer();
      if (init) {
        shape[prop.getName()] = this.extractFieldType(init);
      }
    }

    return shape;
  }

  private extractFieldType(node: Node): ZodFieldSchema {
    const isOptional = this.chainContains(node, 'optional') || this.chainContains(node, 'nullish');
    const base = this.getZodBase(node);
    if (!base) return { type: 'any', required: !isOptional };

    const result = this.mapZodMethod(base.method, base.node);
    result.required = !isOptional;

    // Walk the full chain to collect constraints
    const constraints = this.extractConstraints(node, base.method);
    Object.assign(result, constraints);

    return result;
  }

  /**
   * Walk every method in the Zod chain to collect constraints:
   * min, max, length, default, regex, email, url, uuid, datetime.
   */
  private extractConstraints(node: Node, baseType: string): Partial<ZodFieldSchema> {
    const constraints: Partial<ZodFieldSchema> = {};
    const isNumeric = baseType === 'number' || baseType === 'bigint';

    this.walkChain(node, (method, callNode) => {
      const args = callNode.getArguments();

      switch (method) {
        case 'min': {
          const val = this.getNumericArg(args[0]);
          if (val !== undefined) {
            if (isNumeric) constraints.minimum = val;
            else constraints.minLength = val;
          }
          break;
        }
        case 'max': {
          const val = this.getNumericArg(args[0]);
          if (val !== undefined) {
            if (isNumeric) constraints.maximum = val;
            else constraints.maxLength = val;
          }
          break;
        }
        case 'gte': {
          const val = this.getNumericArg(args[0]);
          if (val !== undefined && isNumeric) constraints.minimum = val;
          break;
        }
        case 'lte': {
          const val = this.getNumericArg(args[0]);
          if (val !== undefined && isNumeric) constraints.maximum = val;
          break;
        }
        case 'gt': {
          const val = this.getNumericArg(args[0]);
          if (val !== undefined && isNumeric) constraints.minimum = val + Number.EPSILON;
          break;
        }
        case 'lt': {
          const val = this.getNumericArg(args[0]);
          if (val !== undefined && isNumeric) constraints.maximum = val - Number.EPSILON;
          break;
        }
        case 'length': {
          const val = this.getNumericArg(args[0]);
          if (val !== undefined) {
            constraints.minLength = val;
            constraints.maxLength = val;
          }
          break;
        }
        case 'default': {
          if (args[0]) {
            const val = this.getLiteralValue(args[0]);
            if (val !== undefined) constraints.default = val;
          }
          break;
        }
        case 'regex': {
          if (args[0] && Node.isRegularExpressionLiteral(args[0])) {
            const text = args[0].getText();
            const lastSlash = text.lastIndexOf('/');
            constraints.pattern = text.slice(1, lastSlash);
          }
          break;
        }
        case 'email':    constraints.format = 'email';     break;
        case 'url':      constraints.format = 'uri';       break;
        case 'uuid':     constraints.format = 'uuid';      break;
        case 'datetime': constraints.format = 'date-time'; break;
        case 'ip':       constraints.format = 'ip';        break;
        case 'cuid':
        case 'cuid2':
        case 'ulid':     constraints.format = method;      break;
      }
    });

    return constraints;
  }

  private mapZodMethod(method: string, node: CallExpression): ZodFieldSchema {
    switch (method) {
      case 'string':  return { type: 'string', required: true };
      case 'number':  return { type: 'number', required: true };
      case 'boolean': return { type: 'boolean', required: true };
      case 'bigint':  return { type: 'number', required: true };
      case 'date':    return { type: 'string', format: 'date-time', required: true };
      case 'array':   return { type: 'array', required: true };
      case 'object':  return { type: 'object', required: true };
      case 'any':
      case 'unknown': return { type: 'any', required: true };

      case 'enum': {
        const args = node.getArguments();
        if (args.length > 0 && Node.isArrayLiteralExpression(args[0])) {
          const values = args[0]
            .getElements()
            .filter(Node.isStringLiteral)
            .map(el => el.getLiteralValue());
          return { type: 'string', enum: values, required: true };
        }
        return { type: 'string', required: true };
      }

      case 'literal': {
        const args = node.getArguments();
        if (args.length > 0) {
          const val = args[0];
          if (Node.isStringLiteral(val)) return { type: 'string', enum: [val.getLiteralValue()], required: true };
          if (Node.isNumericLiteral(val)) return { type: 'number', required: true };
        }
        return { type: 'any', required: true };
      }

      case 'union': {
        const args = node.getArguments();
        if (args.length > 0 && Node.isArrayLiteralExpression(args[0])) {
          const types = args[0].getElements().map(el => this.extractFieldType(el).type);
          const unique = [...new Set(types)];
          return { type: unique.length === 1 ? unique[0] : 'string', required: true };
        }
        return { type: 'string', required: true };
      }

      default:
        return { type: 'string', required: true };
    }
  }

  /** Walk a Zod chain back to the root z.*() call. */
  private getZodBase(node: Node): { method: string; node: CallExpression } | null {
    if (!Node.isCallExpression(node)) return null;

    const expr = node.getExpression();
    if (!Node.isPropertyAccessExpression(expr)) return null;

    const method = expr.getName();
    const obj = expr.getExpression();

    if (obj.getText() === 'z') return { method, node };

    return this.getZodBase(obj);
  }

  /** Invoke callback for every method call in the chain (from outermost to innermost). */
  private walkChain(node: Node, cb: (method: string, callNode: CallExpression) => void): void {
    if (!Node.isCallExpression(node)) return;

    const expr = node.getExpression();
    if (!Node.isPropertyAccessExpression(expr)) return;

    cb(expr.getName(), node as CallExpression);
    this.walkChain(expr.getExpression(), cb);
  }

  private chainContains(node: Node, target: string): boolean {
    if (!Node.isCallExpression(node)) return false;

    const expr = node.getExpression();
    if (!Node.isPropertyAccessExpression(expr)) return false;

    if (expr.getName() === target) return true;
    return this.chainContains(expr.getExpression(), target);
  }

  private getNumericArg(node: Node | undefined): number | undefined {
    if (!node) return undefined;
    if (Node.isNumericLiteral(node)) return Number(node.getLiteralValue());
    // Handle negative literals: -0.01 is PrefixUnaryExpression
    if (Node.isPrefixUnaryExpression(node)) {
      const operand = node.getOperand();
      if (Node.isNumericLiteral(operand)) return -Number(operand.getLiteralValue());
    }
    return undefined;
  }

  private getLiteralValue(node: Node): any {
    if (Node.isStringLiteral(node)) return node.getLiteralValue();
    if (Node.isNumericLiteral(node)) return Number(node.getLiteralValue());
    const text = node.getText();
    if (text === 'true') return true;
    if (text === 'false') return false;
    if (text === 'null') return null;
    return undefined;
  }
}
