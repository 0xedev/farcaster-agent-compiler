import { AgentAction, AgentManifest, AppMetadata, AuthConfig } from '../types';

export class ManifestGenerator {
  generate(
    actions: AgentAction[],
    metadata: AppMetadata = {},
    capabilities: string[] = [],
    auth: AuthConfig = { type: 'none' },
    version = '1.0.0'
  ): AgentManifest {
    return {
      name:        metadata.name        ?? 'Web App',
      description: metadata.description ?? 'Auto-generated agent manifest',
      version,
      ...(metadata.author && { author: metadata.author }),
      ...(metadata.url    && { url:    metadata.url }),
      auth,
      metadata: {
        ...(metadata.iconUrl               && { iconUrl:               metadata.iconUrl }),
        ...(metadata.homeUrl               && { homeUrl:               metadata.homeUrl }),
        ...(metadata.imageUrl              && { imageUrl:              metadata.imageUrl }),
        ...(metadata.splashImageUrl        && { splashImageUrl:        metadata.splashImageUrl }),
        ...(metadata.splashBackgroundColor && { splashBackgroundColor: metadata.splashBackgroundColor }),
      },
      capabilities,
      actions,
    };
  }
}
