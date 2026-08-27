import { useEffect, useState } from 'react';

type Campaign = {
  id: string;
  name: string;
  status: string;
  protocol: string;
  chain_id: number | null;
  domain_id: string | null;
};

type Contract = { id: string; address: string; name: string | null };
type Domain = { id: string; origin: string };

const tokenKey = 'aegis.token';

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

function Login({ onLoggedIn }: { onLoggedIn: () => void }) {
  const [email, setEmail] = useState('operator@example.com');
  const [password, setPassword] = useState('change-me');
  const [error, setError] = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const res = await api('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
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

  useEffect(() => {
    api('/api/campaigns').then((r) => r.json()).then(setCampaigns);
    api('/api/contracts').then((r) => r.json()).then(setContracts);
    api('/api/domains').then((r) => r.json()).then(setDomains);
  }, []);

  async function createCampaign() {
    const firstDomain = domains[0]?.id ?? null;
    const res = await api('/api/campaigns', {
      method: 'POST',
      body: JSON.stringify({ name, chainId: 1, protocol: 'reown', domainId: firstDomain }),
    });
    const c = (await res.json()) as Campaign;
    setCampaigns((prev) => [c, ...prev]);
    setName('');
  }

  async function compile(id: string) {
    await api(`/api/campaigns/${id}/compile`, { method: 'POST' });
    setCampaigns((prev) =>
      prev.map((c) => (c.id === id ? { ...c, status: 'forged' } : c)),
    );
  }

  function logout() {
    localStorage.removeItem(tokenKey);
    location.reload();
  }

  return (
    <div>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <h1>AEGIS Console</h1>
        <button onClick={logout}>Sign out</button>
      </div>

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
            No whitelisted domain yet — add one via the orchestrator API so the embed script has a
            permissioned origin.
          </div>
        )}
      </div>

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
    </div>
  );
}

export default function App() {
  const [authed, setAuthed] = useState(() => Boolean(localStorage.getItem(tokenKey)));
  if (!authed) return <Login onLoggedIn={() => setAuthed(true)} />;
  return (
    <main className="layout">
      <Dashboard />
    </main>
  );
}