# agent-manifest v4 — Design Spec

**Date:** 2026-03-21
**Status:** Revised after spec review — approved for implementation
**Package:** `agent-manifest` (bin aliases: `agentjson`, `agent-json`, `farcaster-agent-compiler`)

---

## Overview

`agent-manifest` is a universal CLI compiler that scans any web app codebase and generates an `agent.json` manifest — a machine-readable description of every action an AI agent can take programmatically on that app, without touching any UI.

**Core principle:** Buttons and UI are the human layer. Agents call APIs, socket events, Server Actions, and contracts directly. The manifest exposes the programmatic surface behind every interaction a user can perform.

**v4 goals:**
1. Cover all UI interaction types (pure client-side onClick, form submit) by auto-detecting and generating programmatic equivalents
2. Cover all 15 auth/sign-in patterns used across the web
3. Rename schema fields for JSON Schema / SDK tool-calling compatibility (`inputs` → `parameters.properties`, `outputs` → `returns`)
4. Move Prisma CRUD out of `actions` into a `dataModel` section
5. Add `baseUrl`, `uiPath`, `callStrategy` to support agent routing
6. Add `agent.config.ts` escape hatch for explicit declarations

---

## 1. Type System Changes (`src/types.ts`)

### 1.1 `AuthType` — expanded from 7 to 15 values

```typescript
export type AuthType =
  // Existing
  | 'none'
  | 'bearer'          // JWT Bearer (generic)
  | 'api-key'         // X-API-Key header or ?apiKey= query param
  | 'oauth2'          // OAuth2 / NextAuth / Auth.js
  | 'basic'           // HTTP Basic auth
  | 'cookie'          // Session cookie (iron-session, express-session)
  // New
  | 'siwe'            // Sign-In with Ethereum (EIP-4361)
  | 'farcaster-siwf'  // Sign-In with Farcaster (@farcaster/auth-kit)
  | 'farcaster-frame' // Farcaster frame signature (existing, kept)
  | 'clerk'           // Clerk — promoted from bearer (own type for clarity)
  | 'privy'           // Privy wallet+social auth
  | 'dynamic'         // Dynamic.xyz wallet auth
  | 'magic'           // Magic Link passwordless
  | 'passkey'         // WebAuthn / Passkeys
  | 'saml'            // Enterprise SSO (SAML 2.0)
  | 'supabase';       // Supabase Auth
```

### 1.2 `AuthConfig` — auth-flow fields added

```typescript
export interface AuthConfig {
  type: AuthType;
  header?: string;      // e.g. "Authorization", "X-API-Key"
  scheme?: string;      // e.g. "Bearer"
  queryParam?: string;  // for api-key passed as query string
  docsUrl?: string;     // URL where agents can obtain credentials
  // New fields
  loginUrl?: string;    // URL to initiate auth flow (e.g. "/sign-in")
  nonceUrl?: string;    // For SIWE/SIWF: nonce endpoint (e.g. "/api/auth/nonce")
  tokenUrl?: string;    // OAuth2: token exchange endpoint
  callbackUrl?: string; // OAuth2: redirect callback URL
  scopes?: string[];    // OAuth2/OIDC: required scopes
}
```

### 1.3 `AgentAction` — field renames + new fields

