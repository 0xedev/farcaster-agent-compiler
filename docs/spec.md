# Farcaster Agent Manifest Spec (agent.json)

The `agent.json` file is a machine-readable manifest that describes how an AI agent can interact with a Farcaster mini app (or any web app).

## Schema

```json
{
  "$schema": "https://farcaster.xyz/schema/agent.json",
  "name": "string",
  "description": "string",
  "version": "string",
  "actions": [
    {
      "name": "string",
      "description": "string",
      "type": "api | contract | function",
      "location": "string",
      "method": "string",
      "parameters": {
        "properties": {
          "fieldName": {
            "type": "string | number | boolean | object",
            "description": "string",
            "required": "boolean"
          }
        }
      },
      "returns": {
        "type": "string | number | boolean | object",
        "description": "string"
      }
    }
  ]
}
```

## Action Types

### 1. `api`
Refers to a web API endpoint (e.g., Next.js API route).
- `location`: The relative path to the endpoint (e.g., `/api/flip`).
- `method`: HTTP method (e.g., `POST`, `GET`).

### 2. `contract`
Refers to a smart contract interaction.
- `location`: The contract address (e.g., `0x...`).
- `abiFunction`: The function name in the ABI.

### 3. `function`
Refers to a specific exported function in the codebase that the agent can "call" (via a runner).
- `location`: The file path and exported name.

## Annotation Syntax

Developers can use JSDoc-style annotations to provide metadata to the compiler:

```typescript
/**
 * @agent-action
 * @description Play a coin flip game.
 * @param choice The side to bet on ("heads" or "tails").
 * @param amount The amount of ETH to wager.
 */
export async function flip(choice: string, amount: number) {
  // ...
}
```
