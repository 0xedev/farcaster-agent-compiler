export type SafetyLevel = 'read' | 'write' | 'financial' | 'destructive';

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
  /** Standardized semantic intent, e.g. "game.play", "finance.transfer", "social.cast" */
  intent: string;
  type: 'api' | 'contract' | 'function';
  location: string;
  method?: string;
  abiFunction?: string;
  isReadOnly?: boolean;
  chainId?: number;
  /**
   * Deployed contract address. Either a literal `0x...` string,
   * or `{ $env: "VAR_NAME" }` when resolved from an environment variable.
   */
  contractAddress?: string | { $env: string };
  /** Safety classification for agent policy enforcement */
  safety: SafetyLevel;
  /** True when the action can be executed autonomously without human confirmation */
  agentSafe: boolean;
  inputs: Record<string, ParameterProperty>;
  outputs: {
    type: string;
    description?: string;
  };
}

export interface AppMetadata {
  name?: string;
  description?: string;
  author?: string;
  url?: string;
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
  author?: string;
  url?: string;
  metadata: AppMetadata;
  capabilities: string[];
  actions: AgentAction[];
}
