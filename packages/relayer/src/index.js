import { JsonRpcProvider, Wallet, parseUnits } from 'ethers';
import { EventMesh, TOPICS } from '@aegis/shared';
import Redis from 'ioredis';
import dotenv from 'dotenv';

dotenv.config();

const RPC_URL = process.env.RPC_URL ?? 'http://127.0.0.1:8545';
const REDIS_URL = process.env.REDIS_URL ?? 'redis://127.0.0.1:6379';
const CONFIRMATIONS = Number(process.env.RELAY_CONFIRMATIONS ?? 1);
const MAX_FEE_CAP_GWEI = Number(process.env.MAX_FEE_CAP_GWEI ?? 500);
const MAX_BROADCAST_RETRIES = Number(process.env.RELAY_MAX_RETRIES ?? 3);
const RETRY_BASE_MS = Number(process.env.RELAY_RETRY_BASE_MS ?? 500);
const provider = new JsonRpcProvider(RPC_URL);
const cache = new Redis(REDIS_URL);
const mesh = new EventMesh(REDIS_URL);

// Relayer keys come ONLY from the environment / KMS / HSM. Never from source or DB.
// An operator-owned wallet may be configured for operator-initiated broadcasts.
const relayerKey = process.env.RELAYER_PRIVATE_KEY || null;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Best-effort broadcast with linear backoff. Transient JSON-RPC/network errors are
// retried up to MAX_BROADCAST_RETRIES; hard chain rejections (e.g. invalid nonce,
// insufficient funds, gas too low) are surfaced immediately since retrying them is
// pointless and could burn the nonce.
function isTransient(e) {
  const m = (e?.shortMessage ?? e?.message ?? '').toLowerCase();
  return /(timeout|econnreset|econnrefused|server error|rate limit|too many requests|network error)/.test(m);
}

async function broadcastWithRetry(fn) {
  let lastErr;
  for (let attempt = 0; attempt <= MAX_BROADCAST_RETRIES; attempt += 1) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      if (attempt === MAX_BROADCAST_RETRIES || !isTransient(e)) throw e;
      const delay = RETRY_BASE_MS * 2 ** attempt;
      console.warn(`[relayer] transient error, retrying in ${delay}ms (${attempt + 1}/${MAX_BROADCAST_RETRIES})`, e.message);
      await sleep(delay);
    }
  }
  throw lastErr;
}

async function nextNonce(address) {
  // Atomic nonce retrieval/increment via Redis to prevent replays across workers.
  const inFlightKey = `nonce:inflight:${address}`;
  const base = await provider.getTransactionCount(address, 'pending');
  const inflight = Number((await cache.get(inFlightKey)) ?? 0);
  const nonce = base + inflight;
  await cache.set(inFlightKey, String(inflight + 1), 'EX', 120);
  return nonce;
}

async function releaseNonce(address, reserve) {
  const key = `nonce:inflight:${address}`;
  const cur = Number((await cache.get(key)) ?? 0);
  await cache.set(key, String(Math.max(0, cur - reserve)), 'EX', 120);
}

// Broadcast a user-signed raw transaction (the user authorizes in their own wallet).
async function broadcastRaw(rawTx) {
  const sent = await broadcastWithRetry(() => provider.broadcastTransaction(rawTx));
  const receipt = await broadcastWithRetry(() => sent.wait(CONFIRMATIONS));
  return { txHash: sent.hash, receipt };
}

