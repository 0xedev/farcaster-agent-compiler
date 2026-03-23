# agent-manifest v4 Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade the `agent-manifest` CLI to v4 foundation: rename schema fields for JSON Schema / SDK compatibility, expand auth coverage to 16 types, fix intent classification bugs, refactor Prisma output to `dataModel`, and update the CLI/generator with new manifest fields.

**Architecture:** All changes are to existing files. The schema rename (`inputs`→`parameters.properties`, `outputs`→`returns`) touches every parser and must be done first — all other tasks depend on it. Auth expansion, intent fixes, Prisma refactor, and CLI/generator updates are independent of each other after the schema rename lands.

**Tech Stack:** TypeScript 5, ts-morph 27, Commander.js, Jest 30, Node.js 22+

---

## File Map

| File | Change |
|---|---|
| `src/types.ts` | Add 9 `AuthType` values, rename `inputs`→`parameters.properties`/`outputs`→`returns`, add `DataModelEntry`, add `AgentManifest.baseUrl/dataModel`, add `AgentAction.uiPath/callStrategy/selector/interaction`, extend `AuthConfig` with flow fields |
| `src/parser/intent-classifier.ts` | Fix `castVote` governance priority, improve `classifySafety` for `type: 'function'`, add `'ui'` to type unions, add no-auth→public rule |
| `src/parser/auth-detector.ts` | Add 40 new signals for 9 auth types, add `AuthFlowInferrer` class integrated into `getAuth()`, update `readPackageJson` |
| `src/parser/ts-parser.ts` | Rename `inputs`→`parameters.properties`, `outputs`→`returns` in all action construction |
| `src/parser/contract-parser.ts` | Rename `inputs`→`parameters.properties`, `outputs`→`returns` |
| `src/parser/express-parser.ts` | Rename `inputs`→`parameters.properties`, `outputs`→`returns` |
| `src/parser/socketio-parser.ts` | Rename `inputs`→`parameters.properties`, `outputs`→`returns`; export `looksLikeSocketIOFile` |
| `src/parser/trpc-parser.ts` | Rename `inputs`→`parameters.properties`, `outputs`→`returns` |
| `src/parser/sse-parser.ts` | Rename `inputs`→`parameters.properties`, `outputs`→`returns` |
| `src/parser/remix-parser.ts` | Rename `inputs`→`parameters.properties`, `outputs`→`returns` |
| `src/parser/websocket-parser.ts` | Rename `inputs`→`parameters.properties`, `outputs`→`returns` |
| `src/parser/openapi-parser.ts` | Rename `inputs`→`parameters.properties`, `outputs`→`returns` |
| `src/parser/prisma-parser.ts` | Return `{ actions: [], dataModel: Record<string, DataModelEntry> }` instead of CRUD `AgentAction[]`; fix `deriveAgentSafe` 2-arg call |
| `src/generator/json.ts` | Accept and emit `baseUrl`, `dataModel` |
| `src/cli.ts` | Add `--base-url` flag, add `continue` to Prisma branch, update `ACTION_TYPES`/`AUTH_TYPES` in both compiler and `validateManifest`, update deduplication to use `parameters.properties`, update console summary |
| `src/index.ts` | Export `looksLikeSocketIOFile`, `SocketIOParser`, new types |
| `tests/validator.test.ts` | Update fixture to `parameters.properties`/`returns`, add tests for new `auth.type` and `type: 'ui'` |
| `tests/intent-classifier.test.ts` | Add `castVote` governance test, `classifySafety` function-type tests, no-auth public test |
| `tests/auth-detector.test.ts` | **NEW** — tests for all 9 new auth type signals |
| `tests/prisma-parser.test.ts` | **NEW** — tests for `dataModel` output format |

---

## Task 1: Type System Foundation

**Files:**
- Modify: `src/types.ts`

This is the foundation. Everything else derives from these types. Change it first.

- [ ] **Step 1: Update `AuthType`**

Replace the existing `AuthType` union in `src/types.ts` (line 3):

```typescript
export type AuthType =
  | 'none'
  | 'bearer'
  | 'api-key'
  | 'oauth2'
  | 'basic'
  | 'cookie'
  | 'siwe'
  | 'farcaster-siwf'
  | 'farcaster-frame'
  | 'clerk'
  | 'privy'
  | 'dynamic'
  | 'magic'
  | 'passkey'
  | 'saml'
  | 'supabase';
```

- [ ] **Step 2: Update `AuthConfig` with flow fields**

After the `docsUrl?` field, add:

```typescript
  loginUrl?: string;
  nonceUrl?: string;
  tokenUrl?: string;
  callbackUrl?: string;
  scopes?: string[];
```

