import * as fs from 'fs';
import { AgentAction } from '../types';
import { deriveAgentSafe, inferActionAuth } from './intent-classifier';

/**
 * Reads a Prisma schema file and infers CRUD agent actions for every model.
 *
 * For a model named `User` it emits:
 *   listUsers    → data.read    (GET-like)
 *   getUser      → data.read    (GET-like, by id)
 *   createUser   → data.create  (POST-like)
 *   updateUser   → data.update  (PATCH-like)
 *   deleteUser   → data.delete  (DELETE-like)
 *
 * Fields declared on the model are mapped to action inputs where relevant.
 */
export class PrismaParser {
  parseFile(filePath: string): AgentAction[] {
    const content = fs.readFileSync(filePath, 'utf8');
    const models = this.extractModels(content);
    const actions: AgentAction[] = [];

    for (const model of models) {
      const name  = model.name;
      const lower = name.charAt(0).toLowerCase() + name.slice(1);
      const location = filePath;

      // Writeable fields (non-id, non-auto) used as create/update inputs
      const writeableFields = model.fields.filter(
        f => !f.isId && !f.isAuto && !f.isList,
      );

      const idField = model.fields.find(f => f.isId) ?? { name: 'id', type: 'String' };

      const idInput: Record<string, any> = {
        [idField.name]: { type: this.prismaTypeToJson(idField.type), required: true },
      };

      const writeInputs: Record<string, any> = {};
      for (const f of writeableFields) {
        writeInputs[f.name] = {
          type: this.prismaTypeToJson(f.type),
          required: !f.isOptional,
        };
      }

      // list
      actions.push({
        name: `list${name}s`,
        description: `List all ${name} records`,
        intent: 'data.read',
        type: 'function',
        location,
        safety: 'read',
        agentSafe: true,
        requiredAuth: inferActionAuth({ safety: 'read', httpMethod: 'GET', type: 'function' }),
        parameters: { properties: {} },
        returns: { type: 'array', description: `Array of ${name}` },
      });

      // get
      actions.push({
        name: `get${name}`,
        description: `Get a single ${name} by ${idField.name}`,
        intent: 'data.read',
        type: 'function',
        location,
        safety: 'read',
        agentSafe: true,
        requiredAuth: inferActionAuth({ safety: 'read', httpMethod: 'GET', type: 'function' }),
        parameters: { properties: idInput },
        returns: { type: 'object', description: name },
      });

      // create
      actions.push({
        name: `create${name}`,
        description: `Create a new ${name} record`,
        intent: 'data.create',
        type: 'function',
        location,
        safety: 'write',
        agentSafe: deriveAgentSafe('write', `create${name}`),
        requiredAuth: inferActionAuth({ safety: 'write', type: 'function' }),
        parameters: { properties: writeInputs },
        returns: { type: 'object', description: `Created ${name}` },
      });

      // update
      actions.push({
        name: `update${name}`,
        description: `Update an existing ${name} record`,
        intent: 'data.update',
        type: 'function',
        location,
        safety: 'write',
        agentSafe: deriveAgentSafe('write'),
        requiredAuth: inferActionAuth({ safety: 'write', type: 'function' }),
        parameters: { properties: { ...idInput, ...writeInputs } },
        returns: { type: 'object', description: `Updated ${name}` },
      });

      // delete
      actions.push({
        name: `delete${name}`,
        description: `Delete a ${name} record`,
        intent: 'data.delete',
        type: 'function',
        location,
        safety: 'destructive',
        agentSafe: false,
        requiredAuth: inferActionAuth({ safety: 'destructive', type: 'function' }),
        parameters: { properties: idInput },
        returns: { type: 'object', description: `Deleted ${name}` },
      });

      void lower; // suppress unused-variable warning
    }

    return actions;
  }

  // ─── Schema parsing helpers ───────────────────────────────────────────────

  private extractModels(content: string): Array<{
    name: string;
    fields: Array<{ name: string; type: string; isId: boolean; isAuto: boolean; isOptional: boolean; isList: boolean }>;
  }> {
    const models = [];
    // Match: model ModelName { ... }
    const modelRe = /^model\s+(\w+)\s*\{([^}]+)\}/gm;
    let modelMatch: RegExpExecArray | null;

    while ((modelMatch = modelRe.exec(content)) !== null) {
      const modelName = modelMatch[1];
      const body = modelMatch[2];
      const fields = this.parseFields(body);
      models.push({ name: modelName, fields });
    }

    return models;
  }

  private parseFields(body: string): Array<{
    name: string; type: string; isId: boolean; isAuto: boolean; isOptional: boolean; isList: boolean;
  }> {
    const fields = [];
    const lines = body.split('\n');

    for (const raw of lines) {
      const line = raw.trim();
      if (!line || line.startsWith('//') || line.startsWith('@@')) continue;

      // field   Type   @attr @attr
      const match = line.match(/^(\w+)\s+(\w+)(\[\])?(\?)?(.*)$/);
      if (!match) continue;

      const [, name, type, isList, isOptional, attrs] = match;
      fields.push({
        name,
        type,
        isList: !!isList,
        isOptional: !!isOptional,
        isId: attrs.includes('@id'),
        isAuto: attrs.includes('@default(autoincrement())') || attrs.includes('@default(uuid())') || attrs.includes('@default(cuid())') || attrs.includes('@updatedAt'),
      });
    }

    return fields;
  }

  private prismaTypeToJson(prismaType: string): string {
    switch (prismaType) {
      case 'String':   return 'string';
      case 'Int':
      case 'Float':
      case 'Decimal':  return 'number';
      case 'Boolean':  return 'boolean';
      case 'DateTime': return 'string';
      case 'Json':     return 'object';
      case 'Bytes':    return 'string';
      default:         return 'object'; // relations / enums
    }
  }
}

/** Prisma schema file patterns */
export const PRISMA_PATTERNS = [
  '**/schema.prisma',
  '**/prisma/schema.prisma',
];
