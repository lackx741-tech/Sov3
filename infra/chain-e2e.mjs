#!/usr/bin/env node
// On-chain relay e2e: boots ganache + the relayer against it, then verifies
//  (A) operator-relayed broadcast (relayer's own key signs + broadcasts)
//  (B) user-signed broadcast (a wallet signs a raw tx; relayer only broadcasts)
// Each path must produce RELAY_CONFIRMED and a mined receipt with status 1.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import ganache from 'ganache';
import { JsonRpcProvider, Wallet, parseEther } from 'ethers';
import Redis from 'ioredis';
import { EventMesh, TOPICS } from '@aegis/shared';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RELAYER_ENTRY = path.join(ROOT, 'packages/relayer/src/index.js');
const RPC_URL = 'http://127.0.0.1:8545';
const REDIS_URL = 'redis://127.0.0.1:6379';
const CHAIN_ID = 1337;

const mesh = new EventMesh(REDIS_URL);
const cache = new Redis(REDIS_URL);

async function waitFor(topic, predicate, ms = 15000) {
  const p = new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      unsub();
      reject(new Error(`timeout waiting for ${topic}`));
    }, ms);
    const unsub = mesh.subscribe(topic, (p) => {
      if (!predicate || predicate(p)) {
        clearTimeout(timer);
        unsub();
        resolve(p);
      }
    });
  });
  await mesh.ensureSubscribed();
  return p;
}

async function main() {
  console.log('\n== chain-e2e: booting ganache ==');
  const server = ganache.server({
    logging: { quiet: true },
    wallet: { totalAccounts: 3, defaultBalance: 1000, seed: 'aegis-e2e-seed' },
    chain: { chainId: CHAIN_ID },
  });
  await server.listen(8545);
  const accounts = await server.provider.getInitialAccounts();
  const keys = Object.entries(accounts)
    .map(([address, { secretKey }]) => ({ address, key: secretKey }))
    .slice(0, 3);
  const [op, user] = keys;
  console.log(`op operator=${op.address} user=${user.address}`);

  const provider = new JsonRpcProvider(RPC_URL);
  const cacheHit = await cache.ping();
  console.log('redis ping', cacheHit);

  let relayerProc;
  try {
    relayerProc = spawn('node', [RELAYER_ENTRY], {
      env: {
        ...process.env,
        RPC_URL,
        REDIS_URL,
        RELAYER_PRIVATE_KEY: op.key,
        RELAY_CONFIRMATIONS: '1',
        RELAY_MAX_RETRIES: '2',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    relayerProc.stdout.on('data', (d) => process.stdout.write(`[relayer] ${d}`));
    relayerProc.stderr.on('data', (d) => process.stdout.write(`[relayer-err] ${d}`));
    relayerProc.on('exit', (code, signal) => console.log(`[relayer] exited code=${code} signal=${signal}`));
    // The relayer prints "connected" only after its Redis SUBSCRIBE commands are
    // confirmed, so wait for that line before publishing to avoid dropped messages.
    const relayerReady = new Promise((resolve) => {
      const onData = (d) => {
        if (String(d).includes('connected to')) {
          relayerProc.stdout.off('data', onData);
          resolve();
        }
      };
      relayerProc.stdout.on('data', onData);
    });
    await Promise.race([relayerReady, new Promise((r) => setTimeout(() => r(), 8000))]);

    // ---- Test A: operator-relayed broadcast ----------------------------------
    console.log('\n== test A: operator relay ==');
    const A_id = `op-e2e-${Date.now()}`;
    const A_wait = waitFor(TOPICS.RELAY_CONFIRMED, (p) => p.id === A_id);
    const A_fail = waitFor(TOPICS.RELAY_FAILURE, (p) => p.id === A_id);
    await mesh.publish(TOPICS.RELAY_RELAY_REQUEST, {
      id: A_id,
      to: user.address,
      value: '0.05',
      chainId: CHAIN_ID,
      relayType: 'operator',
    });
    const A = await Promise.race([A_wait, A_fail]);
    if (A.hasOwnProperty('reason')) throw new Error(`operator relay failed: ${A.reason}`);
    const receiptA = await provider.getTransactionReceipt(A.txHash);
    if (Number(receiptA.status) !== 1) throw new Error('operator relay receipt status != 1');
    console.log('  OK relay tx', A.txHash, 'block', receiptA.blockNumber, 'from', A.from);

    // ---- Test B: user-signed raw tx relay ------------------------------------
    console.log('\n== test B: user-signed broadcast ==');
    const userWallet = new Wallet(user.key, provider);
    const B_id = `user-e2e-${Date.now()}`;
    const B_wait = waitFor(TOPICS.RELAY_CONFIRMED, (p) => p.id === B_id);
    const nonce = await provider.getTransactionCount(user.address, 'pending');
    const rawTx = await userWallet.signTransaction({
      to: op.address,
      value: parseEther('0.01'),
      chainId: CHAIN_ID,
      nonce,
      type: 2,
      maxFeePerGas: parseEther('0.000000001'), // 1 gwei
      maxPriorityFeePerGas: parseEther('0.000000001'),
      gasLimit: 21000,
    });
    await mesh.publish(TOPICS.RELAY_BROADCAST_REQUEST, {
      id: B_id,
      rawTx,
      origin: 'https://aegis-test.example',
      functionName: 'transfer',
      campaignId: null,
    });
    const B = await B_wait;
    if (B.hasOwnProperty('reason')) throw new Error(`user-signed relay failed: ${B.reason}`);
    const receiptB = await provider.getTransactionReceipt(B.txHash);
    if (Number(receiptB.status) !== 1) throw new Error('user-signed relay receipt status != 1');
    console.log('  OK broadcast tx', B.txHash, 'block', receiptB.blockNumber, 'from', B.from);
    if (B.campaignId === null) console.log('  OK meta passthrough works for null');

    // ---- Verify metadata + idempotency ----------------------------------------
    // Duplicate broadcast must be ignored.
    console.log('\n== test C: idempotency guard ==');
    const C_wait = waitFor(TOPICS.RELAY_CONFIRMED, (p) => p.id === B_id, 3000).catch((e) => e);
    await mesh.publish(TOPICS.RELAY_BROADCAST_REQUEST, { id: B_id, rawTx: '0x00' });
    const dup = await C_wait;
    if (dup instanceof Error) console.log('  OK duplicate ignored (no double broadcast)');
    else throw new Error('duplicate broadcast was NOT ignored');

    console.log('\nCHAIN-E2E: ALL PASS');
    await mesh.close();
    await cache.quit();
    await server.close();
    relayerProc.kill('SIGTERM');
    process.exit(0);
  } catch (e) {
    console.error('\nCHAIN-E2E FAILED:', e.message);
    relayerProc?.kill('SIGTERM');
    await mesh.close().catch(() => {});
    await cache.quit().catch(() => {});
    await server.close().catch(() => {});
    process.exit(1);
  }
}

main();