- [ ] **Step 3: Rename fields on `AgentAction` and add new ones**

Replace the `inputs`/`outputs` block at lines 69-74 and update the `type` union:

```typescript
export interface AgentAction {
  name: string;
  description: string;
  intent: string;
  type: 'api' | 'contract' | 'function' | 'socket' | 'ui';
  location: string;
  method?: string;
  socketEvent?: string;
  abiFunction?: string;
  isReadOnly?: boolean;
  chainId?: number;
  contractAddress?: string | { $env: string };
  safety: SafetyLevel;
  agentSafe: boolean;
  requiredAuth: ActionAuth;
  // Renamed from inputs/outputs — per-property `required` is a non-standard
  // extension to JSON Schema; document in README that strict consumers must
  // transform required fields to a `required: string[]` array.
  parameters: {
    properties: Record<string, ParameterProperty>;
  };
  returns: {
    type: string;
    description?: string;
  };
  // New routing/interaction fields
  uiPath?: string;
  callStrategy?:
    | 'direct-api'
    | 'server-action'
    | 'form-submission'
    | 'socket-emit'
    | 'contract-write'
    | 'ui-interaction';
  selector?: string;
  interaction?: 'click' | 'fill' | 'select' | 'toggle';
}
```

- [ ] **Step 4: Add `DataModelEntry` and update `AgentManifest`**

After the `AgentAction` interface, add:

```typescript
export interface DataModelEntry {
  description?: string;
  fields: Record<string, {
    type: string;
    required?: boolean;
    description?: string;
  }>;
}
```

Update `AgentManifest`:

```typescript
export interface AgentManifest {
  name: string;
  description: string;
  version: string;
  author?: string;
  url?: string;
  baseUrl?: string;
  auth: AuthConfig;
  metadata: AppMetadata;
  capabilities: string[];
  actions: AgentAction[];
  dataModel?: Record<string, DataModelEntry>;
}
```

- [ ] **Step 5: Verify TypeScript compiles**

```bash
cd /Users/ayobamiadefolalu/.gemini/antigravity/scratch/farcaster-agent-compiler
npx tsc --noEmit 2>&1 | head -40
```

Expected: many errors about `inputs`/`outputs` still being used in parsers. Also expect errors on `classifySafety`/`inferActionAuth` call sites that pass `type` from `AgentAction.type` — the function signatures still have the old 4-value union until Task 3 updates them. All of these are expected — we'll fix them in Tasks 2 and 3.

- [ ] **Step 6: Commit**

```bash
git add src/types.ts
git commit -m "feat(types): v4 schema — parameters.properties/returns, 15 auth types, DataModelEntry, AgentAction routing fields"
```

---

## Task 2: Schema Rename — All Parsers

**Files:**
- Modify: `src/parser/ts-parser.ts`, `src/parser/contract-parser.ts`, `src/parser/express-parser.ts`, `src/parser/socketio-parser.ts`, `src/parser/trpc-parser.ts`, `src/parser/sse-parser.ts`, `src/parser/remix-parser.ts`, `src/parser/websocket-parser.ts`, `src/parser/openapi-parser.ts`

This is mechanical but must be done carefully — wrong nesting breaks every consumer.

**The pattern to find and replace in every parser:**

Old:
```typescript
inputs: someRecord,
outputs: { type: 'something', description: '' },
```

New:
```typescript
parameters: { properties: someRecord },
returns: { type: 'something', description: '' },
```

- [ ] **Step 1: Fix `ts-parser.ts`**

Search for every occurrence of `inputs:` and `outputs:` in `src/parser/ts-parser.ts`. There are 6 occurrences across sections 3b, 3c, 3d, 3e (arrow functions), and `parseAnnotatedFunction`. Also rename the local `inputs` variable in `parseAnnotatedFunction` (line ~353) to `properties`.

The `extractFunctionParams` helper returns `Record<string, any>` — it stays the same since it builds the inner record. The call sites wrap it: `parameters: { properties: this.extractFunctionParams(init as any) }`.

Run after each file:
```bash
npx tsc --noEmit 2>&1 | grep "ts-parser" | head -10
```

- [ ] **Step 2: Fix `contract-parser.ts`**

2 occurrences (ABI parseFile + detectHooks). Replace:
```typescript
inputs: this.mapAbiInputs(item.inputs ?? []),
outputs: { type: this.mapAbiOutputs(item.outputs ?? []), description: '' },
```
with:
```typescript
parameters: { properties: this.mapAbiInputs(item.inputs ?? []) },
returns: { type: this.mapAbiOutputs(item.outputs ?? []), description: '' },
```

And in `detectHooks`:
```typescript
parameters: { properties: parameters },
returns: { type: 'any' },
```

