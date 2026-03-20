"use strict";
/**
 * Detects Farcaster mini-app capabilities by scanning file content for
 * known SDK usage patterns and by reading declared capabilities in farcaster.json.
 *
 * Capabilities map to the Farcaster Frames v2 capability system:
 * https://docs.farcaster.xyz/developers/frames/v2/spec
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.CapabilityDetector = void 0;
const CAPABILITY_SIGNALS = [
    // Wallet / onchain
    { pattern: 'sdk.wallet', capability: 'wallet' },
    { pattern: 'ethProvider', capability: 'wallet' },
    { pattern: 'useWalletClient', capability: 'wallet' },
    { pattern: 'useConnect', capability: 'wallet' },
    { pattern: 'useAccount', capability: 'wallet' },
    { pattern: 'useWriteContract', capability: 'wallet' },
    { pattern: 'writeContract', capability: 'wallet' },
    // Notifications
    { pattern: 'sendNotification', capability: 'notifications' },
    { pattern: 'useNotifications', capability: 'notifications' },
    { pattern: 'addFrameNotification', capability: 'notifications' },
    { pattern: 'sdk.actions.addFrameNotification', capability: 'notifications' },
    // Navigation / deep linking
    { pattern: 'sdk.actions.openUrl', capability: 'navigation' },
    { pattern: 'sdk.openUrl', capability: 'navigation' },
    { pattern: 'sdk.actions.openCompose', capability: 'navigation' },
    // Location
    { pattern: 'sdk.context.location', capability: 'location' },
    { pattern: 'sdk.location', capability: 'location' },
    // Haptics
    { pattern: 'sdk.haptics', capability: 'haptics' },
    { pattern: 'hapticFeedback', capability: 'haptics' },
    // Contacts
    { pattern: 'requestContact', capability: 'contacts' },
    { pattern: 'sdk.contacts', capability: 'contacts' },
    // Frame management
    { pattern: 'sdk.actions.addFrame', capability: 'addFrame' },
    { pattern: 'sdk.actions.close', capability: 'close' },
    { pattern: 'sdk.actions.ready', capability: 'ready' },
    // Camera / media
    { pattern: 'sdk.actions.openCamera', capability: 'camera' },
    // Sharing
    { pattern: 'sdk.actions.composeCast', capability: 'composeCast' },
    { pattern: 'openCompose', capability: 'composeCast' },
];
class CapabilityDetector {
    detected = new Set();
    /**
     * Scan a file's raw content for capability signal strings.
     * This is intentionally fast (string search, no AST) since it runs over every file.
     */
    scanContent(content) {
        for (const { pattern, capability } of CAPABILITY_SIGNALS) {
            if (content.includes(pattern)) {
                this.detected.add(capability);
            }
        }
    }
    /**
     * Read capabilities declared in farcaster.json.
     * Accepts the parsed frame object.
     */
    readManifest(frame) {
        // Explicit capability declarations
        const declared = frame.capabilities ?? frame.requiredCapabilities;
        if (Array.isArray(declared)) {
            for (const cap of declared) {
                if (typeof cap === 'string')
                    this.detected.add(cap);
            }
        }
        // Infer wallet capability if a default chain or web3 config is present
        if (frame.chainId || frame.defaultChain) {
            this.detected.add('wallet');
        }
    }
    getCapabilities() {
        return Array.from(this.detected).sort();
    }
}
exports.CapabilityDetector = CapabilityDetector;