```typescript
export interface AgentAction {
  name: string;
  description: string;
  intent: string;         // domain.verb format e.g. "game.play"
  type: 'api' | 'contract' | 'function' | 'socket' | 'ui'; // 'ui' is new
  location: string;       // URL path (for api/ui) or file path (for function)
  method?: string;        // HTTP method for api type
  socketEvent?: string;   // Socket.IO event name for socket type
  abiFunction?: string;   // ABI function name for contract type
  isReadOnly?: boolean;   // ABI view/pure for contract type
  chainId?: number;
  contractAddress?: string | { $env: string };
  safety: SafetyLevel;
  agentSafe: boolean;
  requiredAuth: ActionAuth;

  // Renamed from `inputs` / `outputs` (PR #3 — JSON Schema / SDK compatibility)
  // NOTE: `required` is kept as a per-property field inside ParameterProperty
  // rather than a JSON Schema `required: string[]` array. This is an intentional
  // extension — document it clearly. Tools expecting strict JSON Schema must
  // transform this to the array form before use.
  parameters: {
    properties: Record<string, ParameterProperty>;
  };
  returns: {
    type: string;
    description?: string;
  };

  // New fields
  uiPath?: string;        // Page URL hosting this action e.g. "/game", "/onboarding"
  callStrategy?:            // How an agent should invoke this action
    | 'direct-api'          // HTTP fetch to `location` (for type: "api")
    | 'server-action'       // POST to page URL with Next-Action header (for type: "function")
    | 'form-submission'     // Navigate to `uiPath`, fill form fields, submit DOM form
    | 'socket-emit'         // socket.emit(socketEvent, parameters.properties)
    | 'contract-write'      // blockchain write via wagmi/viem
    | 'ui-interaction';     // Click/fill element at `selector` on `uiPath` (for type: "ui")
  selector?: string;      // CSS selector template for ui type "[data-column='{column}']"
  interaction?:           // For ui type: kind of DOM interaction
    | 'click' | 'fill' | 'select' | 'toggle';
}
```

### 1.4 `AgentManifest` — new top-level fields

```typescript
export interface AgentManifest {
  name: string;
  description: string;
  version: string;
  author?: string;
  url?: string;
  baseUrl?: string;    // NEW: canonical base URL e.g. "https://myapp.com"
  auth: AuthConfig;
  metadata: AppMetadata;
  capabilities: string[];
  actions: AgentAction[];
  dataModel?: Record<string, DataModelEntry>; // NEW: Prisma models moved here
}

export interface DataModelEntry {
  description?: string;
  fields: Record<string, {
    type: string;
    required?: boolean;
    description?: string;
  }>;
}
```

---

## 2. Auth Detector Expansion (`src/parser/auth-detector.ts`)

Add 40 new signals to `AUTH_SIGNALS` covering 9 new auth types:

| Auth Type | Priority | Key Detection Signals |
|---|---|---|
| `farcaster-siwf` | 98 | `@farcaster/auth-kit`, `createClient` (auth-kit), `verifySignInMessage`, `useSignIn` |
| `siwe` | 95 | `SiweMessage`, `siwe`, `verifySiweMessage`, `generateNonce`, `parseMessage` |
| `saml` | 92 | `samlify`, `passport-saml`, `@node-saml`, `SAMLResponse`, `saml.validatePostResponse` |
| `farcaster-frame` | 100 | (existing — no change) |
| `clerk` | 88 | `@clerk/nextjs` dep, `clerkMiddleware`, `currentUser` — promoted from `bearer` |
| `privy` | 85 | `@privy-io/react-auth` dep, `usePrivy`, `PrivyProvider`, `authenticated` |
| `dynamic` | 85 | `@dynamic-labs/sdk-react-core` dep, `DynamicContextProvider`, `useDynamicContext` |
| `magic` | 80 | `magic-sdk` dep, `@magic-sdk` dep, `Magic(`, `magic.auth.loginWithEmailOTP` |
| `passkey` | 78 | `@simplewebauthn/browser` dep, `startAuthentication`, `startRegistration`, `navigator.credentials.create` |
| `supabase` | 75 | `@supabase/supabase-js` dep + `supabase.auth`, `createClient` + auth usage |
| `oauth2` | 90 | (existing — unchanged) |
| `bearer` | 70 | (existing — generic JWT, no longer used for Clerk) |
| `cookie` | 30 | (existing) |

**Auth-flow URL inference by type:**

