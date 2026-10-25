import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, CATEGORIES, fmtDate, fmtSize, qs } from '../api.js';
import { AccessBadge, Alert, Badge, Dialog, Field, Icon } from '../components/ui.jsx';

export default function DocumentPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [editing, setEditing] = useState(false);
  const [uploading, setUploading] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await api.get(`/api/documents/${id}`));
    } catch (err) {
      setError(err.status === 404 ? 'This document does not exist or you do not have access to it.' : err.message);
    }
  }, [id]);
  useEffect(() => { load(); }, [load]);

  if (error && !data) return (<><Link to="/">← Back to documents</Link><div style={{ marginTop: 16 }}><Alert>{error}</Alert></div></>);
  if (!data) return <div className="loading">Loading…</div>;

  const { document: doc, versions } = data;
  const canEdit = doc.access === 'owner' || doc.access === 'edit';
  const isOwner = doc.access === 'owner';

  const remove = async () => {
    if (!window.confirm(`Move "${doc.name}" to the trash? People you shared it with lose access immediately.`)) return;
    try { await api.del(`/api/documents/${id}`); navigate('/trash'); } catch (err) { setError(err.message); }
  };

  return (
    <>
      <Link to="/" className="small">← All documents</Link>
      <div className="page-head" style={{ marginTop: 8 }}>
        <div>
          <h1>{doc.name}</h1>
          <div className="btn-row" style={{ marginTop: 8 }}>
            <Badge>{doc.category}</Badge><AccessBadge access={doc.access} />
            <span className="muted small">Owned by {doc.owner_name} · version {doc.current_version}</span>
          </div>
        </div>
        <div className="btn-row">
          <a className="btn btn-cta" href={`/api/documents/${id}/download`}><Icon name="download" /> Download</a>
          {canEdit && <button className="btn" onClick={() => setUploading(true)}><Icon name="upload" /> New version</button>}
          {canEdit && <button className="btn" onClick={() => setEditing(true)}>Edit details</button>}
          {isOwner && <button className="btn btn-negative" onClick={remove}><Icon name="trash" /> Delete</button>}
        </div>
      </div>
      <Alert>{error}</Alert>
      <Alert kind="positive">{notice}</Alert>

      <div className="grid-2">
        <div>
          <div className="card">
            <div className="card-head"><h2>Details</h2></div>
            <dl className="card-body kv">
              <dt>Description</dt><dd>{doc.description || <span className="muted">None</span>}</dd>
              <dt>Owner</dt><dd>{doc.owner_name} ({doc.owner_email})</dd>
              <dt>Created</dt><dd>{fmtDate(doc.created_at)}</dd>
              <dt>Updated</dt><dd>{fmtDate(doc.updated_at)}</dd>
            </dl>
          </div>
          <div className="card">
            <div className="card-head"><h2>Versions</h2></div>
            <div className="table-wrap">
              <table>
                <thead><tr><th>Version</th><th>File</th><th>Size</th><th>Uploaded</th><th /></tr></thead>
                <tbody>
                  {versions.map((v) => (
                    <tr key={v.version_no}>
                      <td><b>v{v.version_no}</b></td>
                      <td>{v.original_filename}<div className="mono muted" title="SHA-256">{v.sha256.slice(0, 16)}…</div></td>
                      <td className="muted">{fmtSize(v.size_bytes)}</td>
                      <td className="muted">{v.uploaded_by}<div className="small">{fmtDate(v.created_at)}</div></td>
                      <td><a className="btn btn-sm" href={`/api/documents/${id}/download${qs({ version: v.version_no })}`}>Download</a></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          {isOwner && <Activity id={id} />}
        </div>
        <div>
          {isOwner ? <Sharing id={id} onChange={setNotice} /> : (
            <div className="card"><div className="card-body">
              <h3>Access</h3>
              <p className="muted" style={{ marginTop: 6 }}>
                {doc.access === 'edit' ? 'You can download, edit details and upload new versions.' : 'You can view and download this document.'}
                {' '}Only the owner can share it or change who has access.
              </p>
            </div></div>
          )}
        </div>
      </div>

      {editing && <EditDialog doc={doc} onClose={() => setEditing(false)} onDone={() => { setEditing(false); setNotice('Details saved.'); load(); }} />}
      {uploading && <VersionDialog id={id} onClose={() => setUploading(false)} onDone={() => { setUploading(false); setNotice('New version uploaded.'); load(); }} />}
    </>
  );
}

function Sharing({ id, onChange }) {
  const [grants, setGrants] = useState([]);
  const [people, setPeople] = useState([]);
  const [who, setWho] = useState('');
  const [permission, setPermission] = useState('read');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const [g, p] = await Promise.all([api.get(`/api/documents/${id}/grants`), api.get('/api/users/directory')]);
      setGrants(g.grants);
      setPeople(p.users);
    } catch (err) { setError(err.message); }
  }, [id]);
  useEffect(() => { load(); }, [load]);

  const act = async (fn, message) => {
    setError('');
    try { await fn(); onChange(message); load(); } catch (err) { setError(err.message); }
  };
  const grant = () => who && act(() => api.put(`/api/documents/${id}/grants/${who}`, { permission }), 'Access granted.').then(() => setWho(''));
  const change = (userId, p) => act(() => api.put(`/api/documents/${id}/grants/${userId}`, { permission: p }), 'Access changed.');
  const revoke = (g) => window.confirm(`Remove ${g.name}'s access? It stops working immediately.`)
    && act(() => api.del(`/api/documents/${id}/grants/${g.user_id}`), `${g.name} no longer has access.`);

  const available = people.filter((p) => !grants.some((g) => g.user_id === p.id));
  return (
    <div className="card">
      <div className="card-head"><h2>Who has access</h2><Badge tone="informative">{grants.length + 1} people</Badge></div>
      <div className="card-body">
        <Alert>{error}</Alert>
        <Suggestions id={id} onShared={(name) => { onChange(`Shared with ${name} (view only).`); load(); }} onError={setError} />
        <div className="form-grid">
          <Field label="Share with a named person">
            <select value={who} onChange={(e) => setWho(e.target.value)}>
              <option value="">Choose a person…</option>
              {available.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.email})</option>)}
            </select>
          </Field>
          <div className="btn-row">
            <select value={permission} onChange={(e) => setPermission(e.target.value)} style={{ flex: 1 }}>
              <option value="read">Can view</option>
              <option value="edit">Can edit</option>
            </select>
            <button className="btn btn-cta" onClick={grant} disabled={!who}>Share</button>
          </div>
        </div>
        <div style={{ marginTop: 16 }}>
          <div className="list-row">
            <span className="avatar">You</span>
            <div className="grow"><b>You</b><div className="small muted">Owner</div></div>
            <AccessBadge access="owner" />
          </div>
          {grants.map((g) => (
            <div className="list-row" key={g.user_id}>
              <span className="avatar" style={{ background: '#6d6d6d' }}>{g.name.split(' ').map((s) => s[0]).join('').slice(0, 2)}</span>
              <div className="grow"><b>{g.name}</b>{!g.is_active && <> <Badge tone="negative">Deactivated</Badge></>}<div className="small muted">{g.email}</div></div>
              <select value={g.permission} onChange={(e) => change(g.user_id, e.target.value)} style={{ width: 110 }}>
                <option value="read">Can view</option><option value="edit">Can edit</option>
              </select>
              <button className="icon-btn" title="Remove access" aria-label={`Remove ${g.name}`} onClick={() => revoke(g)}><Icon name="close" /></button>
            </div>
          ))}
        </div>
        <p className="small muted" style={{ marginTop: 12 }}>Editors can change the file but cannot share it or delete it.</p>
      </div>
    </div>
  );
}