- [ ] **Step 3: Fix `express-parser.ts`**

1 occurrence:
```typescript
parameters: { properties: this.extractRouteParams(routePath) },
returns: { type: 'any' },
```

- [ ] **Step 4: Fix `socketio-parser.ts`**

Find and fix the `inputs`/`outputs` usage. Note: `looksLikeSocketIOFile` is **already exported** from this file and already re-exported from `src/index.ts` — do NOT add a duplicate export.

- [ ] **Step 5: Fix remaining parsers — `trpc-parser.ts`, `sse-parser.ts`, `remix-parser.ts`, `websocket-parser.ts`, `openapi-parser.ts`**

Run for each:
```bash
grep -n "inputs:\|outputs:" src/parser/trpc-parser.ts
grep -n "inputs:\|outputs:" src/parser/sse-parser.ts
grep -n "inputs:\|outputs:" src/parser/remix-parser.ts
grep -n "inputs:\|outputs:" src/parser/websocket-parser.ts
grep -n "inputs:\|outputs:" src/parser/openapi-parser.ts
```

Replace all occurrences with the `parameters.properties` / `returns` pattern. The inner records stay exactly the same.

- [ ] **Step 6: Verify clean compile**

```bash
npx tsc --noEmit 2>&1 | head -20
```

Expected: 0 errors (or only unrelated pre-existing issues).

- [ ] **Step 7: Update validator test fixture**

In `tests/validator.test.ts`, update `validAction`:

```typescript
const validAction = {
  name: 'flip',
  description: 'Flip a coin',
  intent: 'game.play',
  type: 'contract',
  location: './src/Flip.sol',
  safety: 'financial',
  agentSafe: false,
  requiredAuth: { required: 'required' },
  parameters: { properties: {} },
  returns: { type: 'void' },
};
```

Remove any test assertions referencing `action.inputs` or `action.outputs`.

- [ ] **Step 8: Run tests — expect failures in validator for `inputs`/`outputs` checks**

```bash
cd /Users/ayobamiadefolalu/.gemini/antigravity/scratch/farcaster-agent-compiler
npm test 2>&1 | tail -30
```

The validator tests checking `inputs` / `outputs` will fail. That's expected — we fix the validator in Task 5.

- [ ] **Step 9: Commit**

```bash
git add src/parser/
git add tests/validator.test.ts
git commit -m "feat(parsers): rename inputs→parameters.properties, outputs→returns across all parsers"
```

---

## Task 3: Intent Classifier Fixes

**Files:**
- Modify: `src/parser/intent-classifier.ts`
- Modify: `tests/intent-classifier.test.ts`

- [ ] **Step 1: Write failing tests first**

Add to `tests/intent-classifier.test.ts`:

```typescript
describe('inferIntent — governance priority', () => {
  it('castVote → governance.vote not social.cast', () => {
    expect(inferIntent('castVote')).toBe('governance.vote');
  });
  it('plain cast → social.cast (unchanged)', () => {
    expect(inferIntent('composeCast')).toBe('social.cast');
  });
  it('submitVote → governance.vote', () => {
    expect(inferIntent('submitVote')).toBe('governance.vote');
  });
});

describe('classifySafety — function type', () => {
  it('login → confidential', () => {
    expect(classifySafety({ name: 'signIn', type: 'function' })).toBe('confidential');
  });
  it('dropPiece → write', () => {
    expect(classifySafety({ name: 'dropPiece', type: 'function' })).toBe('write');
  });
  it('financial verb → financial', () => {
    expect(classifySafety({ name: 'transfer', type: 'function' })).toBe('financial');
  });
  it('delete → destructive', () => {
    expect(classifySafety({ name: 'deleteAccount', type: 'function' })).toBe('destructive');
  });
});

describe('inferActionAuth — no-auth app', () => {
  it('write actions on no-auth app → public', () => {
    expect(inferActionAuth({ safety: 'write', type: 'api', appAuthType: 'none' }))
      .toEqual({ required: 'public' });
  });
  it('read actions on no-auth app → public', () => {
    expect(inferActionAuth({ safety: 'read', type: 'api', appAuthType: 'none' }))
      .toEqual({ required: 'public' });
  });
  it('financial actions on no-auth app still → required (safety overrides)', () => {
    expect(inferActionAuth({ safety: 'financial', type: 'api', appAuthType: 'none' }))
      .toEqual({ required: 'required', scope: 'payments:write' });
  });
  it('confidential actions on no-auth app still → required', () => {
    expect(inferActionAuth({ safety: 'confidential', type: 'api', appAuthType: 'none' }))
      .toEqual({ required: 'required', scope: 'pii:write' });
  });
});
```

