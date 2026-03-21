import { ManifestGenerator } from '../src/generator/json';
import { AgentAction } from '../src/types';

const makeAction = (overrides: Partial<AgentAction> = {}): AgentAction => ({
  name: 'testAction',
  description: 'A test action',
  intent: 'util.action',
  type: 'function',
  location: './src/actions.ts',
  safety: 'write',
  agentSafe: true,
  requiredAuth: { required: 'required' },
  parameters: { properties: {} },
  returns: { type: 'any' },
  ...overrides,
});

describe('ManifestGenerator', () => {
  const gen = new ManifestGenerator();

  it('uses package defaults when metadata is empty', () => {
    const manifest = gen.generate([], {});
    expect(manifest.name).toBe('Web App');
    expect(manifest.description).toBe('Auto-generated agent manifest');
    expect(manifest.version).toBe('1.0.0');
    expect(manifest.auth.type).toBe('none');
  });

  it('uses provided metadata', () => {
    const manifest = gen.generate([], {
      name: 'FlipIt',
      description: 'Coin flip game',
      author: '0xDev',
      url: 'https://flipit.xyz',
    });
    expect(manifest.name).toBe('FlipIt');
    expect(manifest.author).toBe('0xDev');
    expect(manifest.url).toBe('https://flipit.xyz');
  });

  it('omits empty metadata fields', () => {
    const manifest = gen.generate([], { name: 'MyApp' });
    expect(manifest.metadata).not.toHaveProperty('iconUrl');
    expect(manifest.metadata).not.toHaveProperty('homeUrl');
  });

  it('includes provided auth config', () => {
    const manifest = gen.generate([], {}, [], { type: 'bearer', header: 'Authorization', scheme: 'Bearer' });
    expect(manifest.auth.type).toBe('bearer');
    expect(manifest.auth.scheme).toBe('Bearer');
  });

  it('includes actions and capabilities', () => {
    const action = makeAction({ name: 'flip', intent: 'game.play', safety: 'write' });
    const manifest = gen.generate([action], {}, ['wallet', 'payments']);
    expect(manifest.actions).toHaveLength(1);
    expect(manifest.actions[0].name).toBe('flip');
    expect(manifest.capabilities).toContain('wallet');
    expect(manifest.capabilities).toContain('payments');
  });

  it('passes requiredAuth through to output', () => {
    const action = makeAction({ requiredAuth: { required: 'farcaster-signed' } });
    const manifest = gen.generate([action], {});
    expect(manifest.actions[0].requiredAuth.required).toBe('farcaster-signed');
  });

  it('passes contractAddress sentinel through', () => {
    const action = makeAction({
      type: 'contract',
      contractAddress: { $env: 'NEXT_PUBLIC_FLIP_ADDRESS' },
    });
    const manifest = gen.generate([action], {});
    expect(manifest.actions[0].contractAddress).toEqual({ $env: 'NEXT_PUBLIC_FLIP_ADDRESS' });
  });
});
