export interface ParameterProperty {
  type: string;
  description?: string;
  required?: boolean;
  enum?: string[];
  // Zod constraint extraction
  default?: any;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  format?: string;
}

export interface AgentAction {
  name: string;
  description: string;
  type: 'api' | 'contract' | 'function';
  location: string;
  method?: string;
  abiFunction?: string;
  isReadOnly?: boolean;
  chainId?: number;
  parameters: {
    properties: Record<string, ParameterProperty>;
  };
  returns: {
    type: string;
    description?: string;
  };
}

export interface AppMetadata {
  name?: string;
  description?: string;
  iconUrl?: string;
  homeUrl?: string;
  imageUrl?: string;
  splashImageUrl?: string;
  splashBackgroundColor?: string;
}

export interface AgentManifest {
  name: string;
  description: string;
  version: string;
  metadata: AppMetadata;
  capabilities: string[];
  actions: AgentAction[];
}