- [ ] **Step 2: Run — expect failures**

```bash
npm test -- --testPathPattern=intent-classifier 2>&1 | tail -20
```

- [ ] **Step 3: Fix `castVote` governance priority**

Two coordinated changes in `INTENT_RULES`:

**a) Move the entire Governance block (3 rules) to appear BEFORE the Social block.** In the current file, Governance is after Social at lines 58-61. Move those 3 lines to before the Social block (currently line 51).

**b) Update the social.cast pattern with a negative lookahead** so that even if ordering changes in the future, `castVote` cannot accidentally match `social.cast`:

```typescript
// Governance — NOW BEFORE Social block
{ pattern: /\b(vote|castVote|submitVote)/i, intent: 'governance.vote' },
{ pattern: /\b(propose|createProposal|submitProposal)/i, intent: 'governance.propose' },
{ pattern: /\b(delegate|undelegate)/i, intent: 'governance.delegate' },

// Social — after Governance; negative lookahead ensures castVote never matches here
{ pattern: /\b(cast(?!Vote)|compose(?:Cast)?|post(?:Cast)?)/i, intent: 'social.cast' },
{ pattern: /\b(follow|unfollow|subscribe)/i, intent: 'social.follow' },
// ... rest of social rules unchanged
```

Both changes together: reordering makes governance win first, and the lookahead is belt-and-suspenders for safety.

- [ ] **Step 4: Fix `classifySafety` for `type: 'function'`**

Update the function. Add `'ui'` to the type union and add a `function` branch:

```typescript
export function classifySafety(opts: {
  name: string;
  httpMethod?: string;
  isReadOnly?: boolean;
  type: 'api' | 'contract' | 'function' | 'socket' | 'ui';
}): SafetyLevel {
  const { name, httpMethod, isReadOnly, type } = opts;

  if (type === 'contract') {
    if (isReadOnly) return 'read';
    if (FINANCIAL_VERBS.test(name)) return 'financial';
    if (CONFIDENTIAL_NOUNS.test(name)) return 'confidential';
    return 'write';
  }

  // Financial and confidential always win regardless of type
  if (FINANCIAL_VERBS.test(name)) return 'financial';
  if (CONFIDENTIAL_NOUNS.test(name)) return 'confidential';

  if (type === 'function' || type === 'ui') {
    if (DESTRUCTIVE_VERBS.test(name)) return 'destructive';
    // Auth functions are confidential (handle credentials)
    if (/\b(login|logout|signIn|signOut|register|signup|createAccount)/i.test(name)) return 'confidential';
    // Social/game → write
    return 'write';
  }

  if (httpMethod === 'GET') return 'read';
  if (isReadOnly) return 'read';
  if (DESTRUCTIVE_VERBS.test(name)) return 'destructive';
  return 'write';
}
```

- [ ] **Step 5: Add `'ui'` to `inferActionAuth` type union and no-auth rule**

Update the signature:
```typescript
export function inferActionAuth(opts: {
  safety: SafetyLevel;
  httpMethod?: string;
  isReadOnly?: boolean;
  appAuthType?: AuthType;
  type: 'api' | 'contract' | 'function' | 'socket' | 'ui';
}): ActionAuth {
```

Add before the final `return { required: 'required' }`:
```typescript
  // No-auth app → read and write actions are public.
  // Financial/confidential/destructive retain their required auth even on no-auth apps
  // (those actions handle money or PII and should always require confirmation).
  if ((appAuthType === 'none' || !appAuthType) && (safety === 'read' || safety === 'write')) {
    return { required: 'public' };
  }

  return { required: 'required' };
```

- [ ] **Step 6: Run tests — expect green**

```bash
npm test -- --testPathPattern=intent-classifier 2>&1 | tail -20
```

Expected: all pass.

- [ ] **Step 7: Fix `deriveAgentSafe` call signatures in existing tests**

In `tests/intent-classifier.test.ts`, the existing tests call `deriveAgentSafe` with only one argument (e.g. `deriveAgentSafe('read')`). The function requires two: `(safety, name)`. Update them:

```typescript
// Old (1 arg — TypeScript error in strict mode):
expect(deriveAgentSafe('read')).toBe(true);
expect(deriveAgentSafe('write')).toBe(true);
expect(deriveAgentSafe('financial')).toBe(false);

// New (2 args):
expect(deriveAgentSafe('read', 'getUser')).toBe(true);
expect(deriveAgentSafe('write', 'updateProfile')).toBe(true);
expect(deriveAgentSafe('financial', 'transfer')).toBe(false);
```

- [ ] **Step 8: Commit**

```bash
git add src/parser/intent-classifier.ts tests/intent-classifier.test.ts
git commit -m "fix(intent): castVote→governance.vote, function safety, no-auth public (read+write only), add ui type"
```