// Suggestions only propose. Nothing is shared until the owner clicks Share,
// and the server records both the suggestion and the decision.
function Suggestions({ id, onShared, onError }) {
  const [items, setItems] = useState([]);
  useEffect(() => {
    api.get(`/api/documents/${id}/suggestions`).then((d) => setItems(d.suggestions)).catch(() => {});
  }, [id]);
  if (items.length === 0) return null;

  const remove = (userId) => setItems((list) => list.filter((s) => s.userId !== userId));
  const share = async (s) => {
    try {
      await api.put(`/api/documents/${id}/grants/${s.userId}`, { permission: s.permission, viaSuggestion: true });
      remove(s.userId);
      onShared(s.name);
    } catch (err) { onError(err.message); }
  };
  const dismiss = async (s) => {
    try { await api.post(`/api/documents/${id}/suggestions/dismiss`, { userId: s.userId }); remove(s.userId); } catch (err) { onError(err.message); }
  };

  return (
    <div className="ai-note" style={{ marginTop: 0, marginBottom: 16 }}>
      <h3 style={{ fontSize: 13 }}>Suggested people</h3>
      {items.map((s) => (
        <div className="list-row" key={s.userId}>
          <div className="grow"><b>{s.name}</b><div className="small muted">{s.reason}</div></div>
          <button className="btn btn-sm" onClick={() => share(s)}>Share (view)</button>
          <button className="btn btn-sm btn-quiet" onClick={() => dismiss(s)}>Dismiss</button>
        </div>
      ))}
      <p className="small muted" style={{ marginTop: 6 }}>Based on who you shared with before. Nothing is shared until you click Share; suggestions and your choice are recorded in the audit trail.</p>
    </div>
  );
}

