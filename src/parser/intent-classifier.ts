import { SafetyLevel } from '../types';

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
  // Game
  { pattern: /\b(play|flip|roll|spin|bet|guess|draw|move|attack|defend|claim(?:Prize|Reward|Win))\b/i, intent: 'game.play' },
  { pattern: /\b(score|leaderboard|rank|highscore)\b/i, intent: 'game.score' },
  { pattern: /\b(join(?:Game|Room|Lobby)|create(?:Game|Room)|start(?:Game|Round))\b/i, intent: 'game.join' },

  // Finance / DeFi
  { pattern: /\b(transfer|send(?:Token|ETH|USDC)?|pay(?:ment)?)\b/i, intent: 'finance.transfer' },
  { pattern: /\b(swap|exchange|trade)\b/i, intent: 'finance.swap' },
  { pattern: /\b(stake|unstake|deposit|withdraw|bond|unbond)\b/i, intent: 'finance.stake' },
  { pattern: /\b(mint(?!NFT)|buy|purchase)\b/i, intent: 'finance.purchase' },
  { pattern: /\b(approve|allowance|permit)\b/i, intent: 'finance.approve' },
  { pattern: /\b(balance|getBalance|totalSupply)\b/i, intent: 'finance.balance' },
  { pattern: /\b(borrow|repay|liquidate|collateral)\b/i, intent: 'finance.lending' },

  // NFT
  { pattern: /\b(mint(?:NFT)?|safeMint|createNFT)\b/i, intent: 'nft.mint' },
  { pattern: /\b(listNFT|sellNFT|listFor(?:Sale)?)\b/i, intent: 'nft.list' },
  { pattern: /\b(buyNFT|purchaseNFT)\b/i, intent: 'nft.buy' },
  { pattern: /\b(burnNFT|burn)\b/i, intent: 'nft.burn' },

  // Social (Farcaster-native)
  { pattern: /\b(cast|compose(?:Cast)?|post(?:Cast)?)\b/i, intent: 'social.cast' },
  { pattern: /\b(follow|unfollow|subscribe)\b/i, intent: 'social.follow' },
  { pattern: /\b(like|react|upvote|downvote)\b/i, intent: 'social.react' },
  { pattern: /\b(comment|reply)\b/i, intent: 'social.reply' },
  { pattern: /\b(share|recast|repost)\b/i, intent: 'social.share' },

  // Governance
  { pattern: /\b(vote|castVote|submitVote)\b/i, intent: 'governance.vote' },
  { pattern: /\b(propose|createProposal|submitProposal)\b/i, intent: 'governance.propose' },
  { pattern: /\b(delegate|undelegate)\b/i, intent: 'governance.delegate' },

  // Auth
  { pattern: /\b(login|logout|signIn|signOut|connect|disconnect)\b/i, intent: 'auth.session' },
  { pattern: /\b(register|signup|createAccount)\b/i, intent: 'auth.register' },
  { pattern: /\b(verify(?:Signature|Address|Identity)?)\b/i, intent: 'auth.verify' },

  // Data / CRUD
  { pattern: /\b(get|fetch|load|read|list|query|search|find)\b/i, intent: 'data.read' },
  { pattern: /\b(create|add|insert|save|store|upload)\b/i, intent: 'data.create' },
  { pattern: /\b(update|edit|patch|set|change)\b/i, intent: 'data.update' },
  { pattern: /\b(delete|remove|destroy|archive)\b/i, intent: 'data.delete' },

  // Media
  { pattern: /\b(upload(?:Image|File|Media)?|setAvatar|setImage)\b/i, intent: 'media.upload' },
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

const FINANCIAL_VERBS = /\b(transfer|send|pay|swap|exchange|trade|stake|unstake|deposit|withdraw|buy|purchase|mint|approve|borrow|repay|liquidate|bond|unbond)\b/i;
const DESTRUCTIVE_VERBS = /\b(delete|remove|destroy|burn|archive|purge|wipe|clear)\b/i;

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
