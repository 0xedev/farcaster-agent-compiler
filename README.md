# Farcaster Agent Compiler

A universal CLI tool that scans any codebase to automatically generate an `agent.json` manifest, enabling Farcaster mini apps to be programmatically accessible by AI agents.

## Features

- **Universal Discovery**: Automatically detects Next.js API routes and annotated TypeScript functions.
- **Farcaster Aware**: Detects `/.well-known/farcaster.json` and extracts app metadata automatically.
- **Smart Contract Support**: Automatically detects ABIs and Wagmi/Viem/Ethers contract interactions.
- **AST Parsing**: Extracts function names, parameters, return types, and descriptions from JSDoc using `ts-morph`.
- **Zero Configuration**: Works out of the box with sensible defaults.

## Installation

You can run it directly using `npx`:

```bash
npx farcaster-agent-compiler -p <path-to-project> -o <output-path>
```

Or install it globally:

```bash
npm install -g farcaster-agent-compiler
```

## Usage

### 1. Annotate your functions (Optional)

Use the `@agent-action` JSDoc tag to explicitly expose functions:

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

### 2. Run the compiler

```bash
npx farcaster-agent-compiler -p . -o .farcaster/agent.json
```

## Why?

"Agentic Farcaster" requires a standard interface for agents to discover and execute actions across different mini apps. This tool provides the glue by extracting machine-readable manifests from human-readable codebases.

## License

MIT
