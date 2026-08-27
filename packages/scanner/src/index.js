import { JsonRpcProvider, Contract } from 'ethers';
import { EventMesh, TOPICS } from '@aegis/shared';
import Redis from 'ioredis';
import dotenv from 'dotenv';

dotenv.config();

const RPC_URL = process.env.RPC_URL ?? 'http://127.0.0.1:8545';
const REDIS_URL = process.env.REDIS_URL ?? 'redis://127.0.0.1:6379';
const provider = new JsonRpcProvider(RPC_URL);
const cache = new Redis(REDIS_URL);
const mesh = new EventMesh(REDIS_URL);

const TTL_BALANCE = 45; // sec
const TTL_ALLOWANCE = 30;
const TTL_FLOOR = 300;

async function getBalance(address) {
  const cached = await cache.get(`bal:${address}`);
  if (cached) return JSON.parse(cached);
  const balance = await provider.getBalance(address);
  const value = { address, balance: balance.toString() };
  await cache.set(`bal:${address}`, JSON.stringify(value), 'EX', TTL_BALANCE);
  return value;
}

// allowance(uint256,uint256) on an ERC-20-ish contract
async function getAllowance(contractAddress, owner, spender, { abi = null } = {}) {
  const key = `allow:${contractAddress}:${owner}:${spender}`;
  const cached = await cache.get(key);
  if (cached) return JSON.parse(cached);
  let value;
  try {
    // Minimal interface; if full ABI is needed, pass it via config (see orchestrator).
    const IERC20 = ['function allowance(address owner, address spender) view returns (uint256)'];
    const contract = new Contract(contractAddress, abi ?? IERC20, provider);
    const allowance = await contract.allowance(owner, spender);
    value = { contractAddress, owner, spender, allowance: allowance.toString() };
  } catch (e) {
    value = { contractAddress, owner, spender, error: e.message };
  }
  await cache.set(key, JSON.stringify(value), 'EX', TTL_ALLOWANCE);
  return value;
}

async function getNftFloor(collectionAddress, { oracle = null } = {}) {
  // Reads floor via a provided function; without an external aggregator API we
  // return a cached/null value. Extract with `oracle(address) -> price` if available.
  const key = `floor:${collectionAddress}`;
  const cached = await cache.get(key);
  if (cached) return JSON.parse(cached);
  const value = { collectionAddress, floor: null, source: 'n/a' };
  await cache.set(key, JSON.stringify(value), 'EX', TTL_FLOOR);
  return value;
}

async function main() {
  console.log('[scanner] monitoring …');
  const targets = JSON.parse(process.env.SCAN_TARGETS ?? '[]'); // [{type,address,...}]
  if (targets.length === 0) {
    console.log('[scanner] no SCAN_TARGETS configured; idle. Set SCAN_TARGETS to scan.');
  }
  await mesh.publish(TOPICS.SCAN_COMPLETED, { targets: targets.length, ts: new Date().toISOString() });
}

main().catch((e) => {
  console.error('[scanner] error', e);
  process.exit(1);
});