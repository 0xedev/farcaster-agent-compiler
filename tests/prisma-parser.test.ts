import { PrismaParser } from '../src/parser/prisma-parser';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

function withTempSchema(content: string, fn: (filePath: string) => void) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'prisma-test-'));
  const file = path.join(dir, 'schema.prisma');
  fs.writeFileSync(file, content);
  try { fn(file); } finally { fs.rmSync(dir, { recursive: true }); }
}

const SCHEMA = `
model User {
  id        String   @id @default(cuid())
  name      String?
  email     String   @unique
  createdAt DateTime @default(now())
}

model Post {
  id      String @id @default(cuid())
  title   String
  userId  String
}
`;

describe('PrismaParser', () => {
  it('returns empty actions array', () => {
    withTempSchema(SCHEMA, (file) => {
      const parser = new PrismaParser();
      const result = parser.parseFile(file);
      expect(result.actions).toHaveLength(0);
    });
  });

  it('returns dataModel with User and Post', () => {
    withTempSchema(SCHEMA, (file) => {
      const parser = new PrismaParser();
      const result = parser.parseFile(file);
      expect(result.dataModel).toHaveProperty('User');
      expect(result.dataModel).toHaveProperty('Post');
    });
  });

  it('User model has correct fields', () => {
    withTempSchema(SCHEMA, (file) => {
      const parser = new PrismaParser();
      const { dataModel } = parser.parseFile(file);
      expect(dataModel['User'].fields).toHaveProperty('name');
      expect(dataModel['User'].fields).toHaveProperty('email');
      // id and createdAt are auto-generated — excluded from writeable fields
    });
  });

  it('includes description per model', () => {
    withTempSchema(SCHEMA, (file) => {
      const parser = new PrismaParser();
      const { dataModel } = parser.parseFile(file);
      expect(dataModel['User'].description).toContain('User');
    });
  });
});
