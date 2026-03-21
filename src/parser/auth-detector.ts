import { AuthConfig, AuthType } from '../types';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Detects the authentication scheme used by an app by scanning source files
 * for known patterns. Returns an AuthConfig describing how agents should auth.
 *
 * Priority order (highest confidence first):
 *  1. Farcaster frame verification
 *  2. Farcaster SIWF (Sign In With Farcaster)
 *  3. SIWE (Sign In With Ethereum)
 *  4. OAuth2 / NextAuth / Auth.js
 *  5. SAML
 *  6. Clerk
 *  7. JWT / Bearer token
 *  8. Privy / Dynamic
 *  9. Magic
 * 10. Passkey / WebAuthn
 * 11. Supabase auth
 * 12. API key
 * 13. Basic auth
 * 14. Session / cookie
 * 15. None (public)
 */

interface AuthSignal {
  pattern: string;
  type: AuthType;
  header?: string;
  scheme?: string;
  queryParam?: string;
  priority: number;
}

const AUTH_SIGNALS: AuthSignal[] = [
  // Farcaster frame auth
  { pattern: 'verifyFrameSignature',       type: 'farcaster-frame', priority: 100 },
  { pattern: '@farcaster/frame-node',      type: 'farcaster-frame', priority: 100 },
  { pattern: 'validateFrameMessage',       type: 'farcaster-frame', priority: 100 },
  { pattern: 'frameActionPayload',         type: 'farcaster-frame', priority: 100 },

  // Farcaster SIWF — must be before SIWE (higher priority)
  { pattern: '@farcaster/auth-kit',        type: 'farcaster-siwf', priority: 98 },
  { pattern: 'verifySignInMessage',        type: 'farcaster-siwf', priority: 98 },
  { pattern: 'useSignIn',                  type: 'farcaster-siwf', priority: 95 },

  // SIWE
  { pattern: 'SiweMessage',               type: 'siwe', priority: 95 },
  { pattern: "from 'siwe'",               type: 'siwe', priority: 95 },
  { pattern: 'verifySiweMessage',         type: 'siwe', priority: 95 },
  { pattern: 'generateNonce',             type: 'siwe', priority: 90 },

  // OAuth2 / NextAuth / Auth.js
  { pattern: 'NextAuth',                   type: 'oauth2', priority: 90 },
  { pattern: 'next-auth',                  type: 'oauth2', priority: 90 },
  { pattern: 'getServerSession',           type: 'oauth2', priority: 85 },
  { pattern: 'auth()',                     type: 'oauth2', priority: 85 },
  { pattern: 'OAuthProvider',             type: 'oauth2', priority: 80 },
  { pattern: 'oauth2',                     type: 'oauth2', priority: 80 },
  { pattern: 'access_token',              type: 'oauth2', priority: 75 },
  { pattern: 'refresh_token',             type: 'oauth2', priority: 75 },

  // SAML
  { pattern: 'samlify',                   type: 'saml', priority: 92 },
  { pattern: 'passport-saml',             type: 'saml', priority: 92 },
  { pattern: '@node-saml',                type: 'saml', priority: 92 },
  { pattern: 'SAMLResponse',              type: 'saml', priority: 88 },

  // Clerk
  { pattern: 'clerkMiddleware',            type: 'clerk',  priority: 88 },
  { pattern: 'currentUser',               type: 'clerk',  priority: 70 },

  // JWT / Bearer
  { pattern: 'jwt.verify',                type: 'bearer', header: 'Authorization', scheme: 'Bearer', priority: 70 },
  { pattern: 'jsonwebtoken',              type: 'bearer', header: 'Authorization', scheme: 'Bearer', priority: 70 },
  { pattern: 'jose',                      type: 'bearer', header: 'Authorization', scheme: 'Bearer', priority: 65 },
  { pattern: "split('Bearer ')",          type: 'bearer', header: 'Authorization', scheme: 'Bearer', priority: 70 },
  { pattern: 'authorization.split',       type: 'bearer', header: 'Authorization', scheme: 'Bearer', priority: 70 },
  { pattern: "headers.get('authorization')", type: 'bearer', header: 'Authorization', scheme: 'Bearer', priority: 65 },
  { pattern: "req.headers.authorization", type: 'bearer', header: 'Authorization', scheme: 'Bearer', priority: 65 },

  // Privy
  { pattern: '@privy-io/react-auth',      type: 'privy', priority: 85 },
  { pattern: 'usePrivy',                  type: 'privy', priority: 85 },
  { pattern: 'PrivyProvider',             type: 'privy', priority: 85 },

  // Dynamic
  { pattern: '@dynamic-labs/sdk-react-core', type: 'dynamic', priority: 85 },
  { pattern: 'DynamicContextProvider',    type: 'dynamic', priority: 85 },
  { pattern: 'useDynamicContext',         type: 'dynamic', priority: 80 },

  // Magic
  { pattern: 'magic-sdk',                 type: 'magic', priority: 80 },
  { pattern: '@magic-sdk',                type: 'magic', priority: 80 },
  { pattern: 'new Magic(',                type: 'magic', priority: 80 },

  // Passkey / WebAuthn
  { pattern: '@simplewebauthn/browser',   type: 'passkey', priority: 78 },
  { pattern: 'startAuthentication',       type: 'passkey', priority: 78 },
  { pattern: 'startRegistration',         type: 'passkey', priority: 78 },
  { pattern: 'navigator.credentials.create', type: 'passkey', priority: 75 },

  // Supabase
  { pattern: 'supabase.auth',             type: 'supabase', priority: 75 },

  // API key
  { pattern: "'x-api-key'",               type: 'api-key', header: 'X-API-Key', priority: 60 },
  { pattern: '"x-api-key"',               type: 'api-key', header: 'X-API-Key', priority: 60 },
  { pattern: 'X-API-Key',                 type: 'api-key', header: 'X-API-Key', priority: 60 },
  { pattern: 'api_key',                   type: 'api-key', queryParam: 'api_key', priority: 55 },
  { pattern: 'apiKey',                    type: 'api-key', queryParam: 'apiKey', priority: 50 },

  // Basic auth
  { pattern: "'Basic '",                  type: 'basic', header: 'Authorization', scheme: 'Basic', priority: 40 },
  { pattern: '"Basic "',                  type: 'basic', header: 'Authorization', scheme: 'Basic', priority: 40 },
  { pattern: 'btoa(',                     type: 'basic', header: 'Authorization', scheme: 'Basic', priority: 35 },

  // Session / cookie
  { pattern: 'getSession(',               type: 'cookie', priority: 30 },
  { pattern: 'req.session',               type: 'cookie', priority: 30 },
  { pattern: 'iron-session',              type: 'cookie', priority: 30 },
  { pattern: 'cookies()',                 type: 'cookie', priority: 25 },
  { pattern: 'req.cookies',              type: 'cookie', priority: 25 },
];

