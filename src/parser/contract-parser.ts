import { Project, SourceFile, Node, SyntaxKind } from 'ts-morph';
import { AgentAction } from '../types';
import * as fs from 'fs';
import * as path from 'path';

export class ContractParser {
  constructor(private projectPath: string) {}

  async parseAbiFile(filePath: string): Promise<AgentAction[]> {
    try {
      const content = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      if (!Array.isArray(content)) return [];

      const actions: AgentAction[] = [];
      for (const item of content) {
        if (item.type === 'function' && item.stateMutability !== 'view' && item.stateMutability !== 'pure') {
          actions.push({
            name: item.name,
            description: `Smart contract function: ${item.name}`,
            type: 'contract',
            location: `./${path.relative(this.projectPath, filePath)}`,
            abiFunction: item.name,
            parameters: {
              properties: this.mapAbiInputs(item.inputs)
            },
            returns: {
              type: this.mapAbiOutputs(item.outputs),
              description: ''
            }
          });
        }
      }
      return actions;
    } catch (e) {
      return [];
    }
  }

  private mapAbiInputs(inputs: any[]): Record<string, any> {
    const props: Record<string, any> = {};
    for (const input of inputs) {
      props[input.name || 'arg'] = {
        type: this.mapSolidityType(input.type),
        description: `Solidity type: ${input.type}`,
        required: true
      };
    }
    return props;
  }

  private mapAbiOutputs(outputs: any[]): string {
    if (!outputs || outputs.length === 0) return 'void';
    if (outputs.length === 1) return this.mapSolidityType(outputs[0].type);
    return 'object';
  }

  private mapSolidityType(type: string): string {
    if (type.startsWith('uint') || type.startsWith('int')) return 'number';
    if (type === 'bool') return 'boolean';
    if (type === 'address') return 'string';
    if (type.startsWith('bytes')) return 'string';
    return 'string';
  }

  async detectHooks(sourceFile: SourceFile): Promise<AgentAction[]> {
    const actions: AgentAction[] = [];
    
    // Scan for useWriteContract or similar patterns
    sourceFile.forEachDescendant(node => {
      if (Node.isCallExpression(node)) {
        const expression = node.getExpression();
        const text = expression.getText();
        
        if (text === 'useWriteContract' || text === 'useContractWrite') {
          // This is a hook initialization, now look for where it's called
          // For simplicity, let's look for objects that contain 'abi' and 'functionName'
        }
      }

      if (Node.isObjectLiteralExpression(node)) {
        const properties = node.getProperties();
        const hasAbi = properties.some(p => p.getText().includes('abi'));
        const hasFunctionName = properties.some(p => p.getText().includes('functionName'));
        
        if (hasAbi && hasFunctionName) {
          const nameProp = properties.find(p => p.getText().includes('functionName'));
          const name = nameProp?.getText().split(':')[1]?.trim().replace(/['"]/g, '') || 'unknownContractAction';
          
          actions.push({
            name,
            description: `Detected contract interaction for ${name}`,
            type: 'contract',
            location: sourceFile.getFilePath(),
            parameters: { properties: {} }, // Would need deeper analysis to extract params
            returns: { type: 'any' }
          });
        }
      }
    });

    return actions;
  }
}
