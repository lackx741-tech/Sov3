// End-to-end smoke test for the AEGIS services.
// Requires: Postgres + Redis running, orchestrator on :4000, compile on :4100.
import { strict as assert } from 'node:assert';

const ORCH = 'http://127.0.0.1:4000';
const COMPILE = 'http://127.0.0.1:4100';

async function req(base, path, { method = 'GET', token, body } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HTTP ${res.status} on ${method} ${path}: ${text}`);
  }
  const ct = res.headers.get('content-type') || '';
  return ct.includes('json') ? res.json() : res.text();
}

async function main() {
  // 1. Login
  const login = await req(ORCH, '/api/auth/login', {
    method: 'POST',
    body: { email: 'operator@example.com', password: 'change-me' },
  });
  assert.ok(login.token, 'expected a JWT');
  const token = login.token;
  console.log('✓ login ok');

  // 2. Register a whitelisted domain (unique per run so the test is repeatable)
  const origin = `https://app-${Date.now()}.example.com`;
  const domain = await req(ORCH, '/api/domains', {
    method: 'POST', token, body: { origin },
  });
  assert.equal(domain.origin, origin);
  console.log('✓ domain registered', origin);

  // 3. Register a contract (unique address per run so the test is repeatable)
  const rand = Date.now().toString(16).padStart(39 - 2, '0');
  const address = `0x${rand.slice(0, 40)}`;
  const contract = await req(ORCH, '/api/contracts', {
    method: 'POST', token, body: { address, chainId: 1, name: 'Example' },
  });
  assert.ok(contract.id);
  console.log('✓ contract registered');

  // 4. Create a campaign linked to that domain
  const campaign = await req(ORCH, '/api/campaigns', {
    method: 'POST', token,
    body: { name: 'e2e', chainId: 1, protocol: 'reown', domainId: domain.id, contractId: contract.id },
  });
  assert.equal(campaign.status, 'draft');
  console.log('✓ campaign created', campaign.id);

  // 5. Trigger compile
  await req(ORCH, `/api/campaigns/${campaign.id}/compile`, { method: 'POST', token });
  console.log('✓ compile triggered');
  await new Promise((r) => setTimeout(r, 1500));

  // 6. Fetch the generated bundle from the compile engine
  const bundle = await req(COMPILE, `/bundles/${campaign.id}.js`);
  assert.ok(bundle.includes('AEGIS embed script'), 'bundle should include the header');
  assert.ok(bundle.includes(origin), 'bundle should lock to the whitelisted domain');
  console.log('✓ bundle served and domain-locked');

  // 7. Verify campaign status flipped to forged
  const list = await req(ORCH, '/api/campaigns', { token });
  const updated = list.find((c) => c.id === campaign.id);
  assert.equal(updated.status, 'forged');
  console.log('✓ campaign status forged');

  console.log('\nE2E PASSED — orchestrator + compile + schema all working');
}

main().catch((e) => {
  console.error('\nE2E FAILED:', e.message);
  process.exit(1);
});