import { SafetyLevel, ActionAuth, AuthType } from '../types';

/**
 * Infers a standardized semantic intent from an action name and context.
 *
 * Intent format: "<domain>.<verb>" — open-ended, user-overridable via
 * @agent-action intent=custom.thing JSDoc tag.
 *
 * Built-in taxonomy (additive — PRs welcome):
 *   game.*       — game mechanics
 *   finance.*    — money movement, DeFi
 *   social.*     — Farcaster-native social actions
 *   nft.*        — NFT minting, trading
 *   governance.* — DAO voting, proposals
 *   auth.*       — authentication, sessions
 *   data.*       — read/write data, CRUD
 *   media.*      — uploads, images, video
 *   util.*       — generic utility
 */

interface IntentRule {
  pattern: RegExp;
  intent: string;
}

const INTENT_RULES: IntentRule[] = [
  // Trailing \b is intentionally omitted — camelCase names like rollDice, sendTokens,
  // getUsers don't have a word boundary after the verb segment. Leading \b is kept
  // to avoid matching mid-word (e.g. "undo" matching "do").

  // Game
  { pattern: /\b(play|flip|roll|spin|bet|guess|draw|move|attack|defend|claim(?:Prize|Reward|Win))/i, intent: 'game.play' },
  { pattern: /\b(score|leaderboard|rank|highscore)/i, intent: 'game.score' },
  { pattern: /\b(join(?:Game|Room|Lobby)|create(?:Game|Room)|start(?:Game|Round))/i, intent: 'game.join' },

  // Finance / DeFi
  { pattern: /\b(transfer|send(?:Token|ETH|USDC)?|pay(?:ment)?)/i, intent: 'finance.transfer' },
  { pattern: /\b(swap|exchange|trade)/i, intent: 'finance.swap' },
  { pattern: /\b(stake|unstake|deposit|withdraw|bond|unbond)/i, intent: 'finance.stake' },
  { pattern: /\b(mint(?!NFT)|buy|purchase)/i, intent: 'finance.purchase' },
  { pattern: /\b(approve|allowance|permit)/i, intent: 'finance.approve' },
  { pattern: /\b(balance|getBalance|totalSupply)/i, intent: 'finance.balance' },
  { pattern: /\b(borrow|repay|liquidate|collateral)/i, intent: 'finance.lending' },

  // NFT
  { pattern: /\b(mint(?:NFT)?|safeMint|createNFT)/i, intent: 'nft.mint' },
  { pattern: /\b(listNFT|sellNFT|listFor(?:Sale)?)/i, intent: 'nft.list' },
  { pattern: /\b(buyNFT|purchaseNFT)/i, intent: 'nft.buy' },
  { pattern: /\b(burnNFT|burn)/i, intent: 'nft.burn' },

  // Social (Farcaster-native)
  { pattern: /\b(cast|compose(?:Cast)?|post(?:Cast)?)/i, intent: 'social.cast' },
  { pattern: /\b(follow|unfollow|subscribe)/i, intent: 'social.follow' },
  { pattern: /\b(like|react|upvote|downvote)/i, intent: 'social.react' },
  { pattern: /\b(comment|reply)/i, intent: 'social.reply' },
  { pattern: /\b(share|recast|repost)/i, intent: 'social.share' },

  // Governance
  { pattern: /\b(vote|castVote|submitVote)/i, intent: 'governance.vote' },
  { pattern: /\b(propose|createProposal|submitProposal)/i, intent: 'governance.propose' },
  { pattern: /\b(delegate|undelegate)/i, intent: 'governance.delegate' },

  // Auth
  { pattern: /\b(login|logout|signIn|signOut|connect|disconnect)/i, intent: 'auth.session' },
  { pattern: /\b(register|signup|createAccount)/i, intent: 'auth.register' },
  { pattern: /\b(verify(?:Signature|Address|Identity)?)/i, intent: 'auth.verify' },

  // Data / CRUD
  { pattern: /\b(get|fetch|load|read|list|query|search|find)/i, intent: 'data.read' },
  { pattern: /\b(create|add|insert|save|store|upload)/i, intent: 'data.create' },
  { pattern: /\b(update|edit|patch|set|change)/i, intent: 'data.update' },
  { pattern: /\b(delete|remove|destroy|archive)/i, intent: 'data.delete' },

  // Media
  { pattern: /\b(upload(?:Image|File|Media)?|setAvatar|setImage)/i, intent: 'media.upload' },
];

