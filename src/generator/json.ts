import { AgentAction, AgentManifest } from '../types';

export class ManifestGenerator {
  generate(actions: AgentAction[], metadata?: { name?: string, description?: string }): AgentManifest {
    return {
      name: metadata?.name || "Farcaster Mini App",
      description: metadata?.description || "Auto-generated agent manifest",
      version: "1.0.0",
      actions
    };
  }
}
