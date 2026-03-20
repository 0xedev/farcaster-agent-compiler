# agentjson

A universal CLI compiler that scans any web app codebase and generates a `public/agent.json` manifest — so AI agents can discover and interact with your app without custom integration work.

Works with Next.js (App Router + Pages Router), Express, Hono, Fastify, and any TypeScript/JavaScript project with smart contracts.

## Installation

```bash
# Run once, no install
npx agent-manifest

# Or install globally
npm install -g agent-manifest
```

## Usage

```bash
# Scan current directory, output to public/agent.json
agentjson

# Specify project path and output
agentjson -p ./my-app -o ./public/agent.json

# With auth metadata
agentjson --auth-type bearer --auth-header Authorization --auth-docs https://myapp.xyz/docs/auth

# Add author / URL to manifest
agentjson --author "0xDev" --url https://myapp.xyz

# Validate an existing agent.json
agentjson validate ./public/agent.json
```

## What gets generated

```json
{
  "name": "FlipIt",
  "description": "On-chain coin flip game",
  "version": "1.0.0",
  "author": "0xDev",
  "url": "https://flipit.xyz",
  "auth": { "type": "farcaster-frame" },
  "capabilities": ["wallet", "payments"],
  "actions": [
    {
      "name": "flip",
      "description": "Flip a coin and bet ETH",
      "intent": "game.play",
      "type": "contract",
      "location": "./src/abis/FlipABI.json",
      "abiFunction": "flip",
      "chainId": 8453,
      "contractAddress": { "$env": "NEXT_PUBLIC_FLIP_ADDRESS" },
      "safety": "financial",
      "agentSafe": false,
      "requiredAuth": { "required": "farcaster-signed" },
      "inputs": {
        "choice": { "type": "string", "enum": ["heads", "tails"], "required": true },
        "amount":  { "type": "number", "required": true }
      },
      "outputs": { "type": "void" }
    }
  ],
  "metadata": {}
}
```

## Automatic detection

### API routes
- **Next.js App Router** — `app/api/**/route.ts` (GET, POST, PUT, DELETE, PATCH)
- **Next.js Pages Router** — `pages/api/**/*.ts`
- **Express / Hono / Fastify** — `app.get('/path', handler)` and `router.post(...)` patterns
- **Server Actions** — `'use server'` files

### Smart contracts
- ABI JSON files (`*ABI.json`, `abi/*.json`, `abis/*.json`)
- Wagmi hooks — `useWriteContract`, `useContractWrite`, `writeContract`
- Contract addresses extracted as `{ "$env": "VAR_NAME" }` — secrets never embedded

### Zod schemas
- Inline `z.object(...)` schemas in the same file as `.parse()` / `.safeParse()`
- **Cross-file** — schemas imported from centralised files (e.g. `src/lib/schemas.ts`) are resolved via the import graph

### Auth
- Detected from source code and `package.json` dependencies:
  `bearer` · `api-key` · `oauth2` · `basic` · `farcaster-frame` · `cookie`
- Override with `--auth-type` if detection misses

### Capabilities
`wallet` · `payments` · `ai` · `database` · `realtime` · `storage` · `farcaster`

---

## Safety levels

Every action is classified automatically:

| Level | Meaning | `agentSafe` |
|---|---|---|
| `read` | Read-only, no side effects | `true` |
| `write` | Mutates state, no money movement | `true` |
| `financial` | Moves tokens or value | `false` |
| `destructive` | Deletes or burns irreversibly | `false` |
| `confidential` | Handles PII, passwords, credentials, KYC | `false` |

`agentSafe: false` means the agent must ask for human confirmation before executing.

---

## Intent taxonomy

Actions get a `domain.verb` intent so agents understand what they do:

| Domain | Examples |
|---|---|
| `game.*` | `game.play`, `game.join`, `game.score` |
| `finance.*` | `finance.transfer`, `finance.swap`, `finance.stake`, `finance.approve` |
| `nft.*` | `nft.mint`, `nft.burn`, `nft.list` |
| `social.*` | `social.cast`, `social.follow`, `social.react`, `social.share` |
| `governance.*` | `governance.vote`, `governance.propose`, `governance.delegate` |
| `auth.*` | `auth.session`, `auth.register`, `auth.verify` |
| `data.*` | `data.read`, `data.create`, `data.update`, `data.delete` |
| `media.*` | `media.upload` |

Override with a JSDoc tag: `@agent-action intent=custom.thing`

---

## Explicit annotation (optional)

The compiler discovers actions automatically, but you can annotate for precision:

```typescript
/**
 * @agent-action intent=game.play
 * @description Flip a coin and bet ETH on the outcome.
 * @param choice The side to bet on — "heads" or "tails".
 * @param amount The amount of ETH to wager in wei.
 */
export async function flip(choice: string, amount: bigint) {
  // ...
}
```

---

## Auth scopes

Per-action auth is inferred automatically:

| Condition | `requiredAuth` |
|---|---|
| Contract `view`/`pure` function | `public` |
| GET endpoint on public app | `public` |
| Farcaster frame app + write action | `farcaster-signed` |
| Financial action | `required` + scope `payments:write` |
| Confidential action (POST) | `required` + scope `pii:write` |
| Confidential action (GET) | `required` + scope `pii:read` |
| Everything else | `required` |

---

## CLI options

```
agentjson [options]

Options:
  -p, --path <path>         Project root (default: ".")
  -o, --output <output>     Output path (default: "./public/agent.json")
  --author <author>         Author name or organization
  --url <url>               App homepage URL
  --auth-type <type>        Override detected auth type
                            none | bearer | api-key | oauth2 | basic | farcaster-frame | cookie
  --auth-header <header>    Auth header name (default: Authorization)
  --auth-docs <url>         URL where agents can obtain credentials
  -V, --version             Show version
  -h, --help                Show help

Commands:
  validate <file>           Validate an existing agent.json against the schema
```

---

## JSON Schema

A full JSON Schema is bundled at `node_modules/@0xdeve/agentjson/schema/agent.schema.json` for editor autocomplete and CI validation.

---

## Performance

On large repos the compiler skips unchanged files using SHA-1 content hashing. Cache is stored in `.agentjson-cache.json` at the project root (add to `.gitignore`).

---

## License

ISC