When auth is detected, the compiler attempts to set `AuthConfig` flow fields by scanning for known patterns:
- `siwe` / `farcaster-siwf`: looks for nonce endpoint patterns (`/api/auth/nonce`, `generateNonce`) → `nonceUrl`
- `oauth2`: looks for `/api/auth/callback`, `callbackUrl` → `callbackUrl`
- `clerk`/`privy`/`dynamic`: looks for sign-in page (`/sign-in`) → `loginUrl`

`readPackageJson()` updated to check all new dependency names.

---

## 3. UI Action Parser — New File (`src/parser/ui-action-parser.ts`)

Scans JSX/TSX files for event handlers and traces them to their implementations.

### Detection flow

```
Scan file for onClick/onSubmit/onChange handlers
  ↓
Extract function reference
  ↓
Trace to function definition — max depth: 2 import hops
  If depth limit reached without finding network call → treat conservatively as "ui"
  ↓
Classify:
  ├─ Calls socket.emit / fetch / API route → SKIP (already in manifest)
  │   └─ But: set uiPath on the existing action entry
  ├─ Calls a Server Action (imported from 'use server' file) → SKIP (already detected)
  │   └─ But: set uiPath on the existing Server Action entry
  └─ Pure client-side (setState, local logic, no network) → EMIT type:"ui" entry
```

**Import traversal depth limit:** The parser follows function references across import boundaries up to **2 hops** (current file → imported file → one more level). At depth 2, if no network call has been found, the handler is classified as pure client-side. This prevents unbounded graph walking on large projects while correctly handling common patterns like `page.tsx → useGame.ts → socket.ts`.

### Output for pure client-side handlers

```json
{
  "name": "dropPiece",
  "description": "UI action: dropPiece",
  "intent": "game.play",
  "type": "ui",
  "location": "./apps/web/src/app/game/page.tsx",
  "uiPath": "/game",
  "callStrategy": "ui-interaction",
  "selector": "[data-agent-action='dropPiece'][data-column='{column}']",
  "interaction": "click",
  "agentSafe": true,
  "safety": "write",
  "requiredAuth": { "required": "required" },
  "parameters": { "properties": { "column": { "type": "number" } } },
  "returns": { "type": "void" }
}
```

### `uiPath` derivation

Derived from the file path using Next.js App Router conventions:
- `app/game/page.tsx` → `/game`
- `app/onboarding/page.tsx` → `/onboarding`
- `app/page.tsx` → `/`
- Dynamic segments: `app/game/[gameId]/page.tsx` → `/game/:gameId` (colon notation, OpenAPI style)
- Non-Next.js: use `--url` base path or leave as file path

### `data-agent-action` high-confidence annotation

If a JSX element has `data-agent-action`, it's treated as an explicit declaration:
```tsx
<button
  data-agent-action="dropPiece"
  data-agent-param-column={i}
  onClick={() => handleMove(i)}
>
```
This generates a `type: "ui"` entry even if the handler has network calls (the developer is explicitly declaring this as an agent-facing action).

### Detection heuristics (`looksLikeUIFile`)

```regex
/onClick\s*=\s*\{/
/onSubmit\s*=\s*\{/
/data-agent-action/
/<button|<form|<input|<select/
```

Only scan files with JSX content (`.tsx`, `.jsx`).

---

## 4. `--generate-stubs` Flag

When passed, for every `type: "ui"` action discovered that has **no** corresponding backend API, the compiler writes `agent-actions.generated.ts` in the project root:

```typescript
// agent-actions.generated.ts
// Auto-generated by agent-manifest — fill in server-side implementation
'use server'

/**
 * @agent-action intent="game.play"
 * @param column The column to drop a piece in
 */
export async function dropPiece_action(column: number): Promise<void> {
  throw new Error('Not implemented — generated stub for agent action "dropPiece"')
}
```

After the developer implements the stub, they re-run the compiler. The stub file has `'use server'` so it becomes a proper Server Action, which the TSParser detects — the `type: "ui"` entry is replaced by `type: "function"`.

