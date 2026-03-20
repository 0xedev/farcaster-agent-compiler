"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ZodExtractor = void 0;
const ts_morph_1 = require("ts-morph");
/**
 * Extracts parameter schemas from Zod validators in a source file.
 *
 * Handles patterns like:
 *   const Schema = z.object({ field: z.string().min(1).default('x'), ... })
 *   Schema.safeParse(req.body) / Schema.parse(await request.json())
 */
class ZodExtractor {
    extractSchemas(sourceFile) {
        const schemas = new Map();
        for (const varDecl of sourceFile.getVariableDeclarations()) {
            const init = varDecl.getInitializer();
            if (!init)
                continue;
            const shape = this.tryExtractObjectShape(init);
            if (shape) {
                schemas.set(varDecl.getName(), shape);
            }
        }
        return schemas;
    }
    findUsedSchema(sourceFile, schemas) {
        let found = null;
        sourceFile.forEachDescendant(node => {
            if (found)
                return;
            if (!ts_morph_1.Node.isCallExpression(node))
                return;
            const expr = node.getExpression();
            if (!ts_morph_1.Node.isPropertyAccessExpression(expr))
                return;
            const method = expr.getName();
            if (method !== 'safeParse' && method !== 'parse')
                return;
            const schemaName = expr.getExpression().getText().trim();
            if (schemas.has(schemaName)) {
                found = schemas.get(schemaName);
            }
        });
        return found;
    }
    tryExtractObjectShape(node) {
        const base = this.getZodBase(node);
        if (!base || base.method !== 'object')
            return null;
        const args = base.node.getArguments();
        if (!args.length)
            return null;
        const shapeArg = args[0];
        if (!ts_morph_1.Node.isObjectLiteralExpression(shapeArg))
            return null;
        const shape = {};
        for (const prop of shapeArg.getProperties()) {
            if (!ts_morph_1.Node.isPropertyAssignment(prop))
                continue;
            const init = prop.getInitializer();
            if (init) {
                shape[prop.getName()] = this.extractFieldType(init);
            }
        }
        return shape;
    }
    extractFieldType(node) {
        const isOptional = this.chainContains(node, 'optional') || this.chainContains(node, 'nullish');
        const base = this.getZodBase(node);
        if (!base)
            return { type: 'any', required: !isOptional };
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
    extractConstraints(node, baseType) {
        const constraints = {};
        const isNumeric = baseType === 'number' || baseType === 'bigint';
        this.walkChain(node, (method, callNode) => {
            const args = callNode.getArguments();
            switch (method) {
                case 'min': {
                    const val = this.getNumericArg(args[0]);
                    if (val !== undefined) {
                        if (isNumeric)
                            constraints.minimum = val;
                        else
                            constraints.minLength = val;
                    }
                    break;
                }
                case 'max': {
                    const val = this.getNumericArg(args[0]);
                    if (val !== undefined) {
                        if (isNumeric)
                            constraints.maximum = val;
                        else
                            constraints.maxLength = val;
                    }
                    break;
                }
                case 'gte': {
                    const val = this.getNumericArg(args[0]);
                    if (val !== undefined && isNumeric)
                        constraints.minimum = val;
                    break;
                }
                case 'lte': {
                    const val = this.getNumericArg(args[0]);
                    if (val !== undefined && isNumeric)
                        constraints.maximum = val;
                    break;
                }
                case 'gt': {
                    const val = this.getNumericArg(args[0]);
                    if (val !== undefined && isNumeric)
                        constraints.minimum = val + Number.EPSILON;
                    break;
                }
                case 'lt': {
                    const val = this.getNumericArg(args[0]);
                    if (val !== undefined && isNumeric)
                        constraints.maximum = val - Number.EPSILON;
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
                        if (val !== undefined)
                            constraints.default = val;
                    }
                    break;
                }
                case 'regex': {
                    if (args[0] && ts_morph_1.Node.isRegularExpressionLiteral(args[0])) {
                        const text = args[0].getText();
                        const lastSlash = text.lastIndexOf('/');
                        constraints.pattern = text.slice(1, lastSlash);
                    }
                    break;
                }
                case 'email':
                    constraints.format = 'email';
                    break;
                case 'url':
                    constraints.format = 'uri';
                    break;
                case 'uuid':
                    constraints.format = 'uuid';
                    break;
                case 'datetime':
                    constraints.format = 'date-time';
                    break;
                case 'ip':
                    constraints.format = 'ip';
                    break;
                case 'cuid':
                case 'cuid2':
                case 'ulid':
                    constraints.format = method;
                    break;
            }
        });
        return constraints;
    }
    mapZodMethod(method, node) {
        switch (method) {
            case 'string': return { type: 'string', required: true };
            case 'number': return { type: 'number', required: true };
            case 'boolean': return { type: 'boolean', required: true };
            case 'bigint': return { type: 'number', required: true };
            case 'date': return { type: 'string', format: 'date-time', required: true };
            case 'array': return { type: 'array', required: true };
            case 'object': return { type: 'object', required: true };
            case 'any':
            case 'unknown': return { type: 'any', required: true };
            case 'enum': {
                const args = node.getArguments();
                if (args.length > 0 && ts_morph_1.Node.isArrayLiteralExpression(args[0])) {
                    const values = args[0]
                        .getElements()
                        .filter(ts_morph_1.Node.isStringLiteral)
                        .map(el => el.getLiteralValue());
                    return { type: 'string', enum: values, required: true };
                }
                return { type: 'string', required: true };
            }
            case 'literal': {
                const args = node.getArguments();
                if (args.length > 0) {
                    const val = args[0];
                    if (ts_morph_1.Node.isStringLiteral(val))
                        return { type: 'string', enum: [val.getLiteralValue()], required: true };
                    if (ts_morph_1.Node.isNumericLiteral(val))
                        return { type: 'number', required: true };
                }
                return { type: 'any', required: true };
            }
            case 'union': {
                const args = node.getArguments();
                if (args.length > 0 && ts_morph_1.Node.isArrayLiteralExpression(args[0])) {
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
    getZodBase(node) {
        if (!ts_morph_1.Node.isCallExpression(node))
            return null;
        const expr = node.getExpression();
        if (!ts_morph_1.Node.isPropertyAccessExpression(expr))
            return null;
        const method = expr.getName();
        const obj = expr.getExpression();
        if (obj.getText() === 'z')
            return { method, node };
        return this.getZodBase(obj);
    }
    /** Invoke callback for every method call in the chain (from outermost to innermost). */
    walkChain(node, cb) {
        if (!ts_morph_1.Node.isCallExpression(node))
            return;
        const expr = node.getExpression();
        if (!ts_morph_1.Node.isPropertyAccessExpression(expr))
            return;
        cb(expr.getName(), node);
        this.walkChain(expr.getExpression(), cb);
    }
    chainContains(node, target) {
        if (!ts_morph_1.Node.isCallExpression(node))
            return false;
        const expr = node.getExpression();
        if (!ts_morph_1.Node.isPropertyAccessExpression(expr))
            return false;
        if (expr.getName() === target)
            return true;
        return this.chainContains(expr.getExpression(), target);
    }
    getNumericArg(node) {
        if (!node)
            return undefined;
        if (ts_morph_1.Node.isNumericLiteral(node))
            return Number(node.getLiteralValue());
        // Handle negative literals: -0.01 is PrefixUnaryExpression
        if (ts_morph_1.Node.isPrefixUnaryExpression(node)) {
            const operand = node.getOperand();
            if (ts_morph_1.Node.isNumericLiteral(operand))
                return -Number(operand.getLiteralValue());
        }
        return undefined;
    }
    getLiteralValue(node) {
        // Never embed env var values — store the variable name as a sentinel instead
        const text = node.getText().trim();
        const envMatch = text.match(/process\.env\.([A-Z0-9_]+)/);
        if (envMatch)
            return { $env: envMatch[1] };
        if (ts_morph_1.Node.isStringLiteral(node))
            return node.getLiteralValue();
        if (ts_morph_1.Node.isNumericLiteral(node))
            return Number(node.getLiteralValue());
        if (text === 'true')
            return true;
        if (text === 'false')
            return false;
        if (text === 'null')
            return null;
        return undefined;
    }
}
exports.ZodExtractor = ZodExtractor;
