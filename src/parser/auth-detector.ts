import { AuthConfig, AuthType } from '../types';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Detects the authentication scheme used by an app by scanning source files
 * for known patterns. Returns an AuthConfig describing how agents should auth.
 *
 * Priority order (highest confidence first):
 *  1. Farcaster frame verification
 *  2. OAuth2 / NextAuth / Auth.js
 *  3. JWT / Bearer token
 *  4. API key (x-api-key header or query param)
 *  5. Basic auth
 *  6. Session / cookie
 *  7. None (public)
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

  // OAuth2 / NextAuth / Auth.js
  { pattern: 'NextAuth',                   type: 'oauth2', priority: 90 },
  { pattern: 'next-auth',                  type: 'oauth2', priority: 90 },
  { pattern: 'getServerSession',           type: 'oauth2', priority: 85 },
  { pattern: 'auth()',                     type: 'oauth2', priority: 85 },
  { pattern: 'OAuthProvider',             type: 'oauth2', priority: 80 },
  { pattern: 'oauth2',                     type: 'oauth2', priority: 80 },
  { pattern: 'access_token',              type: 'oauth2', priority: 75 },
  { pattern: 'refresh_token',             type: 'oauth2', priority: 75 },
  { pattern: 'clerkMiddleware',            type: 'bearer', scheme: 'Bearer', priority: 88 },
  { pattern: 'currentUser',               type: 'bearer', scheme: 'Bearer', priority: 70 },

  // JWT / Bearer
  { pattern: 'jwt.verify',                type: 'bearer', header: 'Authorization', scheme: 'Bearer', priority: 70 },
  { pattern: 'jsonwebtoken',              type: 'bearer', header: 'Authorization', scheme: 'Bearer', priority: 70 },
  { pattern: 'jose',                      type: 'bearer', header: 'Authorization', scheme: 'Bearer', priority: 65 },
  { pattern: "split('Bearer ')",          type: 'bearer', header: 'Authorization', scheme: 'Bearer', priority: 70 },
  { pattern: 'authorization.split',       type: 'bearer', header: 'Authorization', scheme: 'Bearer', priority: 70 },
  { pattern: "headers.get('authorization')", type: 'bearer', header: 'Authorization', scheme: 'Bearer', priority: 65 },
  { pattern: "req.headers.authorization", type: 'bearer', header: 'Authorization', scheme: 'Bearer', priority: 65 },

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

  scanContent(content: string): void {
    for (const signal of AUTH_SIGNALS) {
      if (content.includes(signal.pattern)) {
        if (!this.best || signal.priority > this.best.priority) {
          this.best = signal;
        }
      }
    }
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
      if (deps['@clerk/nextjs'] || deps['@clerk/clerk-sdk-node'])
        this.applySignal({ pattern: 'clerk', type: 'bearer', header: 'Authorization', scheme: 'Bearer', priority: 88 });
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

    const config: AuthConfig = { type: this.best.type };
    if (this.best.header)     config.header     = this.best.header;
    if (this.best.scheme)     config.scheme     = this.best.scheme;
    if (this.best.queryParam) config.queryParam = this.best.queryParam;
    return config;
  }
}