**Idempotency:** Re-running the compiler only adds stubs for new actions, never overwrites existing ones. An existing stub is considered "unimplemented" if and only if its body still contains the exact sentinel string `'Not implemented — generated stub for agent action'`. Any other body (including a blank function) is treated as implemented and left untouched.

**Framework note:** The `'use server'` directive is only emitted when the compiler detects a Next.js project (presence of `next` in `package.json`). For Express/Hono/other projects, stubs are emitted as plain `async function` exports without the directive.

---

## 5. FormData Extractor — New Module (`src/parser/formdata-extractor.ts`)

Integrated into `TSParser` section 3e (Server Actions). Walks the function body AST after parsing parameters, looking for `formData.get()` / `formData.getAll()` calls to supplement or fill missing inputs.

**Patterns detected:**
```typescript
formData.get("agentName")                // → inputs.agentName: { type: "string" }
String(formData.get("modelId"))          // → inputs.modelId: { type: "string" }
formData.get(`channel:${key}`)           // → skip (dynamic key, not static)
formData.get("channel:telegram")         // → inputs["channel:telegram"]: { type: "string" }
formData.getAll("tags")                  // → inputs.tags: { type: "array" }
formData.has("key")                      // → skip (presence check, not value)
```

**Integration point:** `FormDataExtractor` runs inside `TSParser` section 3e on the function body AST, **after** `extractFunctionParams()`. It augments the result: if `extractFunctionParams` returns `{ formData: { type: 'object' } }` (the generic FormData type parameter), the extractor replaces that single `formData` entry with the individual fields it found. It does not merge with Zod — Zod extraction runs only for API routes (3b/3c), not Server Actions.

---

## 6. Prisma Parser Refactor (`src/parser/prisma-parser.ts`)

`parseFile()` return type changes from `AgentAction[]` to:

```typescript
interface PrismaParseResult {
  actions: AgentAction[];   // always empty (no more CRUD actions)
  dataModel: Record<string, DataModelEntry>;
}
```

`DataModelEntry` per model:
```typescript
{
  "User": {
    "description": "Prisma model: User",
    "fields": {
      "walletAddress": { "type": "string", "required": false },
      "name":          { "type": "string", "required": false },
      "createdAt":     { "type": "string", "required": true }
    }
  }
}
```

In `cli.ts`, the main loop accumulates a `dataModel` map separately:
```typescript
const dataModel: Record<string, DataModelEntry> = {};
// ...
if (ext === prismaExt || base === 'schema.prisma') {
  const result = prismaParser.parseFile(file);
  Object.assign(dataModel, result.dataModel);
  // result.actions is empty — don't push to actions
  continue;  // ← required: prevent fall-through into TSParser
}
```

`ManifestGenerator.generate()` accepts optional `dataModel` param and includes it in the output.

---

## 7. `agent.config.ts` Parser — New File (`src/parser/agent-config-parser.ts`)

Looks for `agent.config.ts` or `agent.config.js` at the project root. Parsed at the start of the CLI run, before file scanning. Explicit config wins on name collision with auto-detected actions.

```typescript
// agent.config.ts — developer-authored
import { defineAgentConfig } from 'agent-manifest'

export default defineAgentConfig({
  baseUrl: 'https://myapp.com',
  auth: {
    loginUrl: '/sign-in',
    nonceUrl: '/api/auth/nonce',
  },
  actions: [
    {
      name: 'dropPiece',
      intent: 'game.play',
      type: 'ui',
      uiPath: '/game',
      selector: "[data-column='{column}']",
      interaction: 'click',
      safety: 'write',
      agentSafe: true,
      parameters: {
        properties: {
          column: { type: 'number', minimum: 0, maximum: 6 }
        }
      },
      returns: { type: 'void' }
    }
  ]
})
```

`defineAgentConfig` is a typed identity function exported from `src/index.ts` — no runtime overhead, exists only for IntelliSense.

