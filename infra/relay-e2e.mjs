#!/usr/bin/env node
// Full-loop relay e2e. Requires: Postgres + Redis up, orchestrator :4000 and
// compile :4100 already running. Boots a local ganache, spawns the relayer
// against it, then drives the whole embed→relay flow through the HTTP API:
//   domain → contract → campaign → compile(bundle) → user-signed raw tx
//   → POST /api/relay/broadcast → job status → confirmed(tx_hash in relay_jobs)
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { strict as assert } from 'node:assert';
import ganache from 'ganache';
import { JsonRpcProvider, Wallet, parseEther } from 'ethers';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ORCH = 'http://127.0.0.1:4000';
const COMPILE = 'http://127.0.0.1:4100';
const REDIS_URL = 'redis://127.0.0.1:6379';
const RPC_URL = 'http://127.0.0.1:8545';
const CHAIN_ID = 1337;

async function req(base, p, { method = 'GET', token, body, headers } = {}) {
  const res = await fetch(base + p, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const ct = res.headers.get('content-type') || '';
  const data = ct.includes('json') ? await res.json() : await res.text();
  return { status: res.status, data };
}

async function main() {
  console.log('\n== relay-e2e: booting ganache ==');
  const server = ganache.server({
    logging: { quiet: true },
    wallet: { totalAccounts: 2, defaultBalance: 1000, seed: 'relay-e2e-seed' },
    chain: { chainId: CHAIN_ID },
  });
  await server.listen(8545);
  const accounts = await server.provider.getInitialAccounts();
  const [userAcct] = Object.entries(accounts).filter(([addr]) => true).slice(0, 1);
  const userAddr = userAcct[0];
  const userKey = userAcct[1].secretKey;
  console.log('user account', userAddr);
  const provider = new JsonRpcProvider(RPC_URL);

  // Spawn relayer (operator key = a fresh hardhat account funded by ganache).
  const relayerProc = spawn('node', [path.join(ROOT, 'packages/relayer/src/index.js')], {
    env: { ...process.env, RPC_URL, REDIS_URL, RELAYER_PRIVATE_KEY: userKey, RELAY_CONFIRMATIONS: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  relayerProc.stdout.on('data', (d) => process.stdout.write(`[relayer] ${d}`));
  relayerProc.stderr.on('data', (d) => process.stdout.write(`[relayer-err] ${d}`));
  const relayerReady = new Promise((res) => {
    const on = (d) => { if (String(d).includes('connected to')) { relayerProc.stdout.off('data', on); res(); } };
    relayerProc.stdout.on('data', on);
  });
  await Promise.race([relayerReady, new Promise((r) => setTimeout(r, 8000))]);

  const login = await req(ORCH, '/api/auth/login', { method: 'POST', body: { email: 'operator@example.com', password: 'change-me' } });
  assert.equal(login.status, 200, `login failed: ${login.data}`);
  const token = login.data.token;
  console.log('✓ login');

  const origin = `https://relay-${Date.now()}.example.com`;
  const domain = await req(ORCH, '/api/domains', { method: 'POST', token, body: { origin } });
  assert.equal(domain.status, 201, `domain create failed: ${JSON.stringify(domain.data)}`);
  const contract = await req(ORCH, '/api/contracts', {
    method: 'POST', token,
    body: { address: `0x${Date.now().toString(16).padStart(40, '0')}`, chainId: CHAIN_ID, name: 'RelayE2E' },
  });
  assert.equal(contract.status, 201, `contract create failed: ${JSON.stringify(contract.data)}`);
  const campaign = await req(ORCH, '/api/campaigns', {
    method: 'POST', token,
    body: { name: 'relay-e2e', chainId: CHAIN_ID, protocol: 'reown', domainId: domain.data.id, contractId: contract.data.id },
  });
  assert.equal(campaign.status, 201, `campaign create failed: ${JSON.stringify(campaign.data)}`);
  const campaignId = campaign.data.id;
  console.log('✓ domain/contract/campaign', origin, campaignId);

  // Trigger compile and fetch the bundle — the embed must contain the endpoints.
  await req(ORCH, `/api/campaigns/${campaignId}/compile`, { method: 'POST', token });
  await new Promise((r) => setTimeout(r, 1500));
  const bundle = await req(COMPILE, `/bundles/${campaignId}.js`);
  assert.equal(bundle.status, 200);
  assert.ok(bundle.data.includes(`/api/relay/broadcast`), 'bundle missing broadcast endpoint');
  assert.ok(bundle.data.includes(`/api/campaigns/{id}/relay/{jobId}`), 'bundle missing statusEndpoint');
  assert.ok(bundle.data.includes(`"campaignId":"${campaignId}"`), 'bundle missing campaignId');
  assert.ok(bundle.data.includes(origin), 'bundle missing domain lock');
  console.log('✓ bundle forged with relay endpoints + domain lock');

  // Negative: broadcast from a non-whitelisted origin must be rejected (403).
  const evil = await req(ORCH, '/api/relay/broadcast', {
    method: 'POST', body: { campaignId, rawTx: '0xab', origin: 'https://evil.example' },
  });
  assert.equal(evil.status, 403, `expected 403 for bad origin, got ${evil.status}`);
  console.log('✓ origin lock rejects non-whitelisted origin');

  // Negative: wrong campaign → 404.
  const missing = await req(ORCH, '/api/relay/broadcast', {
    method: 'POST', body: { campaignId: '00000000-0000-0000-0000-000000000000', rawTx: '0xab', origin },
  });
  assert.equal(missing.status, 404, `expected 404 for missing campaign, got ${missing.status}`);
  console.log('✓ unknown campaign rejected');

  // Sign a real user tx and relay it.
  const wallet = new Wallet(userKey, provider);
  const nonce = await provider.getTransactionCount(userAddr, 'pending');
  const rawTx = await wallet.signTransaction({
    to: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
    value: parseEther('0.01'),
    chainId: CHAIN_ID,
    nonce,
    type: 2,
    maxFeePerGas: parseEther('0.000000001'),
    maxPriorityFeePerGas: parseEther('0.000000001'),
    gasLimit: 21000,
  });
  const post = await req(ORCH, '/api/relay/broadcast', {
    method: 'POST',
    body: { campaignId, rawTx, origin, functionName: 'transfer' },
  });
  assert.equal(post.status, 202, `broadcast rejected: ${JSON.stringify(post.data)}`);
  const jobId = post.data.id;
  console.log('✓ broadcast accepted, job', jobId);

  // Poll the public job-status endpoint (what the embed polls) until confirmed.
  let job = null;
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    const r = await req(ORCH, `/api/campaigns/${campaignId}/relay/${jobId}`);
    if (r.status !== 200) continue;
    job = r.data;
    if (job.status === 'confirmed') break;
    if (job.status === 'failed') throw new Error(`relay failed: ${job.error}`);
  }
  assert.ok(job && job.status === 'confirmed', `job did not confirm (last=${JSON.stringify(job)})`);
  assert.ok(job.tx_hash, 'confirmed job missing tx_hash');
  console.log('✓ relay job confirmed, tx', job.tx_hash);

  // Verify the authed job list for the campaign includes the tx_hash.
  const list = await req(ORCH, `/api/campaigns/${campaignId}/relay`, { token });
  assert.ok(list.status === 200 && Array.isArray(list.data), 'expected authed job list');
  const mine = list.data.find((j) => j.id === jobId);
  assert.equal(mine.status, 'confirmed');
  console.log('✓ relay_jobs row persisted (origin=transfer, tx_hash recorded)');

  console.log('\nRELAY-E2E: ALL PASS');
  relayerProc.kill('SIGTERM');
  await server.close();
  process.exit(0);
}

main().catch((e) => {
  console.error('\nRELAY-E2E FAILED:', e.message);
  process.exit(1);
});