import * as fs from 'fs';
import { AgentAction, DataModelEntry } from '../types';

/**
 * Reads a Prisma schema file and extracts the data model as a structured
 * `dataModel` map. Each Prisma model becomes an entry with its writeable
 * fields (auto-managed fields like @id, @default(now()), @updatedAt are excluded).
 *
 * Returns `{ actions: [], dataModel }` — no CRUD actions are generated.
 * Prisma models are data schema, not API endpoints.
 */
export class PrismaParser {
  parseFile(filePath: string): { actions: AgentAction[]; dataModel: Record<string, DataModelEntry> } {
    const content = fs.readFileSync(filePath, 'utf8');
    const dataModel: Record<string, DataModelEntry> = {};

    const modelRegex = /^model\s+(\w+)\s*\{([^}]+)\}/gm;
    let match: RegExpExecArray | null;
    while ((match = modelRegex.exec(content)) !== null) {
      const modelName = match[1];
      const body = match[2];
      const fields: Record<string, { type: string; required?: boolean; description?: string }> = {};

      for (const line of body.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('@@')) continue;
        const fieldMatch = /^(\w+)\s+(\w+)(\[\])?([\?])?(.*)?$/.exec(trimmed);
        if (!fieldMatch) continue;
        const [, fieldName, fieldType, isList, isOptional, attrs] = fieldMatch;
        // Skip auto-managed fields (any @default(...) variant, not just @default(now()))
        if (attrs?.includes('@id') || attrs?.includes('@default(') || attrs?.includes('@updatedAt')) continue;

        fields[fieldName] = {
          type: this.mapFieldType(fieldType, !!isList),
          required: !isOptional,
        };
      }

      dataModel[modelName] = {
        description: `Prisma model: ${modelName}`,
        fields,
      };
    }

    return { actions: [], dataModel };
  }

  private mapFieldType(prismaType: string, isList: boolean): string {
    if (isList) return 'array';
    const map: Record<string, string> = {
      String: 'string', Int: 'number', Float: 'number', Decimal: 'number',
      Boolean: 'boolean', DateTime: 'string', Json: 'object', Bytes: 'string',
    };
    return map[prismaType] ?? 'object';
  }
}

/** Prisma schema file patterns */
export const PRISMA_PATTERNS = [
  '**/schema.prisma',
  '**/prisma/schema.prisma',
];
