import { AgentAction, AgentManifest, AppMetadata, AuthConfig, DataModelEntry } from '../types';

export class ManifestGenerator {
  generate(
    actions: AgentAction[],
    metadata: AppMetadata = {},
    capabilities: string[] = [],
    auth: AuthConfig = { type: 'none' },
    version = '1.0.0',
    options: {
      baseUrl?: string;
      dataModel?: Record<string, DataModelEntry>;
    } = {}
  ): AgentManifest {
    return {
      name:        metadata.name        ?? 'Web App',
      description: metadata.description ?? 'Auto-generated agent manifest',
      version,
      ...(metadata.author    && { author:   metadata.author }),
      ...(metadata.url       && { url:      metadata.url }),
      ...(options.baseUrl    && { baseUrl:  options.baseUrl }),
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
      ...(options.dataModel && Object.keys(options.dataModel).length > 0 && { dataModel: options.dataModel }),
    };
  }
}
