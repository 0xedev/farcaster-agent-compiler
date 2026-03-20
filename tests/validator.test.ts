/**
 * Tests for the structural validator (extracted from index.ts logic).
 * We re-implement the validator here as a pure function to keep tests
 * independent of the CLI entry point.
 */

const SAFETY_LEVELS  = new Set(['read', 'write', 'financial', 'destructive', 'confidential']);
const ACTION_TYPES   = new Set(['api', 'contract', 'function']);
const AUTH_TYPES     = new Set(['none', 'bearer', 'api-key', 'oauth2', 'basic', 'farcaster-frame', 'cookie']);
const INTENT_RE      = /^[a-z][a-z0-9]*\.[a-z][a-z0-9]*$/;

function validateManifest(m: any): string[] {
  const errors: string[] = [];
  if (typeof m.name !== 'string' || !m.name) errors.push('`name` must be a non-empty string');
  if (typeof m.description !== 'string') errors.push('`description` must be a string');
  if (typeof m.version !== 'string' || !/^\d+\.\d+\.\d+$/.test(m.version))
    errors.push('`version` must be a semver string');
  if (!m.auth || !AUTH_TYPES.has(m.auth.type))
    errors.push('`auth.type` must be one of: ' + [...AUTH_TYPES].join(' | '));
  if (!Array.isArray(m.capabilities)) errors.push('`capabilities` must be an array');
  if (!Array.isArray(m.actions)) errors.push('`actions` must be an array');
  else {
    m.actions.forEach((action: any, i: number) => {
      const prefix = `actions[${i}] ("${action.name ?? '?'}")`;
      if (!action.name) errors.push(`${prefix}: missing \`name\``);
      if (!action.intent) errors.push(`${prefix}: missing \`intent\``);
      else if (!INTENT_RE.test(action.intent))
        errors.push(`${prefix}: \`intent\` must match domain.verb format`);
      if (!ACTION_TYPES.has(action.type)) errors.push(`${prefix}: invalid \`type\``);
      if (!action.location) errors.push(`${prefix}: missing \`location\``);
      if (!SAFETY_LEVELS.has(action.safety)) errors.push(`${prefix}: invalid \`safety\``);
      if (typeof action.agentSafe !== 'boolean') errors.push(`${prefix}: \`agentSafe\` must be boolean`);
      if (!action.requiredAuth || !['public','required','farcaster-signed'].includes(action.requiredAuth.required))
        errors.push(`${prefix}: invalid \`requiredAuth.required\``);
      if (typeof action.inputs !== 'object' || Array.isArray(action.inputs))
        errors.push(`${prefix}: \`inputs\` must be an object`);
      if (!action.outputs || typeof action.outputs.type !== 'string')
        errors.push(`${prefix}: \`outputs.type\` must be a string`);
    });
  }
  return errors;
}

const validAction = {
  name: 'flip',
  description: 'Flip a coin',
  intent: 'game.play',
  type: 'contract',
  location: './src/Flip.sol',
  safety: 'financial',
  agentSafe: false,
  requiredAuth: { required: 'required' },
  inputs: {},
  outputs: { type: 'void' },
};

const validManifest = {
  name: 'FlipIt',
  description: 'Coin flip game',
  version: '1.0.0',
  auth: { type: 'farcaster-frame' },
  capabilities: ['wallet'],
  actions: [validAction],
};

describe('validateManifest', () => {
  it('passes a valid manifest', () => {
    expect(validateManifest(validManifest)).toHaveLength(0);
  });

  it('fails missing name', () => {
    const errors = validateManifest({ ...validManifest, name: '' });
    expect(errors).toContain('`name` must be a non-empty string');
  });

  it('fails invalid semver', () => {
    const errors = validateManifest({ ...validManifest, version: '1.0' });
    expect(errors.some(e => e.includes('semver'))).toBe(true);
  });

  it('fails invalid auth type', () => {
    const errors = validateManifest({ ...validManifest, auth: { type: 'magic-link' } });
    expect(errors.some(e => e.includes('auth.type'))).toBe(true);
  });

  it('fails action with invalid intent format', () => {
    const action = { ...validAction, intent: 'GamePlay' };
    const errors = validateManifest({ ...validManifest, actions: [action] });
    expect(errors.some(e => e.includes('domain.verb'))).toBe(true);
  });

  it('fails action with invalid safety', () => {
    const action = { ...validAction, safety: 'dangerous' };
    const errors = validateManifest({ ...validManifest, actions: [action] });
    expect(errors.some(e => e.includes('safety'))).toBe(true);
  });

  it('fails action with invalid requiredAuth', () => {
    const action = { ...validAction, requiredAuth: { required: 'maybe' } };
    const errors = validateManifest({ ...validManifest, actions: [action] });
    expect(errors.some(e => e.includes('requiredAuth'))).toBe(true);
  });

  it('accumulates multiple errors', () => {
    const errors = validateManifest({ name: '', version: 'bad', auth: null, capabilities: null, actions: [] });
    expect(errors.length).toBeGreaterThan(2);
  });
});
