import { AuthDetector } from '../src/parser/auth-detector';

function detect(content: string) {
  const d = new AuthDetector();
  d.scanContent(content);
  return d.getAuth();
}

describe('AuthDetector — new auth types', () => {
  it('detects siwe', () => {
    expect(detect("import { SiweMessage } from 'siwe'").type).toBe('siwe');
  });
  it('detects farcaster-siwf', () => {
    expect(detect("import { createClient } from '@farcaster/auth-kit'").type).toBe('farcaster-siwf');
  });
  it('detects clerk', () => {
    expect(detect("import { clerkMiddleware } from '@clerk/nextjs'").type).toBe('clerk');
  });
  it('detects privy', () => {
    expect(detect("import { usePrivy } from '@privy-io/react-auth'").type).toBe('privy');
  });
  it('detects dynamic', () => {
    expect(detect("import { DynamicContextProvider } from '@dynamic-labs/sdk-react-core'").type).toBe('dynamic');
  });
  it('detects magic', () => {
    expect(detect("const magic = new Magic(apiKey)").type).toBe('magic');
  });
  it('detects passkey', () => {
    expect(detect("import { startAuthentication } from '@simplewebauthn/browser'").type).toBe('passkey');
  });
  it('detects saml', () => {
    expect(detect("const saml = require('samlify')").type).toBe('saml');
  });
  it('detects supabase auth', () => {
    expect(detect("supabase.auth.signIn({ email })").type).toBe('supabase');
  });

  it('farcaster-siwf beats siwe (higher priority)', () => {
    const d = new AuthDetector();
    d.scanContent("import { SiweMessage } from 'siwe'");
    d.scanContent("import { createClient } from '@farcaster/auth-kit'");
    expect(d.getAuth().type).toBe('farcaster-siwf');
  });

  it('clerk beats bearer (no longer generic jwt)', () => {
    const d = new AuthDetector();
    d.scanContent("import { clerkMiddleware } from '@clerk/nextjs'");
    d.scanContent("jwt.verify(token, secret)");
    expect(d.getAuth().type).toBe('clerk');
  });
});

describe('AuthDetector — flow URL inference', () => {
  it('sets nonceUrl for siwe', () => {
    const d = new AuthDetector();
    d.scanContent("import { SiweMessage } from 'siwe'");
    d.scanContent("fetch('/api/auth/nonce')");
    const auth = d.getAuth();
    expect(auth.nonceUrl).toBe('/api/auth/nonce');
  });

  it('sets loginUrl from sign-in path', () => {
    const d = new AuthDetector();
    d.scanContent("import { clerkMiddleware } from '@clerk/nextjs'");
    d.scanContent("redirect('/sign-in')");
    expect(d.getAuth().loginUrl).toBe('/sign-in');
  });
});
