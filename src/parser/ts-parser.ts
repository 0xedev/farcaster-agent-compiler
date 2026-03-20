import { Project, SourceFile, JSDoc, JSDocTag, Type, Symbol } from 'ts-morph';
import { AgentAction } from '../types';
import * as path from 'path';
import * as fs from 'fs';
import { ContractParser } from './contract-parser';

export class TSParser {
  private project: Project;
  private contractParser: ContractParser;

  constructor(private projectPath: string) {
    this.project = new Project({
      compilerOptions: {
        allowJs: true,
        checkJs: false,
      },
    });
    this.contractParser = new ContractParser(projectPath);
  }

  async parseFile(filePath: string): Promise<AgentAction[]> {
    const sourceFile = this.project.addSourceFileAtPath(filePath);
    const actions: AgentAction[] = [];

    // 1. Check for annotated functions
    const functions = sourceFile.getExportedDeclarations();
    for (const [name, declarations] of functions) {
      for (const declaration of declarations) {
        if ('getJsDocs' in declaration) {
          const jsDocs = (declaration as any).getJsDocs() as JSDoc[];
          for (const jsDoc of jsDocs) {
            if (jsDoc.getTags().some(tag => tag.getTagName() === 'agent-action')) {
              actions.push(this.parseFunction(name, declaration as any, jsDoc, filePath));
            }
          }
        }
      }
    }

    // 2. Check if it's an API route (based on path)
    const relativePath = path.relative(this.projectPath, filePath);
    if (relativePath.includes('api/') && actions.length === 0) {
      // Basic API route detection (infer name from path)
      const actionName = path.basename(filePath, path.extname(filePath));
      actions.push({
        name: actionName,
        description: `API endpoint at ${relativePath}`,
        type: 'api',
        location: `/${relativePath.replace(/\\/g, '/').replace(/\.[^/.]+$/, '').replace(/^pages\/api\//, 'api/')}`,
        method: 'POST', // Default to POST for actions
        parameters: { properties: {} },
        returns: { type: 'any' }
      });
    }

    // 3. Extract metadata from farcaster.json if it's the manifest
    if (relativePath.endsWith('farcaster.json')) {
      const content = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      if (content.frame) {
        // We can store this metadata somewhere or just use it to populate the manifest
        (this as any)._appMetadata = {
          name: content.frame.name,
          description: content.frame.buttonTitle || `Farcaster App: ${content.frame.name}`
        };
      }
    }

    // 4. Contract detection
    if (filePath.endsWith('.json') && !relativePath.endsWith('farcaster.json') && !relativePath.endsWith('package.json')) {
      const contractActions = await this.contractParser.parseAbiFile(filePath);
      actions.push(...contractActions);
    } else if (filePath.endsWith('.ts') || filePath.endsWith('.tsx')) {
      const hookActions = await this.contractParser.detectHooks(sourceFile);
      actions.push(...hookActions);
    }

    return actions;
  }

  public getAppMetadata(): { name?: string, description?: string } | undefined {
    return (this as any)._appMetadata;
  }

  private parseFunction(name: string, declaration: any, jsDoc: JSDoc, filePath: string): AgentAction {
    const description = jsDoc.getDescription().trim() || 
                        jsDoc.getTags().find(t => t.getTagName() === 'description')?.getComment()?.toString().trim() || 
                        `Function ${name}`;

    const parameters: Record<string, any> = {};
    
    if ('getParameters' in declaration) {
      const params = declaration.getParameters();
      for (const param of params) {
        const paramName = param.getName();
        const paramType = param.getType().getText();
        const paramDoc = jsDoc.getTags()
          .find(t => t.getTagName() === 'param' && (t as any).getName() === paramName);
        
        parameters[paramName] = {
          type: this.mapType(param.getType()),
          description: paramDoc?.getComment()?.toString().trim() || '',
          required: !param.isOptional()
        };
      }
    }

    const returnType = 'getReturnType' in declaration ? declaration.getReturnType() : null;

    return {
      name,
      description,
      type: 'function',
      location: `./${path.relative(this.projectPath, filePath)}`,
      parameters: { properties: parameters },
      returns: {
        type: returnType ? this.mapType(returnType) : 'any',
        description: jsDoc.getTags().find(t => t.getTagName() === 'returns')?.getComment()?.toString().trim() || ''
      }
    };
  }

  private mapType(type: Type): string {
    if (type.isString()) return 'string';
    if (type.isNumber()) return 'number';
    if (type.isBoolean()) return 'boolean';
    if (type.isArray()) return 'array';
    if (type.isObject()) return 'object';
    return type.getText();
  }
}
