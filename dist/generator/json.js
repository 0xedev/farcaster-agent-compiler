"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ManifestGenerator = void 0;
class ManifestGenerator {
    generate(actions, metadata = {}, capabilities = [], auth = { type: 'none' }, version = '1.0.0', options = {}) {
        return {
            name: metadata.name ?? 'Web App',
            description: metadata.description ?? 'Auto-generated agent manifest',
            version,
            ...(metadata.author && { author: metadata.author }),
            ...(metadata.url && { url: metadata.url }),
            ...(options.baseUrl && { baseUrl: options.baseUrl }),
            auth,
            metadata: {
                ...(metadata.iconUrl && { iconUrl: metadata.iconUrl }),
                ...(metadata.homeUrl && { homeUrl: metadata.homeUrl }),
                ...(metadata.imageUrl && { imageUrl: metadata.imageUrl }),
                ...(metadata.splashImageUrl && { splashImageUrl: metadata.splashImageUrl }),
                ...(metadata.splashBackgroundColor && { splashBackgroundColor: metadata.splashBackgroundColor }),
            },
            capabilities,
            actions,
            ...(options.dataModel && Object.keys(options.dataModel).length > 0 && { dataModel: options.dataModel }),
        };
    }
}
exports.ManifestGenerator = ManifestGenerator;
