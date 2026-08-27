import { describe, it, expect } from 'vitest';
import { buildEmbed, encodeStatic, mergeConfig, THEMES } from '../src/generate-embed.js';

describe('mergeConfig', () => {
  it('applies defaults when no config is given', () => {
    const c = mergeConfig();
    expect(c.chainId).toBe(1);
    expect(c.broadcastMode).toBe('relay');
    expect(c.protocol).toBe('reown');
    expect(c.theme).toBe('dark-ops');
    expect(c.modal.confirmed).toBe('Transaction confirmed.');
  });

  it('deep-merges modal while overriding top-level keys', () => {
    const c = mergeConfig({ theme: 'militant', modal: { title: 'Authorize' } });
    expect(c.theme).toBe('militant');
    expect(c.modal.title).toBe('Authorize');
    expect(c.modal.connectButton).toBe('Connect Wallet');
  });

  it('exposes ctx (the values baked into the bundle)', () => {
    const c = mergeConfig({ chainId: 1337, broadcastMode: 'wallet', projectId: 'abc' });
    expect(c.ctx.chainId).toBe(1337);
    expect(c.ctx.broadcastMode).toBe('wallet');
    expect(c.ctx.projectId).toBe('abc');
  });
});

describe('encodeStatic', () => {
  const abi = [
    {
      name: 'mint',
      stateMutability: 'payable',
      type: 'function',
      inputs: [{ name: 'to', type: 'address' }, { name: 'amount', type: 'uint256' }],
    },
  ];

  it('encodes function calldata for static args', () => {
    const { data } = encodeStatic({
      abi,
      functionName: 'mint',
      args: [
        { value: '0x1111111111111111111111111111111111111111', source: 'static' },
        { value: '5', source: 'static' },
      ],
      value: '0',
    });
    expect(data).toMatch(/^0x[0-9a-f]+$/);
    expect(data.length).toBe(138); // 4-byte selector + 2 padded words = 68 bytes
  });

  it('substitutes a zero placeholder for wallet-derived args', () => {
    const { data } = encodeStatic({
      abi,
      functionName: 'mint',
      args: [
        { value: '0x2222222222222222222222222222222222222222', source: 'wallet' },
        { value: '7', source: 'static' },
      ],
      value: '0',
    });
    // the wallet-sourced position resolves to a zero-address placeholder; the
    // amount stays static. Replaced with the real address in the client at runtime.
    expect(data).toMatch(/^0x[0-9a-f]+$/);
    expect(data).toContain('0000000000000000000000000000000000000000');
  });

  it('encodes a non-zero value as a hex valueData word', () => {
    const { valueData } = encodeStatic({ value: '1.5' });
    expect(valueData.startsWith('0x')).toBe(true);
    expect(BigInt(`0x${valueData.slice(2)}`)).toBeGreaterThan(0n);
  });

  it('throws on a function missing from the ABI', () => {
    expect(() => encodeStatic({ abi, functionName: 'nope', args: [], value: '0' })).toThrow(/not in ABI/);
  });
});

describe('buildEmbed', () => {
  const campaign = { id: '11111111-1111-1111-1111-111111111111', chain_id: 1337 };
  const contract = { address: '0x1111111111111111111111111111111111111111' };
  const domain = 'https://app.example.com';

  it('produces a client script with the header and campaign id', () => {
    const js = buildEmbed({ campaign, contract, domain });
    expect(js).toContain('AEGIS embed script');
    expect(js).toContain(campaign.id);
  });

  it('locks the script to the whitelisted domain', () => {
    const js = buildEmbed({ campaign, contract, domain });
    expect(js).toContain(domain);
    expect(js).toContain('location.origin === P.domain');
  });

  it('bakes the relay endpoint and status endpoint into the config', () => {
    const js = buildEmbed({
      campaign,
      contract,
      domain,
      endpoint: 'https://orchestrator/api/relay/broadcast',
      statusEndpoint: 'https://orchestrator/api/campaigns/{id}/relay/{jobId}',
    });
    expect(js).toContain('https://orchestrator/api/relay/broadcast');
    expect(js).toContain('/api/campaigns/{id}/relay/{jobId}');
  });

  it('never embeds private keys', () => {
    const js = buildEmbed({
      campaign,
      contract,
      domain,
      cfg: { brokerPrivateKey: '0xdeadbeef', signingKey: 'supersecret' },
    });
    expect(js).not.toMatch(/privatekey|signingkey|0xdeadbeef|supersecret/i);
  });

  it('includes exactly the configured themes', () => {
    expect(Object.keys(THEMES)).toEqual(['dark-ops', 'militant', 'minimal', 'custom']);
  });
});