function Activity({ id }) {
  const [rows, setRows] = useState([]);
  useEffect(() => { api.get(`/api/documents/${id}/activity`).then((d) => setRows(d.activity)).catch(() => {}); }, [id]);
  return (
    <div className="card">
      <div className="card-head"><h2>Activity on this document</h2><span className="small muted">Including refused attempts</span></div>
      <div className="table-wrap">
        <table>
          <thead><tr><th>When</th><th>Who</th><th>What</th><th>Result</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className={r.outcome === 'denied' ? 'denied' : ''}>
                <td className="muted small">{fmtDate(r.created_at)}</td>
                <td>{r.actor_email}</td>
                <td>{r.action}{r.target_email && <span className="muted"> → {r.target_email}</span>}{r.details?.permission && <span className="muted"> ({r.details.permission})</span>}</td>
                <td><Badge tone={r.outcome === 'denied' ? 'negative' : 'positive'}>{r.outcome}</Badge></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function EditDialog({ doc, onClose, onDone }) {
  const [name, setName] = useState(doc.name);
  const [category, setCategory] = useState(doc.category);
  const [description, setDescription] = useState(doc.description);
  const [error, setError] = useState('');
  const save = async () => {
    try { await api.patch(`/api/documents/${doc.id}`, { name, category, description }); onDone(); } catch (err) { setError(err.message); }
  };
  return (
    <Dialog title="Edit details" onClose={onClose} footer={<><button className="btn btn-quiet" onClick={onClose}>Cancel</button><button className="btn btn-cta" onClick={save}>Save</button></>}>
      <div className="form-grid">
        <Alert>{error}</Alert>
        <Field label="Name"><input value={name} maxLength={150} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="Category"><select value={category} onChange={(e) => setCategory(e.target.value)}>{CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select></Field>
        <Field label="Description"><textarea rows={3} maxLength={1000} value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
      </div>
    </Dialog>
  );
}

function VersionDialog({ id, onClose, onDone }) {
  const [file, setFile] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!file) return setError('Choose a file.');
    const form = new FormData();
    form.append('file', file);
    setBusy(true);
    try { await api.post(`/api/documents/${id}/versions`, form); onDone(); } catch (err) { setError(err.message); } finally { setBusy(false); }
  };
  return (
    <Dialog title="Upload a new version" onClose={onClose} footer={<><button className="btn btn-quiet" onClick={onClose}>Cancel</button><button className="btn btn-cta" onClick={submit} disabled={busy}>Upload</button></>}>
      <div className="form-grid">
        <Alert>{error}</Alert>
        <Field label="File" hint="Older versions are kept and can still be downloaded."><input type="file" onChange={(e) => setFile(e.target.files[0] || null)} /></Field>
      </div>
    </Dialog>
  );
}
