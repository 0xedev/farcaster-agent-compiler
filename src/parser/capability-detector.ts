/**
 * Detects app capabilities by scanning file content for known SDK/library patterns.
 *
 * Capabilities are generic (not Farcaster-specific) so agent.json works for any app.
 * Farcaster-specific signals are still included but map to generic capability names
 * where possible, plus a 'farcaster' capability for Farcaster-specific features.
 */

interface CapabilitySignal {
  pattern: string;
  capability: string;
}

const CAPABILITY_SIGNALS: CapabilitySignal[] = [
  // ── Payments ────────────────────────────────────────────────────────────
  { pattern: 'stripe',                     capability: 'payments' },
  { pattern: 'Stripe(',                    capability: 'payments' },
  { pattern: 'loadStripe',                 capability: 'payments' },
  { pattern: 'paymentIntent',              capability: 'payments' },
  { pattern: 'checkout.sessions',          capability: 'payments' },

  // ── Wallet / onchain ────────────────────────────────────────────────────
  { pattern: 'sdk.wallet',                 capability: 'wallet' },
  { pattern: 'ethProvider',                capability: 'wallet' },
  { pattern: 'useWalletClient',            capability: 'wallet' },
  { pattern: 'useConnect',                 capability: 'wallet' },
  { pattern: 'useAccount',                 capability: 'wallet' },
  { pattern: 'useWriteContract',           capability: 'wallet' },
  { pattern: 'writeContract',              capability: 'wallet' },
  { pattern: 'ethers.provider',            capability: 'wallet' },
  { pattern: 'web3.eth',                   capability: 'wallet' },

  // ── Notifications ───────────────────────────────────────────────────────
  { pattern: 'sendNotification',           capability: 'notifications' },
  { pattern: 'useNotifications',           capability: 'notifications' },
  { pattern: 'addFrameNotification',       capability: 'notifications' },
  { pattern: 'sdk.actions.addFrameNotification', capability: 'notifications' },
  { pattern: 'webpush',                    capability: 'notifications' },
  { pattern: 'PushSubscription',           capability: 'notifications' },
  { pattern: 'Notification.requestPermission', capability: 'notifications' },
  { pattern: 'sendEmail',                  capability: 'notifications' },
  { pattern: 'resend.emails',              capability: 'notifications' },
  { pattern: 'nodemailer',                 capability: 'notifications' },
  { pattern: 'twilio',                     capability: 'notifications' },

  // ── File / media uploads ────────────────────────────────────────────────
  { pattern: 'put(',                       capability: 'storage' },
  { pattern: 'upload(',                    capability: 'storage' },
  { pattern: 'multer',                     capability: 'storage' },
  { pattern: 'formData()',                 capability: 'storage' },
  { pattern: 'vercel/blob',               capability: 'storage' },
  { pattern: 'sdk.actions.openCamera',    capability: 'storage' },
  { pattern: 's3.upload',                 capability: 'storage' },
  { pattern: 'cloudinary',               capability: 'storage' },

  // ── Social (generic) ────────────────────────────────────────────────────
  { pattern: 'sdk.actions.composeCast',   capability: 'social' },
  { pattern: 'openCompose',               capability: 'social' },
  { pattern: 'composeCast',               capability: 'social' },

  // ── Location / geo ──────────────────────────────────────────────────────
  { pattern: 'sdk.context.location',       capability: 'location' },
  { pattern: 'sdk.location',               capability: 'location' },
  { pattern: 'geolocation',               capability: 'location' },
  { pattern: 'navigator.geolocation',     capability: 'location' },

  // ── AI / LLM ────────────────────────────────────────────────────────────
  { pattern: 'openai',                    capability: 'ai' },
  { pattern: 'anthropic',                 capability: 'ai' },
  { pattern: 'streamText(',               capability: 'ai' },
  { pattern: 'generateText(',             capability: 'ai' },
  { pattern: 'useChat(',                  capability: 'ai' },

  // ── Farcaster-specific (preserved for Farcaster mini-apps) ───────────────
  { pattern: 'sdk.actions.addFrame',      capability: 'farcaster' },
  { pattern: 'sdk.actions.ready',         capability: 'farcaster' },
  { pattern: 'sdk.haptics',              capability: 'farcaster' },
  { pattern: 'sdk.actions.openUrl',       capability: 'navigation' },
  { pattern: 'requestContact',            capability: 'contacts' },

  // ── Database / data ─────────────────────────────────────────────────────
  { pattern: 'prisma.',                   capability: 'database' },
  { pattern: 'supabase.',                 capability: 'database' },
  { pattern: 'drizzle(',                  capability: 'database' },

  // ── Real-time ────────────────────────────────────────────────────────────
  { pattern: 'socket.io',                 capability: 'realtime' },
  { pattern: 'new WebSocket',             capability: 'realtime' },
  { pattern: 'pusher',                    capability: 'realtime' },
  { pattern: 'ably',                      capability: 'realtime' },
];

export class CapabilityDetector {
  private detected = new Set<string>();

  /**
   * Scan a file's raw content for capability signal strings.
   * This is intentionally fast (string search, no AST) since it runs over every file.
   */
  scanContent(content: string): void {
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
  readManifest(frame: Record<string, any>): void {
    // Explicit capability declarations
    const declared: unknown = frame.capabilities ?? frame.requiredCapabilities;
    if (Array.isArray(declared)) {
      for (const cap of declared) {
        if (typeof cap === 'string') this.detected.add(cap);
      }
    }

    // Infer wallet capability if a default chain or web3 config is present
    if (frame.chainId || frame.defaultChain) {
      this.detected.add('wallet');
    }
  }

  getCapabilities(): string[] {
    return Array.from(this.detected).sort();
  }
}
