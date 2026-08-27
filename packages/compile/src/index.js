import express from 'express';
import helmet from 'helmet';
import pg from 'pg';
import { EventMesh, TOPICS } from '@aegis/shared';
import dotenv from 'dotenv';

dotenv.config();

const DB_URL = process.env.POSTGRES_URL ?? process.env.DATABASE_URL;
const REDIS_URL = process.env.REDIS_URL ?? 'redis://127.0.0.1:6379';
const PUBLIC_ORIGIN = process.env.PUBLIC_ORIGIN ?? '*';
const pool = new pg.Pool({ connectionString: DB_URL });
const mesh = new EventMesh(REDIS_URL);

const app = express();
app.use(helmet());
app.use(express.json());

// Compile a wallet-connect embed script for an operator-owned campaign. Only serves
// bundles tied to domains the operator has whitelisted; refuses anything else.
function buildBundle({ campaign, contract, domain, protocol }) {
  const sdkImport =
    protocol === 'reown'
      ? `import { createAppKit } from '@reown/appkit'`
      : protocol === 'rainbowkit'
        ? `import { RainbowKitProvider, ConnectButton } from '@rainbow-me/rainbowkit'`
        : `createWalletConnectLegacyProvider()`;
  const domainOk = `location.hostname === ${JSON.stringify(domain)} ||
    location.origin === ${JSON.stringify(domain)}`;

  return `/* AEGIS embed script — generated for campaign ${campaign.id} */
/* Runs ONLY on the operator-owned domain: ${domain} */
(function () {
  if (!(${domainOk})) {
    console.warn('[aegis] refused: not on whitelisted domain');
    return;
  }
  const contractAddress = ${JSON.stringify(contract?.address ?? null)};
  const chainId = ${JSON.stringify(campaign.chain_id ?? null)};
  // ${sdkImport}
  // Wallet-connect initialization for the operator's own site.
  // Visitors connect their own wallet, review the tx in their wallet UI, and sign
  // only what they approve. The backend never receives or stores user private keys.
  document.dispatchEvent(new CustomEvent('aegis:ready', {
    detail: { campaign: ${JSON.stringify(campaign.id)}, contractAddress, chainId, protocol: ${JSON.stringify(protocol)} }
  }));
})();
`;
}

app.get('/bundles/:campaignId.js', async (req, res) => {
  const { rows } = await pool.query(
    `SELECT c.*, c.name AS campaign_name, k.id AS contract_id, k.name AS contract_name,
            k.address AS contract_address, d.origin AS domain_origin
       FROM campaigns c
       LEFT JOIN contracts k ON k.id = c.contract_id
       LEFT JOIN domains d ON d.id = c.domain_id
      WHERE c.id = $1`,
    [req.params.campaignId],
  );
  const campaign = rows[0];
  if (!campaign) return res.status(404).json({ error: 'not found' });
  if (!campaign.domain_origin) return res.status(400).json({ error: 'campaign has no whitelisted domain' });

  const js = buildBundle({
    campaign: { id: campaign.id, chain_id: campaign.chain_id },
    contract: campaign.contract_address ? { address: campaign.contract_address } : null,
    domain: campaign.domain_origin,
    protocol: campaign.protocol,
  });
  res.type('application/javascript').send(js);
});

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

const port = Number(process.env.PORT ?? 4100);
app.listen(port, () => {
  console.log(`[compile] listening on :${port}`);
});