import { useState } from 'react';
import { api } from '../api.js';
import { useAuth } from '../App.jsx';
import { Alert, Field, Icon } from '../components/ui.jsx';

// Demo accounts are listed here and in the README on purpose (the brief asks for them).
const DEMO = [
  ['Administrator', 'admin@trustvault.test', 'AdminVault2026'],
  ['Owner', 'olivia@trustvault.test', 'OliviaVault2026'],
  ['Owner', 'omar@trustvault.test', 'OmarVault2026'],
  ['Viewer', 'vera@trustvault.test', 'VeraVault2026'],
  ['Viewer', 'victor@trustvault.test', 'VictorVault2026'],
];

export default function LoginPage() {
  const { setUser } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const d = await api.post('/api/auth/login', { email, password });
      setUser(d.user);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-page">
      <section className="login-hero">
        <div className="brand" style={{ color: '#fff' }}>
          <span className="brand-mark"><Icon name="shield" size={18} /></span> TrustVault
        </div>
        <div>
          <h1>Share confidential documents with exactly the right people.</h1>
          <p>Every document is reachable only by people it was granted to, and every access, allowed or refused, is recorded in a tamper-evident trail.</p>
          <div className="hero-points">
            <div className="hero-point"><span><Icon name="key" /></span><span>Per-document read and edit grants to named people</span></div>
            <div className="hero-point"><span><Icon name="close" /></span><span>Revoking access takes effect on the very next request</span></div>
            <div className="hero-point"><span><Icon name="shield" /></span><span>Hash-chained audit log the database refuses to rewrite</span></div>
          </div>
        </div>
        <p className="small">Demo deployment for the Snovasys Fresher Hiring Challenge 2026.</p>
      </section>
      <section className="login-panel">
        <form className="login-card form-grid" onSubmit={submit}>
          <div>
            <h2>Sign in</h2>
            <p className="muted">Use your TrustVault account.</p>
          </div>
          <Alert>{error}</Alert>
          <Field label="Email">
            <input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </Field>
          <Field label="Password">
            <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </Field>
          <button className="btn btn-cta" disabled={busy}>{busy ? 'Signing in…' : 'Continue'}</button>

          <div className="demo-accounts">
            <p className="small muted" style={{ marginBottom: 6 }}>Demo accounts (click to fill in):</p>
            {DEMO.map(([role, e, p]) => (
              <button type="button" key={e} onClick={() => { setEmail(e); setPassword(p); }}>
                <span>{e}</span><span className="muted">{role}</span>
              </button>
            ))}
          </div>
        </form>
      </section>
    </div>
  );
}