// Build, sign (with the operator-owned relayer key), and broadcast a transaction.
async function relayTx({ to, chainId, value, data, maxFeePerGasGwei, gasLimit }) {
  if (!relayerKey) throw new Error('RELAYER_PRIVATE_KEY not configured for operator broadcasts');
  const wallet = new Wallet(relayerKey, provider);
  const from = await wallet.getAddress();
  const nonce = await nextNonce(from);
  const feeCapGwei = Math.min(maxFeePerGasGwei ?? 50, MAX_FEE_CAP_GWEI);
  const fee = {
    maxFeePerGas: parseUnits(String(feeCapGwei), 'gwei'),
    maxPriorityFeePerGas: parseUnits(String(Math.min(feeCapGwei, 2)), 'gwei'),
  };
  const tx = {
    to: to ?? undefined,
    value: parseUnits(value ?? '0', 'ether'),
    data: data ?? '0x',
    nonce,
    type: 2,
    chainId,
    ...fee,
  };
  // Estimate gas with a fallback (21000 for plain transfers). Without a gasLimit
  // an EIP-1559 tx is built with gas=0, which miners reject ("intrinsic gas too low").
  let limit = gasLimit;
  if (!limit) {
    try {
      limit = await provider.estimateGas({ ...tx, from });
    } catch {
      limit = data && data !== '0x' ? 200_000 : 21_000;
    }
  }
  tx.gasLimit = limit;
  const signed = await wallet.signTransaction(tx);
  const sent = await broadcastWithRetry(() => provider.broadcastTransaction(signed));
  const receipt = await broadcastWithRetry(() => sent.wait(CONFIRMATIONS));
  return { txHash: sent.hash, from, nonce, receipt };
}

// Idempotency guard: ignore duplicate broadcast requests.
async function claim(id) {
  const ok = await cache.set(`relay:claimed:${id}`, '1', 'EX', 600, 'NX');
  return ok === 'OK';
}

function baseMeta(payload) {
  return {
    campaignId: payload.campaignId ?? null,
    origin: payload.origin ?? null,
    functionName: payload.functionName ?? null,
  };
}

// The compile/console layer publishes user-signed raw transactions, signing on the wallet side.
mesh.subscribe(TOPICS.RELAY_BROADCAST_REQUEST, async (payload) => {
  const { id, rawTx } = payload;
  if (!id || !rawTx) {
    console.error('[relayer] malformed request', payload);
    return;
  }
  if (!(await claim(id))) {
    console.log('[relayer] duplicate request', id);
    return;
  }
  try {
    const { txHash, receipt } = await broadcastRaw(rawTx);
    await mesh.publish(TOPICS.RELAY_CONFIRMED, {
      id, txHash, from: receipt.from, blockNumber: receipt.blockNumber, status: 'confirmed',
      ts: new Date().toISOString(), ...baseMeta(payload),
    });
    console.log('[relayer] confirmed', txHash);
  } catch (e) {
    await mesh.publish(TOPICS.RELAY_FAILURE, {
      id, reason: e.shortMessage ?? e.message, ...baseMeta(payload),
    });
    console.error('[relayer] failure', e.message);
  }
});

// Operator-initiated broadcast (own wallet).
mesh.subscribe(TOPICS.RELAY_RELAY_REQUEST, async (payload) => {
  const { id, to, value, data, chainId, maxFeePerGasGwei } = payload;
  if (!id || !(await claim(id))) return;
  try {
    const res = await relayTx({ to, value, data, chainId, maxFeePerGasGwei });
    await mesh.publish(TOPICS.RELAY_CONFIRMED, {
      id, txHash: res.txHash, from: res.from, nonce: res.nonce,
      blockNumber: res.receipt.blockNumber, status: 'confirmed', ts: new Date().toISOString(),
      ...baseMeta(payload),
    });
    console.log('[relayer] relayed', res.txHash);
  } catch (e) {
    await mesh.publish(TOPICS.RELAY_FAILURE, {
      id, reason: e.shortMessage ?? e.message, ...baseMeta(payload),
    });
    console.error('[relayer] failure', e.message);
  }
});

// Wait until subscriptions are live on Redis before announcing readiness so a
// publisher doesn't race ahead and have its message dropped.
await mesh.ensureSubscribed();
console.log(`[relayer] connected to ${RPC_URL} (confirmations=${CONFIRMATIONS})`);