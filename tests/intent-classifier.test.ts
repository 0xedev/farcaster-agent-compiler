import { inferIntent, classifySafety, deriveAgentSafe, inferActionAuth } from '../src/parser/intent-classifier';

describe('inferIntent', () => {
  it('maps game verbs', () => {
    expect(inferIntent('flip')).toBe('game.play');
    expect(inferIntent('rollDice')).toBe('game.play');
    expect(inferIntent('claimPrize')).toBe('game.play');
  });

  it('maps finance verbs', () => {
    expect(inferIntent('transfer')).toBe('finance.transfer');
    expect(inferIntent('sendTokens')).toBe('finance.transfer');
    expect(inferIntent('swap')).toBe('finance.swap');
    expect(inferIntent('stakeETH')).toBe('finance.stake');
    expect(inferIntent('approve')).toBe('finance.approve');
    expect(inferIntent('getBalance')).toBe('finance.balance');
  });

  it('maps NFT verbs', () => {
    expect(inferIntent('mintNFT')).toBe('nft.mint');
    expect(inferIntent('safeMint')).toBe('nft.mint');
    expect(inferIntent('burn')).toBe('nft.burn');
  });

  it('maps social verbs', () => {
    expect(inferIntent('composeCast')).toBe('social.cast');
    expect(inferIntent('follow')).toBe('social.follow');
    expect(inferIntent('upvote')).toBe('social.react');
  });

  it('maps data CRUD verbs', () => {
    expect(inferIntent('getUsers')).toBe('data.read');
    expect(inferIntent('createPost')).toBe('data.create');
    expect(inferIntent('updateProfile')).toBe('data.update');
    expect(inferIntent('deleteAccount')).toBe('data.delete');
  });

  it('falls back to util.action', () => {
    expect(inferIntent('xyzUnknown')).toBe('util.action');
  });

  it('respects explicit override', () => {
    expect(inferIntent('transfer', 'game.play')).toBe('game.play');
  });
});

describe('classifySafety', () => {
  it('contract view → read', () => {
    expect(classifySafety({ name: 'balanceOf', isReadOnly: true, type: 'contract' })).toBe('read');
  });

  it('contract write with financial verb → financial', () => {
    expect(classifySafety({ name: 'transfer', isReadOnly: false, type: 'contract' })).toBe('financial');
  });

  it('GET → read', () => {
    expect(classifySafety({ name: 'getUsers', httpMethod: 'GET', type: 'api' })).toBe('read');
  });

  it('POST with financial verb → financial', () => {
    expect(classifySafety({ name: 'sendPayment', httpMethod: 'POST', type: 'api' })).toBe('financial');
  });

  it('destructive verb → destructive', () => {
    expect(classifySafety({ name: 'deleteAccount', httpMethod: 'DELETE', type: 'api' })).toBe('destructive');
  });

  it('default POST → write', () => {
    expect(classifySafety({ name: 'createPost', httpMethod: 'POST', type: 'api' })).toBe('write');
  });

  // confidential
  it('password in name → confidential', () => {
    expect(classifySafety({ name: 'resetPassword', httpMethod: 'POST', type: 'api' })).toBe('confidential');
  });

  it('credential noun → confidential', () => {
    expect(classifySafety({ name: 'storeCredential', httpMethod: 'POST', type: 'api' })).toBe('confidential');
  });

  it('kyc noun → confidential', () => {
    expect(classifySafety({ name: 'submitKyc', httpMethod: 'POST', type: 'api' })).toBe('confidential');
  });

  it('ssn → confidential even on GET', () => {
    expect(classifySafety({ name: 'getSsn', httpMethod: 'GET', type: 'api' })).toBe('confidential');
  });

  it('financial beats confidential (e.g. creditCard payment endpoint)', () => {
    // financial verbs take priority over confidential nouns
    expect(classifySafety({ name: 'payCreditCard', httpMethod: 'POST', type: 'api' })).toBe('financial');
  });
});

describe('deriveAgentSafe', () => {
  it('read and write are agent-safe', () => {
    expect(deriveAgentSafe('read', 'getUser')).toBe(true);
    expect(deriveAgentSafe('write', 'updateProfile')).toBe(true);
  });

  it('financial, destructive, and confidential are NOT agent-safe', () => {
    expect(deriveAgentSafe('financial', 'transfer')).toBe(false);
    expect(deriveAgentSafe('destructive', 'deleteAccount')).toBe(false);
    expect(deriveAgentSafe('confidential', 'resetPassword')).toBe(false);
  });
});

describe('inferActionAuth', () => {
  it('contract view → public', () => {
    const auth = inferActionAuth({ safety: 'read', isReadOnly: true, type: 'contract' });
    expect(auth.required).toBe('public');
  });

  it('contract write → required', () => {
    const auth = inferActionAuth({ safety: 'write', isReadOnly: false, type: 'contract' });
    expect(auth.required).toBe('required');
  });

  it('financial → required with payments:write scope', () => {
    const auth = inferActionAuth({ safety: 'financial', type: 'api' });
    expect(auth.required).toBe('required');
    expect(auth.scope).toBe('payments:write');
  });

  it('confidential POST → required with pii:write scope', () => {
    const auth = inferActionAuth({ safety: 'confidential', httpMethod: 'POST', type: 'api' });
    expect(auth.required).toBe('required');
    expect(auth.scope).toBe('pii:write');
  });

  it('confidential GET → required with pii:read scope', () => {
    const auth = inferActionAuth({ safety: 'confidential', httpMethod: 'GET', type: 'api' });
    expect(auth.required).toBe('required');
    expect(auth.scope).toBe('pii:read');
  });

  it('farcaster-frame app + write → farcaster-signed', () => {
    const auth = inferActionAuth({ safety: 'write', appAuthType: 'farcaster-frame', type: 'api' });
    expect(auth.required).toBe('farcaster-signed');
  });

  it('farcaster-frame app + confidential → farcaster-signed', () => {
    const auth = inferActionAuth({ safety: 'confidential', appAuthType: 'farcaster-frame', type: 'api' });
    expect(auth.required).toBe('farcaster-signed');
  });

  it('GET read on public app → public', () => {
    const auth = inferActionAuth({ safety: 'read', httpMethod: 'GET', appAuthType: 'none', type: 'api' });
    expect(auth.required).toBe('public');
  });

  it('GET read on authenticated app → required', () => {
    const auth = inferActionAuth({ safety: 'read', httpMethod: 'GET', appAuthType: 'bearer', type: 'api' });
    expect(auth.required).toBe('required');
  });
});

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
  it('bare cast → social.cast', () => {
    expect(inferIntent('cast')).toBe('social.cast');
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
  it('destructive actions on no-auth app still → required', () => {
    expect(inferActionAuth({ safety: 'destructive', type: 'api', appAuthType: 'none' }))
      .toEqual({ required: 'required' });
  });
});
