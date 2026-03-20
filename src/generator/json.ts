import { AgentAction, AgentManifest, AppMetadata } from '../types';

export class ManifestGenerator {
  generate(
    actions: AgentAction[],
    metadata: AppMetadata = {},
    capabilities: string[] = [],
    version = '1.0.0'
  ): AgentManifest {
    return {
      name:        metadata.name        ?? 'Farcaster Mini App',
      description: metadata.description ?? 'Auto-generated agent manifest',
      version,
      ...(metadata.author && { author: metadata.author }),
      ...(metadata.url    && { url:    metadata.url }),
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
