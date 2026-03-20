"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ManifestGenerator = void 0;
class ManifestGenerator {
    generate(actions, metadata) {
        return {
            name: metadata?.name || "Farcaster Mini App",
            description: metadata?.description || "Auto-generated agent manifest",
            version: "1.0.0",
            actions
        };
    }
}
exports.ManifestGenerator = ManifestGenerator;