---

## Task 4: Auth Detector Expansion

**Files:**
- Modify: `src/parser/auth-detector.ts`
- Create: `tests/auth-detector.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/auth-detector.test.ts`:

```typescript
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
```

- [ ] **Step 2: Run — expect failures**

```bash
npm test -- --testPathPattern=auth-detector 2>&1 | tail -20
```

- [ ] **Step 3: Add new `AUTH_SIGNALS` entries**

In `src/parser/auth-detector.ts`, add to `AUTH_SIGNALS` array (preserving existing entries):

```typescript
  // Farcaster SIWF — must be before SIWE (higher priority)
  { pattern: '@farcaster/auth-kit',        type: 'farcaster-siwf', priority: 98 },
  { pattern: 'verifySignInMessage',        type: 'farcaster-siwf', priority: 98 },
  { pattern: 'useSignIn',                  type: 'farcaster-siwf', priority: 95 },

  // SIWE
  { pattern: 'SiweMessage',               type: 'siwe', priority: 95 },
  { pattern: "from 'siwe'",               type: 'siwe', priority: 95 },
  { pattern: 'verifySiweMessage',         type: 'siwe', priority: 95 },
  { pattern: 'generateNonce',             type: 'siwe', priority: 90 },

  // SAML
  { pattern: 'samlify',                   type: 'saml', priority: 92 },
  { pattern: 'passport-saml',             type: 'saml', priority: 92 },
  { pattern: '@node-saml',                type: 'saml', priority: 92 },
  { pattern: 'SAMLResponse',              type: 'saml', priority: 88 },

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

```

**Also modify the two existing Clerk entries** (do NOT add new ones — just change `type: 'bearer'` to `type: 'clerk'` on the lines that already mention `clerkMiddleware` and `currentUser`):

```typescript
// Before:
{ pattern: 'clerkMiddleware', type: 'bearer', priority: 88 },
{ pattern: 'currentUser',     type: 'bearer', priority: 70 },

// After:
{ pattern: 'clerkMiddleware', type: 'clerk',  priority: 88 },
{ pattern: 'currentUser',     type: 'clerk',  priority: 70 },
```

- [ ] **Step 4: Update `readPackageJson` with new deps**

```typescript
  if (deps['@farcaster/auth-kit'])                this.applySignal({ pattern: 'farcaster-siwf', type: 'farcaster-siwf', priority: 98 });
  if (deps['siwe'])                               this.applySignal({ pattern: 'siwe', type: 'siwe', priority: 95 });
  if (deps['samlify'] || deps['passport-saml'])  this.applySignal({ pattern: 'saml', type: 'saml', priority: 92 });
  if (deps['@clerk/nextjs'] || deps['@clerk/clerk-sdk-node']) this.applySignal({ pattern: 'clerk', type: 'clerk', header: 'Authorization', scheme: 'Bearer', priority: 88 });
  if (deps['@privy-io/react-auth'])               this.applySignal({ pattern: 'privy', type: 'privy', priority: 85 });
  if (deps['@dynamic-labs/sdk-react-core'])       this.applySignal({ pattern: 'dynamic', type: 'dynamic', priority: 85 });
  if (deps['magic-sdk'] || deps['@magic-sdk/admin']) this.applySignal({ pattern: 'magic', type: 'magic', priority: 80 });
  if (deps['@simplewebauthn/browser'])            this.applySignal({ pattern: 'passkey', type: 'passkey', priority: 78 });
  if (deps['@supabase/supabase-js'])              this.applySignal({ pattern: 'supabase', type: 'supabase', priority: 75 });
```

- [ ] **Step 5: Add `AuthFlowInferrer` and integrate into `AuthDetector.getAuth()`**

**a)** At the bottom of `src/parser/auth-detector.ts`, add the `AuthFlowInferrer` class:

```typescript
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
```

**b)** Integrate it into `AuthDetector`. In `AuthDetector`:

1. Add a private `_flowInferrer = new AuthFlowInferrer()` field.
2. In `scanContent(content: string)`, after updating signals also call: `this._flowInferrer.addContent(content);`
3. In `getAuth()`, after building the `AuthConfig` object, merge the flow URLs:

```typescript
getAuth(): AuthConfig {
  // ... existing logic to determine type, header, scheme, docsUrl ...
  const base: AuthConfig = { type, header, scheme, docsUrl };
  // Merge flow URLs inferred from scanned content
  const flowFields = this._flowInferrer.infer(type);
  return { ...base, ...flowFields };
}
```

This ensures `d.getAuth().nonceUrl` is populated when the scanned content contains `/api/auth/nonce` — which is what the flow URL tests assert.

