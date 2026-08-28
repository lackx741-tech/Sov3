import express from 'express';
import helmet from 'helmet';
import pg from 'pg';
import { EventMesh, TOPICS } from '@aegis/shared';
import dotenv from 'dotenv';
import { buildEmbed } from './generate-embed.js';

dotenv.config();

const DB_URL = process.env.POSTGRES_URL ?? process.env.DATABASE_URL;
const REDIS_URL = process.env.REDIS_URL ?? 'redis://127.0.0.1:6379';
const PUBLIC_ORIGIN = process.env.PUBLIC_ORIGIN ?? '*';
const ORCH_BASE = process.env.ORCHESTRATOR_URL ?? 'http://127.0.0.1:4000';
const pool = new pg.Pool({ connectionString: DB_URL });
const mesh = new EventMesh(REDIS_URL);

const app = express();
app.use(helmet());
app.use(express.json());

async function loadCampaignBundleData(campaignId) {
  const { rows } = await pool.query(
    `SELECT c.*, c.name AS campaign_name,
            k.id AS contract_id, k.name AS contract_name, k.address AS contract_address, k.abi AS contract_abi,
            d.origin AS domain_origin
       FROM campaigns c
       LEFT JOIN contracts k ON k.id = c.contract_id
       LEFT JOIN domains d ON d.id = c.domain_id
      WHERE c.id = $1`,
    [campaignId],
  );
  return rows[0] ?? null;
}

// Build the embed script for a campaign using its persisted config + contract.
async function embedForCampaign(campaignId) {
  const campaign = await loadCampaignBundleData(campaignId);
  if (!campaign) {
    const err = new Error('campaign not found');
    err.status = 404;
    throw err;
  }
  if (!campaign.domain_origin) {
    const err = new Error('campaign has no whitelisted domain');
    err.status = 400;
    throw err;
  }
  const cfg = campaign.config ?? {};
  const abi = (cfg.abi?.length ? cfg.abi : campaign.contract_abi) ?? [];
  const protocol = cfg.protocol ?? campaign.protocol ?? 'reown';
  const endpoint = cfg.endpoint ?? `${ORCH_BASE}/api/relay/broadcast`;
  const statusEndpoint = cfg.statusEndpoint ?? `${ORCH_BASE}/api/campaigns/{id}/relay/{jobId}`;

  return buildEmbed({
    campaign: { id: campaign.id, chain_id: campaign.chain_id },
    contract: campaign.contract_address ? { address: campaign.contract_address } : null,
    domain: campaign.domain_origin,
    protocol,
    cfg: { ...cfg, abi },
    endpoint,
    statusEndpoint,
  });
}

const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// Serve the generated bundle (used as the inline script on the operator's site).
app.get('/bundles/:campaignId.js', ah(async (req, res) => {
  const js = await embedForCampaign(req.params.campaignId);
  res.type('application/javascript').set('Cache-Control', 'no-store').send(js);
}));

// Preview endpoint (JSON + raw) so the console Compile Lab shows exactly what
// the bundle endpoint will serve.
app.get('/api/campaigns/:campaignId/preview', ah(async (req, res) => {
  const js = await embedForCampaign(req.params.campaignId);
  if (req.query.raw === '1') return res.type('application/javascript').send(js);
  res.json({ script: js });
}));

// The orchestrator publishes COMPILE_GENERATED when the operator triggers a compile.
mesh.subscribe(TOPICS.COMPILE_GENERATED, async ({ campaignId }) => {
  try {
    const { rows } = await pool.query('SELECT id, domain_id FROM campaigns WHERE id = $1', [campaignId]);
    const campaign = rows[0];
    if (!campaign || !campaign.domain_id) return;
    const bundleUrl = `${PUBLIC_ORIGIN}/bundles/${campaignId}.js`;
    await pool.query(
      'INSERT INTO compile_logs (campaign_id, bundle_url) VALUES ($1,$2)',
      [campaignId, bundleUrl],
    );
    await pool.query("UPDATE campaigns SET status='forged', updated_at=now() WHERE id=$1", [campaignId]);
    console.log('[compile] generated bundle for', campaignId, bundleUrl);
  } catch (e) {
    console.error('[compile] error', e.message);
  }
});

// Central error handler: return 4xx/5xx instead of crashing the process.
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  const status = err.status || 500;
  console.error('[compile] error:', err.message);
  res.status(status).json({ error: err.message });
});

process.on('unhandledRejection', (reason) => {
  console.error('[compile] unhandledRejection:', reason);
});

const port = Number(process.env.PORT ?? 4100);
app.listen(port, () => {
  console.log(`[compile] listening on :${port}`);
});