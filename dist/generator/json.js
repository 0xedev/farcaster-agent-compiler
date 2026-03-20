"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ManifestGenerator = void 0;
class ManifestGenerator {
    generate(actions, metadata = {}, capabilities = [], version = '1.0.0') {
        return {
            name: metadata.name ?? 'Farcaster Mini App',
            description: metadata.description ?? 'Auto-generated agent manifest',
            version,
            ...(metadata.author && { author: metadata.author }),
            ...(metadata.url && { url: metadata.url }),
            metadata: {
                ...(metadata.iconUrl && { iconUrl: metadata.iconUrl }),
                ...(metadata.homeUrl && { homeUrl: metadata.homeUrl }),
                ...(metadata.imageUrl && { imageUrl: metadata.imageUrl }),
                ...(metadata.splashImageUrl && { splashImageUrl: metadata.splashImageUrl }),
                ...(metadata.splashBackgroundColor && { splashBackgroundColor: metadata.splashBackgroundColor }),
            },
            capabilities,
            actions,
        };
    }
}
exports.ManifestGenerator = ManifestGenerator;