export class AuthDetector {
  private best: AuthSignal | null = null;
  private _flowInferrer = new AuthFlowInferrer();

  scanContent(content: string): void {
    for (const signal of AUTH_SIGNALS) {
      if (content.includes(signal.pattern)) {
        if (!this.best || signal.priority > this.best.priority) {
          this.best = signal;
        }
      }
    }
    this._flowInferrer.addContent(content);
  }

  /** Read package.json to detect auth libraries in dependencies */
  readPackageJson(projectPath: string): void {
    const pkgPath = path.join(projectPath, 'package.json');
    if (!fs.existsSync(pkgPath)) return;
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      const deps = { ...pkg.dependencies, ...pkg.devDependencies };

      if (deps['next-auth'] || deps['@auth/core'])
        this.applySignal({ pattern: 'next-auth', type: 'oauth2', priority: 90 });
      if (deps['@farcaster/auth-kit'])
        this.applySignal({ pattern: 'farcaster-siwf', type: 'farcaster-siwf', priority: 98 });
      if (deps['siwe'])
        this.applySignal({ pattern: 'siwe', type: 'siwe', priority: 95 });
      if (deps['samlify'] || deps['passport-saml'])
        this.applySignal({ pattern: 'saml', type: 'saml', priority: 92 });
      if (deps['@clerk/nextjs'] || deps['@clerk/clerk-sdk-node'])
        this.applySignal({ pattern: 'clerk', type: 'clerk', header: 'Authorization', scheme: 'Bearer', priority: 88 });
      if (deps['@privy-io/react-auth'])
        this.applySignal({ pattern: 'privy', type: 'privy', priority: 85 });
      if (deps['@dynamic-labs/sdk-react-core'])
        this.applySignal({ pattern: 'dynamic', type: 'dynamic', priority: 85 });
      if (deps['magic-sdk'] || deps['@magic-sdk/admin'])
        this.applySignal({ pattern: 'magic', type: 'magic', priority: 80 });
      if (deps['@simplewebauthn/browser'])
        this.applySignal({ pattern: 'passkey', type: 'passkey', priority: 78 });
      if (deps['@supabase/supabase-js'])
        this.applySignal({ pattern: 'supabase', type: 'supabase', priority: 75 });
      if (deps['jsonwebtoken'] || deps['jose'])
        this.applySignal({ pattern: 'jwt', type: 'bearer', header: 'Authorization', scheme: 'Bearer', priority: 70 });
      if (deps['iron-session'])
        this.applySignal({ pattern: 'iron-session', type: 'cookie', priority: 30 });
      if (deps['@farcaster/frame-node'])
        this.applySignal({ pattern: 'farcaster-frame', type: 'farcaster-frame', priority: 100 });
    } catch { /* ignore */ }
  }

  private applySignal(signal: AuthSignal): void {
    if (!this.best || signal.priority > this.best.priority) {
      this.best = signal;
    }
  }

  getAuth(): AuthConfig {
    if (!this.best) return { type: 'none' };

    const type = this.best.type;
    const config: AuthConfig = { type };
    if (this.best.header)     config.header     = this.best.header;
    if (this.best.scheme)     config.scheme     = this.best.scheme;
    if (this.best.queryParam) config.queryParam = this.best.queryParam;

    const flowFields = this._flowInferrer.infer(type);
    return { ...config, ...flowFields };
  }
}

export class AuthFlowInferrer {
  private scannedContents: string[] = [];

  addContent(content: string): void {
    this.scannedContents.push(content);
  }

  infer(authType: AuthType): Partial<AuthConfig> {
    const result: Partial<AuthConfig> = {};
    for (const content of this.scannedContents) {
      if (!result.nonceUrl && (authType === 'siwe' || authType === 'farcaster-siwf')) {
        const m = content.match(/['"`](\/api\/auth\/nonce[^'"`\s]*)['"` ]/);
        if (m) result.nonceUrl = m[1];
      }
      if (!result.callbackUrl && authType === 'oauth2') {
        const m = content.match(/['"`](\/api\/auth\/callback[^'"`\s]*)['"` ]/);
        if (m) result.callbackUrl = m[1];
      }
      if (!result.loginUrl) {
        const m = content.match(/['"`](\/sign-in|\/login|\/auth\/login)['"` ]/);
        if (m) result.loginUrl = m[1];
      }
    }
    return result;
  }
}