**Parser implementation:** `agent.config.ts` is loaded using `tsx` (added as a peer dependency) via child process exec:
```
npx tsx --eval "import cfg from './agent.config.ts'; process.stdout.write(JSON.stringify(cfg.default ?? cfg))"
```
`tsx` handles TypeScript compilation in-process without a separate build step. If `tsx` is not available, the compiler falls back to `agent.config.js` (plain JavaScript). If neither file exists, the config parser is a no-op.

The `import { defineAgentConfig } from 'agent-manifest'` inside the user's config is resolved against the globally installed or npx-cached version of the package — this works in both published and local development scenarios. The circular dependency risk (package loading itself) is avoided because `defineAgentConfig` is a simple identity function with no side effects.

`tsx` is added to `peerDependencies` with a `^4.0.0` range and a clear install note in the README.

---

## 8. Intent Classifier Fixes (`src/parser/intent-classifier.ts`)

Incorporating PR #3 bug fixes + extensions:

**Governance priority fix:** The governance pattern `/\b(vote|castVote|submitVote)/i` must appear before the social pattern `/\b(cast|...)/i` in `INTENT_RULES`. Rather than reordering all governance rules above all social rules (which would break plain `cast` → `social.cast`), add `castVote` explicitly to the governance pattern only: `/\b(vote|castVote|submitVote|propose|delegate)/i`. This prevents the social `cast` pattern from matching `castVote` while preserving `cast` → `social.cast` for Farcaster apps.

**`classifySafety` improvements for `type: "function"`:**
```typescript
if (type === 'function') {
  if (FINANCIAL_VERBS.test(name)) return 'financial';
  if (CONFIDENTIAL_NOUNS.test(name)) return 'confidential';
  if (DESTRUCTIVE_VERBS.test(name)) return 'destructive';
  // Auth-related functions are confidential even without PII nouns
  if (/\b(login|logout|signIn|signOut|register|signup|createAccount)/i.test(name)) return 'confidential';
  // Social/game/update actions → write (not the default)
  if (/\b(compose|follow|unfollow|like|react|vote|cast|reply|share|recast|propose|joinGame|makeMove|dropPiece)/i.test(name)) return 'write';
  if (httpMethod === 'GET') return 'read';
  return 'write';
}
```

**No-auth app public inference:** All actions on apps with `appAuthType === 'none'` return `{ required: 'public' }`.

**`isReadOnly` order fix:** Check `isReadOnly` before destructive verbs for ABI functions.

**`classifySafety` + `inferActionAuth` signature:** Add `'ui'` to the `type` union in both functions.

---

## 9. CLI Changes (`src/cli.ts`)

**New options:**
- `--base-url <url>` — sets `baseUrl` in manifest (overrides `--url`)
- `--generate-stubs` — writes `agent-actions.generated.ts` for unimplemented UI actions
- `--auth-type` extended to accept all 15 new auth type values

**Updated validator constants:**
```typescript
const AUTH_TYPES = new Set([
  'none', 'bearer', 'api-key', 'oauth2', 'basic', 'cookie',
  'siwe', 'farcaster-siwf', 'farcaster-frame',
  'clerk', 'privy', 'dynamic', 'magic', 'passkey', 'saml', 'supabase'
]);

const ACTION_TYPES = new Set(['api', 'contract', 'function', 'socket', 'ui']);
```