/**
 * Infer a semantic intent from the action name.
 * Returns the first matching intent, or "util.action" as fallback.
 */
export function inferIntent(name: string, overrideIntent?: string): string {
  if (overrideIntent) return overrideIntent;
  for (const { pattern, intent } of INTENT_RULES) {
    if (pattern.test(name)) return intent;
  }
  return 'util.action';
}

// ─── Safety classification ────────────────────────────────────────────────

// No trailing \b — camelCase verbs like sendPayment, deleteAccount need prefix matching only
const FINANCIAL_VERBS = /\b(transfer|send|pay|swap|exchange|trade|stake|unstake|deposit|withdraw|buy|purchase|mint|approve|borrow|repay|liquidate|bond|unbond)/i;
const DESTRUCTIVE_VERBS = /\b(delete|remove|destroy|burn|archive|purge|wipe|clear)/i;

/**
 * Classify the safety level of an action.
 *
 * Rules (in priority order):
 *  1. ABI write (non view/pure) + financial verb → financial
 *  2. Financial verb anywhere → financial
 *  3. ABI view/pure → read
 *  4. GET HTTP method → read
 *  5. Destructive verb → destructive
 *  6. Everything else → write
 */
export function classifySafety(opts: {
  name: string;
  httpMethod?: string;
  isReadOnly?: boolean;   // ABI view/pure
  type: 'api' | 'contract' | 'function';
}): SafetyLevel {
  const { name, httpMethod, isReadOnly, type } = opts;

  if (type === 'contract') {
    if (isReadOnly) return 'read';
    if (FINANCIAL_VERBS.test(name)) return 'financial';
    return 'write';
  }

  if (httpMethod === 'GET') return 'read';
  if (FINANCIAL_VERBS.test(name)) return 'financial';
  if (DESTRUCTIVE_VERBS.test(name)) return 'destructive';
  return 'write';
}

/** Derive agentSafe from safety level. Financial and destructive require human confirmation. */
export function deriveAgentSafe(safety: SafetyLevel): boolean {
  return safety === 'read' || safety === 'write';
}

/**
 * Infer per-action auth requirement.
 *
 * Rules:
 *  1. Contract: view/pure → public; write → required (or farcaster-signed if app uses frames)
 *  2. API GET + safety=read → public (heuristic: read endpoints are often open)
 *  3. Farcaster frame app + write/financial → farcaster-signed
 *  4. Everything else → required (inherits app-level auth)
 */
export function inferActionAuth(opts: {
  safety: SafetyLevel;
  httpMethod?: string;
  isReadOnly?: boolean;
  appAuthType?: AuthType;
  type: 'api' | 'contract' | 'function';
}): ActionAuth {
  const { safety, httpMethod, isReadOnly, appAuthType, type } = opts;

  // Contract view/pure: always public (read-only, on-chain data)
  if (type === 'contract' && isReadOnly) {
    return { required: 'public' };
  }

  // Farcaster frame apps: write/financial/destructive actions need frame signature
  if (appAuthType === 'farcaster-frame' && (safety === 'write' || safety === 'financial' || safety === 'destructive')) {
    return { required: 'farcaster-signed' };
  }

  // Financial/destructive always require auth
  if (safety === 'financial' || safety === 'destructive') {
    return {
      required: 'required',
      scope: safety === 'financial' ? 'payments:write' : undefined,
    };
  }

  // Read-only GET on a public (no-auth) app → public
  if (httpMethod === 'GET' && safety === 'read' && (appAuthType === 'none' || !appAuthType)) {
    return { required: 'public' };
  }

  return { required: 'required' };
}