- [ ] **Step 6: Run tests — expect green**

```bash
npm test -- --testPathPattern=auth-detector 2>&1 | tail -20
```

- [ ] **Step 7: Commit**

```bash
git add src/parser/auth-detector.ts tests/auth-detector.test.ts
git commit -m "feat(auth): expand to 15 auth types — siwe, siwf, clerk, privy, dynamic, magic, passkey, saml, supabase + AuthFlowInferrer"
```

---

## Task 5: Prisma → `dataModel` Refactor

**Files:**
- Modify: `src/parser/prisma-parser.ts`
- Create: `tests/prisma-parser.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/prisma-parser.test.ts`:

```typescript
import { PrismaParser } from '../src/parser/prisma-parser';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

function withTempSchema(content: string, fn: (filePath: string) => void) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'prisma-test-'));
  const file = path.join(dir, 'schema.prisma');
  fs.writeFileSync(file, content);
  try { fn(file); } finally { fs.rmSync(dir, { recursive: true }); }
}

const SCHEMA = `
model User {
  id        String   @id @default(cuid())
  name      String?
  email     String   @unique
  createdAt DateTime @default(now())
}

model Post {
  id      String @id @default(cuid())
  title   String
  userId  String
}
`;

describe('PrismaParser', () => {
  it('returns empty actions array', () => {
    withTempSchema(SCHEMA, (file) => {
      const parser = new PrismaParser();
      const result = parser.parseFile(file);
      expect(result.actions).toHaveLength(0);
    });
  });

  it('returns dataModel with User and Post', () => {
    withTempSchema(SCHEMA, (file) => {
      const parser = new PrismaParser();
      const result = parser.parseFile(file);
      expect(result.dataModel).toHaveProperty('User');
      expect(result.dataModel).toHaveProperty('Post');
    });
  });

  it('User model has correct fields', () => {
    withTempSchema(SCHEMA, (file) => {
      const parser = new PrismaParser();
      const { dataModel } = parser.parseFile(file);
      expect(dataModel['User'].fields).toHaveProperty('name');
      expect(dataModel['User'].fields).toHaveProperty('email');
      // id and createdAt are auto-generated — excluded from writeable fields
    });
  });

  it('includes description per model', () => {
    withTempSchema(SCHEMA, (file) => {
      const parser = new PrismaParser();
      const { dataModel } = parser.parseFile(file);
      expect(dataModel['User'].description).toContain('User');
    });
  });
});
```

- [ ] **Step 2: Run — expect failures**

```bash
npm test -- --testPathPattern=prisma-parser 2>&1 | tail -20
```

Expected: `result.actions` undefined / `result.dataModel` undefined because `parseFile` currently returns `AgentAction[]`.

- [ ] **Step 3: Refactor `PrismaParser.parseFile`**

In `src/parser/prisma-parser.ts`:

1. Import `DataModelEntry` from `../types`
2. Change the return type to `{ actions: AgentAction[], dataModel: Record<string, DataModelEntry> }`
3. Remove all CRUD action generation (the 5-actions-per-model loop)
4. Instead, build `dataModel`:

```typescript
parseFile(filePath: string): { actions: AgentAction[]; dataModel: Record<string, DataModelEntry> } {
  const content = fs.readFileSync(filePath, 'utf8');
  const dataModel: Record<string, DataModelEntry> = {};

  // Parse model blocks
  const modelRegex = /^model\s+(\w+)\s*\{([^}]+)\}/gm;
  let match: RegExpExecArray | null;
  while ((match = modelRegex.exec(content)) !== null) {
    const modelName = match[1];
    const body = match[2];
    const fields: Record<string, { type: string; required?: boolean; description?: string }> = {};

    for (const line of body.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('@@')) continue;
      const fieldMatch = /^(\w+)\s+(\w+)(\[\])?([\?])?(.*)?$/.exec(trimmed);
      if (!fieldMatch) continue;
      const [, fieldName, fieldType, isList, isOptional, attrs] = fieldMatch;
      // Skip auto-managed fields
      if (attrs?.includes('@id') || attrs?.includes('@default(now())') || attrs?.includes('@updatedAt')) continue;

      fields[fieldName] = {
        type: this.mapFieldType(fieldType, !!isList),
        required: !isOptional,
      };
    }

    dataModel[modelName] = {
      description: `Prisma model: ${modelName}`,
      fields,
    };
  }

  return { actions: [], dataModel };
}

private mapFieldType(prismaType: string, isList: boolean): string {
  if (isList) return 'array';
  const map: Record<string, string> = {
    String: 'string', Int: 'number', Float: 'number', Decimal: 'number',
    Boolean: 'boolean', DateTime: 'string', Json: 'object', Bytes: 'string',
  };
  return map[prismaType] ?? 'object';
}
```

