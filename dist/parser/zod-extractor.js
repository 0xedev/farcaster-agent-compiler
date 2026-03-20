"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ZodExtractor = void 0;
const ts_morph_1 = require("ts-morph");
/**
 * Extracts parameter schemas from Zod validators in a source file.
 *
 * Handles patterns like:
 *   const Schema = z.object({ field: z.string(), ... })
 *   Schema.safeParse(req.body) / Schema.parse(await request.json())
 */
class ZodExtractor {
    /**
     * Find all z.object(...) variable declarations in the file.
     * Returns a map of variable name -> extracted field schemas.
     */
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
    /**
     * Find which schema is used in `.safeParse(...)` or `.parse(...)` calls in the file.
     * Returns the schema's field map, or null if none found.
     */
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
        return result;
    }
    mapZodMethod(method, node) {
        switch (method) {
            case 'string': return { type: 'string', required: true };
            case 'number': return { type: 'number', required: true };
            case 'boolean': return { type: 'boolean', required: true };
            case 'bigint': return { type: 'number', required: true };
            case 'date': return { type: 'string', description: 'ISO date string', required: true };
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
    /**
     * Walk a Zod chain (z.string().min(1).optional()) back to the root z.*() call.
     */
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
        // Chained: z.string().min(1) — walk into the receiver
        return this.getZodBase(obj);
    }
    /**
     * Check whether a Zod chain contains a specific method name (e.g. 'optional').
     */
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
}
exports.ZodExtractor = ZodExtractor;