**Deduplication fix (from PR #3):**
```typescript
// Before (broken when parameters.properties might be undefined)
Object.keys(action.parameters.properties).length > Object.keys(existing.parameters.properties).length
// Fixed:
const aLen = Object.keys(action.parameters?.properties ?? {}).length;
const eLen = Object.keys(existing.parameters?.properties ?? {}).length;
if (!existing || aLen > eLen) uniqueActions.set(action.name, action);
```

**Console output additions:**
```
✅ agent.json generated at: ./public/agent.json
   42 actions · 8 ui-interactions · 3 capabilities · auth: siwe
   dataModel: 5 models
   ⚠  3 ui-interactions have no backend — run with --generate-stubs to scaffold Server Actions
```

**DiscoveryService fix (from PR #3):** Include `looksLikeSocketIOFile` in the content-relevance check. Also add `looksLikeUIFile` for JSX/TSX event handler detection.

---

## 10. Exports (`src/index.ts`)

New exports:
- `UIActionParser`, `looksLikeUIFile`
- `AgentConfigParser`, `defineAgentConfig`
- `FormDataExtractor`
- `SocketIOParser`, `looksLikeSocketIOFile` (from PR #3)
- All new types: `DataModelEntry`, updated `AuthType`, `AgentManifest`

---

## 11. Example Output (`agent.json` v4)

```json
{
  "name": "forge",
  "description": "Managed platform for running AI agent instances",
  "version": "1.0.0",
  "baseUrl": "https://forge.example.com",
  "auth": {
    "type": "siwe",
    "nonceUrl": "/api/auth/nonce",
    "loginUrl": "/sign-in"
  },
  "capabilities": ["ai", "database", "wallet"],
  "actions": [
    {
      "name": "auth_nonce_GET",
      "type": "api",
      "location": "/api/auth/nonce",
      "method": "GET",
      "intent": "auth.verify",
      "safety": "read",
      "agentSafe": true,
      "callStrategy": "direct-api",
      "requiredAuth": { "required": "public" },
      "parameters": { "properties": {} },
      "returns": { "type": "object", "description": "{ nonce: string }" }
    },
    {
      "name": "launchAgent",
      "type": "function",
      "location": "./apps/web/src/app/onboarding/actions.ts",
      "uiPath": "/onboarding",
      "callStrategy": "server-action",
      "intent": "util.action",
      "safety": "write",
      "agentSafe": true,
      "requiredAuth": { "required": "required" },
      "parameters": {
        "properties": {
          "agentName":         { "type": "string", "required": true },
          "modelId":           { "type": "string", "required": true },
          "channel:telegram":  { "type": "string", "required": false },
          "channel:discord":   { "type": "string", "required": false }
        }
      },
      "returns": { "type": "string", "description": "Error code or null on success" }
    },
    {
      "name": "dropPiece",
      "type": "ui",
      "location": "./apps/web/src/app/game/page.tsx",
      "uiPath": "/game",
      "callStrategy": "ui-interaction",
      "selector": "[data-column='{column}']",
      "interaction": "click",
      "intent": "game.play",
      "safety": "write",
      "agentSafe": true,
      "requiredAuth": { "required": "required" },
      "parameters": {
        "properties": {
          "column": { "type": "number", "minimum": 0, "maximum": 6 }
        }
      },
      "returns": { "type": "void" }
    }
  ],
  "dataModel": {
    "User": {
      "description": "Prisma model: User",
      "fields": {
        "walletAddress": { "type": "string" },
        "name": { "type": "string" }
      }
    },
    "Instance": {
      "description": "Prisma model: Instance",
      "fields": {
        "agentName": { "type": "string", "required": true },
        "status": { "type": "string", "required": true }
      }
    }
  }
}
```

---

## 12. File Changes Summary

| File | Change |
|---|---|
| `src/types.ts` | Add `AuthType` values, new `AgentAction` fields, `DataModelEntry`, `AgentManifest.baseUrl/dataModel` |
| `src/cli.ts` | New flags, updated `ACTION_TYPES`/`AUTH_TYPES` in both compile path and `validateManifest()`, dataModel accumulation with `continue`, stub warning, SocketIO+UI discovery |
| `src/parser/auth-detector.ts` | 40 new signals, 9 new auth types, auth-flow URL inference |
| `src/parser/intent-classifier.ts` | Governance priority fix, classifySafety function improvements, no-auth public rule |
| `src/parser/ts-parser.ts` | `inputs`→`parameters.properties`, `outputs`→`returns`, FormDataExtractor integration, uiPath derivation |
| `src/parser/prisma-parser.ts` | Return `dataModel` instead of CRUD `actions` |
| `src/parser/contract-parser.ts` | `inputs`→`parameters.properties`, `outputs`→`returns` |
| `src/parser/express-parser.ts` | `inputs`→`parameters.properties`, `outputs`→`returns` |
| `src/parser/socketio-parser.ts` | `inputs`→`parameters.properties`, `outputs`→`returns`; export `looksLikeSocketIOFile` |
| `src/parser/trpc-parser.ts` | `inputs`→`parameters.properties`, `outputs`→`returns` |
| `src/parser/sse-parser.ts` | `inputs`→`parameters.properties`, `outputs`→`returns` |
| `src/parser/remix-parser.ts` | `inputs`→`parameters.properties`, `outputs`→`returns` |
| `src/parser/websocket-parser.ts` | `inputs`→`parameters.properties`, `outputs`→`returns` |
| `src/parser/openapi-parser.ts` | `inputs`→`parameters.properties`, `outputs`→`returns` |
| `src/parser/ui-action-parser.ts` | **NEW** — JSX event handler scanning, type:"ui" emission |
| `src/parser/formdata-extractor.ts` | **NEW** — formData.get() extraction for Server Actions |
| `src/parser/agent-config-parser.ts` | **NEW** — agent.config.ts reader |
| `src/generator/json.ts` | Accept and output `baseUrl`, `dataModel` |
| `src/index.ts` | Export all new parsers + `defineAgentConfig` |
| `schema/agent.schema.json` | Update JSON Schema with all new fields |

---

## 13. PR #3 Incorporation

PR #3 (`fix/sdk-compatible-output` by Akin-Tunde) contains valid fixes that are adopted into this spec:
- Schema rename (`inputs`→`parameters.properties`, `outputs`→`returns`) — adopted
- Governance intent priority ordering fix — adopted
- `classifySafety` improvements for `type: "function"` — adopted (extended further)
- No-auth app public inference — adopted
- SocketIO discovery fix — adopted
- Code quality issues (indentation inconsistencies) — fixed in implementation

PR #3 should be closed in favour of the v4 implementation which subsumes all its changes.

---

## 14. Auth-Flow URL Inference Detail

The `AuthDetector` class gains a second scan pass after the primary signal detection. A new `AuthFlowInferrer` helper runs after `getAuth()` is called:

```typescript
class AuthFlowInferrer {
  infer(authType: AuthType, allFileContents: string[]): Partial<AuthConfig> {
    // Scan all file contents for URL patterns relevant to the detected auth type
    for (const content of allFileContents) {
      if (authType === 'siwe' || authType === 'farcaster-siwf') {
        const nonceMatch = content.match(/['"`](\/api\/auth\/nonce[^'"`]*)['"` ]/);
        if (nonceMatch) return { nonceUrl: nonceMatch[1] };
      }
      if (authType === 'oauth2') {
        const callbackMatch = content.match(/['"`](\/api\/auth\/callback[^'"`]*)['"` ]/);
        if (callbackMatch) return { callbackUrl: callbackMatch[1] };
      }
      // loginUrl: scan for common patterns
      const loginMatch = content.match(/['"`](\/sign-in|\/login|\/auth\/login)['"` ]/);
      if (loginMatch) return { loginUrl: loginMatch[1] };
    }
    return {};
  }
}
```

The inferred fields are merged into the final `AuthConfig` after all files have been scanned.

---

## 15. Out of Scope

- Runtime proxy/middleware approach for intercepting React state updates
- Multi-file agent config (one `agent.config.ts` per project)
- Automatic deployment of the manifest to a CDN
- Manifest versioning / diff tracking across runs
- GraphQL parser (future)
- gRPC / Protobuf parser (future)