Also fix the pre-existing bug: any remaining calls to `deriveAgentSafe` must pass two arguments. Since `actions` is now always `[]`, this bug is eliminated automatically.

- [ ] **Step 4: Run tests — expect green**

```bash
npm test -- --testPathPattern=prisma-parser 2>&1 | tail -20
```

- [ ] **Step 5: Commit**

```bash
git add src/parser/prisma-parser.ts tests/prisma-parser.test.ts
git commit -m "feat(prisma): move model output from actions[] to dataModel — no more CRUD noise in manifest"
```

---

## Task 6: Generator + CLI — New Manifest Fields

**Files:**
- Modify: `src/generator/json.ts`
- Modify: `src/cli.ts`
- Modify: `src/index.ts`
- Modify: `tests/validator.test.ts`

- [ ] **Step 1: Update `ManifestGenerator`**

In `src/generator/json.ts`, update the `generate` signature and output:

```typescript
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
```

- [ ] **Step 2: Update `cli.ts` — Prisma branch, deduplication, new options, validator**

**a) Add `--base-url` option** after the existing `--auth-docs` option:

```typescript
.option('--base-url <url>', 'canonical base URL for the app (e.g. https://myapp.com)')
```

**b) Declare `dataModel` accumulator** before the file loop:

```typescript
const dataModel: Record<string, import('./types').DataModelEntry> = {};
```

**c) Fix Prisma branch** (around line 91):

```typescript
if (ext === prismaExt || base === 'schema.prisma') {
  try {
    const result = prismaParser.parseFile(file);
    Object.assign(dataModel, result.dataModel);
    // result.actions is always [] — nothing to push
  } catch { /* ignore */ }
  continue;  // ← critical: prevents fall-through to TSParser
}
```

**d) Fix deduplication** (around line 133):

```typescript
const uniqueActions = new Map<string, AgentAction>();
for (const action of actions) {
  const existing = uniqueActions.get(action.name);
  const aLen = Object.keys(action.parameters?.properties ?? {}).length;
  const eLen = Object.keys(existing?.parameters?.properties ?? {}).length;
  if (!existing || aLen > eLen) {
    uniqueActions.set(action.name, action);
  }
}
```

**e) Update `ManifestGenerator` call** to pass `baseUrl` and `dataModel`:

```typescript
const manifest = generator.generate(
  Array.from(uniqueActions.values()),
  appMetadata,
  tsParser.getCapabilities(),
  auth,
  '1.0.0',
  {
    baseUrl: options.baseUrl ?? appMetadata.url,
    dataModel,
  }
);
```

**f) Update console summary**:

```typescript
const uiCount = Array.from(uniqueActions.values()).filter(a => a.type === 'ui').length;
const modelCount = Object.keys(dataModel).length;
console.log(`✅ agent.json generated at: ${outputPath}`);
console.log(`   ${uniqueActions.size} actions${uiCount ? ` · ${uiCount} ui-interactions` : ''} · ${manifest.capabilities.length} capabilities · auth: ${auth.type}`);
if (modelCount > 0) console.log(`   dataModel: ${modelCount} models`);
```

**g) Update `validateManifest` constants** and the action validator to check `parameters.properties`/`returns` instead of `inputs`/`outputs`:

```typescript
const AUTH_TYPES = new Set([
  'none', 'bearer', 'api-key', 'oauth2', 'basic', 'cookie',
  'siwe', 'farcaster-siwf', 'farcaster-frame',
  'clerk', 'privy', 'dynamic', 'magic', 'passkey', 'saml', 'supabase',
]);

const ACTION_TYPES = new Set(['api', 'contract', 'function', 'socket', 'ui']);
```

In the action validation loop, replace `inputs`/`outputs` checks:

```typescript
if (!action.parameters || typeof action.parameters.properties !== 'object')
  errors.push(`${prefix}: \`parameters.properties\` must be an object`);
if (!action.returns || typeof action.returns.type !== 'string')
  errors.push(`${prefix}: \`returns.type\` must be a string`);
```

- [ ] **Step 3: Update `src/index.ts` exports**

Add to the exports:

```typescript
export { SocketIOParser, looksLikeSocketIOFile } from './parser/socketio-parser';
export type { DataModelEntry } from './types';
```

- [ ] **Step 4: Update validator tests for new schema**

In `tests/validator.test.ts`, update `validAction` to use `parameters.properties`/`returns`, update `AUTH_TYPES` and `ACTION_TYPES` sets to match the new values, and add tests:

```typescript
// Update the test's local AUTH_TYPES set:
const AUTH_TYPES = new Set([
  'none', 'bearer', 'api-key', 'oauth2', 'basic', 'cookie',
  'siwe', 'farcaster-siwf', 'farcaster-frame',
  'clerk', 'privy', 'dynamic', 'magic', 'passkey', 'saml', 'supabase',
]);
const ACTION_TYPES = new Set(['api', 'contract', 'function', 'socket', 'ui']);

