export interface AgentAction {
  name: string;
  description: string;
  type: 'api' | 'contract' | 'function';
  location: string;
  method?: string;
  abiFunction?: string;
  isReadOnly?: boolean;
  parameters: {
    properties: Record<string, {
      type: string;
      description?: string;
      required?: boolean;
      enum?: string[];
    }>;
  };
  returns: {
    type: string;
    description?: string;
  };
}

export interface AgentManifest {
  name: string;
  description: string;
  version: string;
  actions: AgentAction[];
}
