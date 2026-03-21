export type SafetyLevel = 'read' | 'write' | 'financial' | 'destructive' | 'confidential';

export type AuthType =
  | 'none'
  | 'bearer'
  | 'api-key'
  | 'oauth2'
  | 'basic'
  | 'cookie'
  | 'siwe'
  | 'farcaster-siwf'
  | 'farcaster-frame'
  | 'clerk'
  | 'privy'
  | 'dynamic'
  | 'magic'
  | 'passkey'
  | 'saml'
  | 'supabase';

export interface AuthConfig {
  /** How agents should authenticate with this app */
  type: AuthType;
  /** Header name for bearer/api-key auth (default: "Authorization") */
  header?: string;
  /** Header scheme prefix, e.g. "Bearer" or "Token" */
  scheme?: string;
  /** For api-key: the query param name if passed as query string */
  queryParam?: string;
  /** URL where agents/users can obtain credentials */
  docsUrl?: string;
  loginUrl?: string;
  nonceUrl?: string;
  tokenUrl?: string;
  callbackUrl?: string;
  scopes?: string[];
}

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

export interface ActionAuth {
  /**
   * Whether this specific action requires authentication.
   * 'public'           — no credentials needed (e.g. read-only GET endpoints)
   * 'required'         — agent must authenticate using app-level auth.type
   * 'farcaster-signed' — Farcaster frame signature required (stronger than bearer)
   */
  required: 'public' | 'required' | 'farcaster-signed';
  /** Optional OAuth/custom scope string, e.g. "payments:write", "admin" */
  scope?: string;
}

export interface AgentAction {
  name: string;
  description: string;
  /** Standardized semantic intent, e.g. "game.play", "finance.transfer", "social.cast" */
  intent: string;
  type: 'api' | 'contract' | 'function' | 'socket' | 'ui';
  location: string;
  method?: string;
  /** For socket type: the Socket.IO event name to emit */
  socketEvent?: string;
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
  /** Auth requirement for this specific action (may differ from app-level auth) */
  requiredAuth: ActionAuth;
  // Renamed from inputs/outputs — per-property `required` is a non-standard
  // extension to JSON Schema; document in README that strict consumers must
  // transform required fields to a `required: string[]` array.
  parameters: {
    properties: Record<string, ParameterProperty>;
  };
  returns: {
    type: string;
    description?: string;
  };
  // New routing/interaction fields
  uiPath?: string;
  callStrategy?:
    | 'direct-api'
    | 'server-action'
    | 'form-submission'
    | 'socket-emit'
    | 'contract-write'
    | 'ui-interaction';
  selector?: string;
  interaction?: 'click' | 'fill' | 'select' | 'toggle';
}

export interface DataModelEntry {
  description?: string;
  fields: Record<string, {
    type: string;
    required?: boolean;
    description?: string;
  }>;
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
  baseUrl?: string;
  auth: AuthConfig;
  metadata: AppMetadata;
  capabilities: string[];
  actions: AgentAction[];
  dataModel?: Record<string, DataModelEntry>;
}