// Add new test cases:
it('accepts siwe auth type', () => {
  const m = { ...validManifest, auth: { type: 'siwe' } };
  expect(validateManifest(m)).toHaveLength(0);
});

it('accepts type ui action', () => {
  const uiAction = { ...validAction, type: 'ui' };
  expect(validateManifest({ ...validManifest, actions: [uiAction] })).toHaveLength(0);
});

it('fails action missing parameters.properties', () => {
  const bad = { ...validAction, parameters: undefined };
  const errors = validateManifest({ ...validManifest, actions: [bad] });
  expect(errors.some(e => e.includes('parameters.properties'))).toBe(true);
});

it('fails action missing returns.type', () => {
  const bad = { ...validAction, returns: { description: 'x' } };
  const errors = validateManifest({ ...validManifest, actions: [bad] });
  expect(errors.some(e => e.includes('returns.type'))).toBe(true);
});
```

- [ ] **Step 5: Run full test suite**

```bash
npm test 2>&1 | tail -30
```

Expected: all tests pass.

- [ ] **Step 6: Build and smoke test**

```bash
npm run build
node dist/cli.js -p /Users/ayobamiadefolalu/Desktop/forge -o /tmp/test-agent.json 2>&1
cat /tmp/test-agent.json | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')); console.log('actions:', d.actions.length, '| dataModel:', Object.keys(d.dataModel??{}).length, '| auth:', d.auth.type)"
```

Expected output similar to:
```
actions: 18 | dataModel: 8 | auth: siwe
```

- [ ] **Step 7: Commit**

```bash
git add src/generator/json.ts src/cli.ts src/index.ts tests/validator.test.ts
git commit -m "feat(cli,generator): baseUrl, dataModel output, updated validator for v4 schema, deduplication fix"
```

---

## Task 7: Integration Smoke Test + Version Bump

**Files:**
- Modify: `package.json` (version bump)
- Modify: `schema/agent.schema.json`

- [ ] **Step 1: Update `schema/agent.schema.json`**

The JSON Schema needs to reflect `parameters.properties`/`returns`, the new auth types, `ui` action type, and top-level `baseUrl`/`dataModel`. Open the file and update:

- `properties.auth.properties.type.enum` — add all 9 new values
- `definitions.AgentAction.properties` — rename `inputs` → `parameters` (object with `properties` sub-key), rename `outputs` → `returns`
- `definitions.AgentAction.properties.type.enum` — add `"ui"`
- `properties.baseUrl` — add `{ "type": "string", "format": "uri" }`
- `properties.dataModel` — add `{ "type": "object", "additionalProperties": { "$ref": "#/definitions/DataModelEntry" } }`
- Add `definitions.DataModelEntry`

- [ ] **Step 2: Run validate command on generated manifest**

```bash
node dist/cli.js validate /tmp/test-agent.json
```

Expected: `✅ /tmp/test-agent.json is valid`

- [ ] **Step 3: Bump version**

In `package.json`, change `"version": "3.3.0"` to `"version": "4.0.0"`.

Also update the Commander version string in `src/cli.ts` (line ~35):
```typescript
// Before:
.version('3.1.0')

// After:
.version('4.0.0')
```
This ensures `npx agent-manifest --version` prints `4.0.0`.

- [ ] **Step 4: Final test run**

```bash
npm test 2>&1 | tail -10
```

Expected: all pass.

- [ ] **Step 5: Final commit**

```bash
git add package.json schema/agent.schema.json src/cli.ts
git commit -m "chore: bump to v4.0.0, update JSON schema for v4 manifest format"
```

---

## Verification Checklist

After all tasks complete:

- [ ] `npm test` — all tests pass
- [ ] `npm run build` — compiles cleanly, 0 TypeScript errors
- [ ] `node dist/cli.js -p /path/to/forge -o /tmp/out.json` — generates manifest with `dataModel`, correct `auth.type: "siwe"`, `parameters.properties` on all actions
- [ ] `node dist/cli.js validate /tmp/out.json` — `✅ valid`
- [ ] `castVote` in an app → `intent: "governance.vote"` (not `social.cast`)
- [ ] Forge app → `auth.type: "siwe"` with `nonceUrl: "/api/auth/nonce"`
- [ ] Prisma models not in `actions[]` — in `dataModel` instead
