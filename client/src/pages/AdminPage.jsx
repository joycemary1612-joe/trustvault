import { useCallback, useEffect, useState } from 'react';
import { api, fmtDate, qs } from '../api.js';
import { useAuth } from '../App.jsx';
import { Alert, Badge, Dialog, Field, Icon } from '../components/ui.jsx';

export default function AdminPage() {
  const [tab, setTab] = useState('overview');
  return (
    <>
      <div className="page-head">
        <div><h1>Administration</h1><p className="muted">Watch document activity and manage people. Administrators cannot open documents unless an owner shares them.</p></div>
      </div>
      <div className="tabs">
        {[['overview', 'Overview'], ['audit', 'Audit trail'], ['users', 'Users']].map(([k, l]) => (
          <button key={k} className={`tab${tab === k ? ' active' : ''}`} onClick={() => setTab(k)}>{l}</button>
        ))}
      </div>
      {tab === 'overview' && <Overview />}
      {tab === 'audit' && <AuditTrail />}
      {tab === 'users' && <Users />}
    </>
  );
}

function Overview() {
  const [s, setS] = useState(null);
  const [verify, setVerify] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => { api.get('/api/admin/summary').then(setS).catch((e) => setError(e.message)); }, []);
  const check = async () => { setVerify({ busy: true }); try { setVerify(await api.get('/api/admin/audit/verify')); } catch (e) { setVerify({ ok: false, reason: e.message }); } };
  if (error) return <Alert>{error}</Alert>;
  if (!s) return <div className="loading">Loading…</div>;
  const c = s.counts;
  return (
    <>
      <div className="stats">
        <div className="card stat"><div className="stat-label">Active users</div><div className="stat-value">{c.active_users}</div></div>
        <div className="card stat"><div className="stat-label">Documents</div><div className="stat-value">{c.documents}</div></div>
        <div className="card stat"><div className="stat-label">Active grants</div><div className="stat-value">{c.grants}</div></div>
        <div className="card stat"><div className="stat-label">Downloads (24h)</div><div className="stat-value">{c.downloads_24h}</div></div>
        <div className={`card stat${c.denied_24h > 0 ? ' warn' : ''}`}><div className="stat-label">Refused attempts (24h)</div><div className="stat-value">{c.denied_24h}</div></div>
      </div>
      <div className="grid-2">
        <div className="card">
          <div className="card-head"><h2>Recent permission changes</h2></div>
          <div className="table-wrap"><table>
            <thead><tr><th>When</th><th>By</th><th>Change</th><th>Document</th></tr></thead>
            <tbody>{s.recentPermissions.map((p) => (
              <tr key={p.id}>
                <td className="small muted">{fmtDate(p.created_at)}</td>
                <td>{p.actor_email}</td>
                <td>{p.action === 'permission.grant' ? <Badge tone="informative">granted {p.details.permission}</Badge> : <Badge tone="notice">revoked</Badge>}<div className="small muted">{p.target_email}</div></td>
                <td>{p.document_name}</td>
              </tr>))}
            </tbody>
          </table></div>
        </div>
        <div>
          <div className="card">
            <div className="card-head"><h2>Audit integrity</h2></div>
            <div className="card-body">
              <p className="muted">Recomputes the HMAC chain over every audit row. Any edited, removed or reordered row breaks it.</p>
              <div className="btn-row" style={{ marginTop: 12 }}>
                <button className="btn btn-cta" onClick={check} disabled={verify?.busy}><Icon name="shield" size={16} /> Verify audit trail</button>
                <a className="btn" href="/api/admin/audit/export"><Icon name="download" size={16} /> Export CSV</a>
              </div>
              <p className="small muted" style={{ marginTop: 8 }}>Keep exports outside TrustVault: if newer rows are ever cut off, the chain head in an old export will no longer match.</p>
              {verify && !verify.busy && (verify.ok
                ? <div style={{ marginTop: 12 }}><Alert kind="positive">Intact: {verify.count} entries verified.</Alert><div className="mono muted" style={{ overflowWrap: 'anywhere' }}>Chain head: {verify.head}</div></div>
                : <div style={{ marginTop: 12 }}><Alert>Broken at entry {verify.brokenAt}: {verify.reason}</Alert></div>)}
            </div>
          </div>
          <div className="card">
            <div className="card-head"><h2>Most refused (7 days)</h2></div>
            <div className="card-body">
              {s.topDenied.length === 0 ? <p className="muted">No refused attempts.</p> : s.topDenied.map((t) => (
                <div className="list-row" key={t.actor_email || 'anon'}><div className="grow">{t.actor_email || 'unknown'}</div><Badge tone="negative">{t.attempts}</Badge></div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

function AuditTrail() {
  const [f, setF] = useState({ action: '', outcome: '', actor: '', from: '', to: '' });
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');
  const load = useCallback(async (filters) => {
    setError('');
    try { setRows((await api.get(`/api/admin/audit${qs(filters)}`)).entries); } catch (e) { setError(e.message); setRows([]); }
  }, []);
  useEffect(() => { load(f); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  return (
    <>
      <form className="card filters" onSubmit={(e) => { e.preventDefault(); load(f); }}>
        <Field label="Action">
          <select value={f.action} onChange={set('action')}>
            <option value="">Any</option>
            {['auth.', 'document.download', 'document.upload', 'document.update', 'document.new_version', 'document.delete', 'document.read', 'permission.', 'user.'].map((a) => <option key={a} value={a}>{a.endsWith('.') ? `${a}*` : a}</option>)}
          </select>
        </Field>
        <Field label="Actor email"><input value={f.actor} onChange={set('actor')} /></Field>
        <Field label="Result"><select value={f.outcome} onChange={set('outcome')}><option value="">Any</option><option value="allowed">Allowed</option><option value="denied">Refused</option></select></Field>
        <Field label="From"><input type="date" value={f.from} onChange={set('from')} /></Field>
        <Field label="To"><input type="date" value={f.to} onChange={set('to')} /></Field>
        <div className="btn-row"><button className="btn btn-cta">Filter</button></div>
      </form>
      <div className="card" style={{ marginTop: 16 }}>
        <Alert>{error}</Alert>
        {rows === null ? <div className="loading">Loading…</div> : (
          <div className="table-wrap"><table>
            <thead><tr><th>#</th><th>When</th><th>Actor</th><th>Action</th><th>Document / target</th><th>Result</th><th>IP</th></tr></thead>
            <tbody>{rows.map((r) => (
              <tr key={r.id} className={r.outcome === 'denied' ? 'denied' : ''}>
                <td className="mono muted" title={`hash ${r.hash}`}>{r.id}</td>
                <td className="small muted">{fmtDate(r.created_at)}</td>
                <td>{r.actor_email || <span className="muted">anonymous</span>}</td>
                <td>{r.action}{r.details?.reason && <div className="small muted">{r.details.reason}</div>}</td>
                <td>{r.document_name}{r.target_email && <div className="small muted">→ {r.target_email}</div>}</td>
                <td><Badge tone={r.outcome === 'denied' ? 'negative' : 'positive'}>{r.outcome}</Badge></td>
                <td className="mono muted">{r.ip}</td>
              </tr>))}
            </tbody>
          </table></div>
        )}
      </div>
    </>
  );
}

function Users() {
  const { user: me } = useAuth();
  const [users, setUsers] = useState([]);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const load = useCallback(() => api.get('/api/admin/users').then((d) => setUsers(d.users)).catch((e) => setError(e.message)), []);
  useEffect(() => { load(); }, [load]);
  const update = async (u, body) => {
    if (body.isActive === false && !window.confirm(`Deactivate ${u.name}? They are signed out everywhere immediately.`)) return;
    setError('');
    try { await api.patch(`/api/admin/users/${u.id}`, body); load(); } catch (e) { setError(e.message); }
  };
  return (
    <div className="card">
      <div className="card-head"><h2>People</h2><button className="btn btn-cta btn-sm" onClick={() => setCreating(true)}>Add user</button></div>
      <Alert>{error}</Alert>
      <div className="table-wrap"><table>
        <thead><tr><th>Name</th><th>Role</th><th>Owns</th><th>Status</th><th /></tr></thead>
        <tbody>{users.map((u) => (
          <tr key={u.id}>
            <td><b>{u.name}</b><div className="small muted">{u.email}</div></td>
            <td>
              <select value={u.role} disabled={u.id === me.id} onChange={(e) => update(u, { role: e.target.value })}>
                <option value="admin">Administrator</option><option value="owner">Document owner</option><option value="viewer">Viewer</option>
              </select>
            </td>
            <td className="muted">{u.documents_owned} docs</td>
            <td>{u.is_active ? <Badge tone="positive">Active</Badge> : <Badge tone="negative">Deactivated</Badge>}</td>
            <td>{u.id !== me.id && (u.is_active
              ? <button className="btn btn-sm btn-negative" onClick={() => update(u, { isActive: false })}>Deactivate</button>
              : <button className="btn btn-sm" onClick={() => update(u, { isActive: true })}>Reactivate</button>)}</td>
          </tr>))}
        </tbody>
      </table></div>
      {creating && <CreateUser onClose={() => setCreating(false)} onDone={() => { setCreating(false); load(); }} />}
    </div>
  );
}

function CreateUser({ onClose, onDone }) {
  const [v, setV] = useState({ name: '', email: '', role: 'viewer', password: '' });
  const [error, setError] = useState('');
  const set = (k) => (e) => setV({ ...v, [k]: e.target.value });
  const save = async () => { try { await api.post('/api/admin/users', v); onDone(); } catch (e) { setError(e.message); } };
  return (
    <Dialog title="Add a user" onClose={onClose} footer={<><button className="btn btn-quiet" onClick={onClose}>Cancel</button><button className="btn btn-cta" onClick={save}>Create</button></>}>
      <div className="form-grid">
        <Alert>{error}</Alert>
        <Field label="Full name"><input value={v.name} onChange={set('name')} /></Field>
        <Field label="Email"><input type="email" value={v.email} onChange={set('email')} /></Field>
        <Field label="Role"><select value={v.role} onChange={set('role')}><option value="viewer">Viewer</option><option value="owner">Document owner</option><option value="admin">Administrator</option></select></Field>
        <Field label="Initial password" hint="At least 10 characters, with letters and numbers. Share it with the person privately."><input type="password" value={v.password} onChange={set('password')} /></Field>
      </div>
    </Dialog>
  );
}
