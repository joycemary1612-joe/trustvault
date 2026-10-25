import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, CATEGORIES, fmtDate, fmtSize, qs } from '../api.js';
import { useAuth } from '../App.jsx';
import { AccessBadge, Alert, Badge, Dialog, Empty, Field, Icon } from '../components/ui.jsx';

const TITLES = {
  all: ['All documents', 'Everything you own or that was shared with you.'],
  mine: ['My documents', 'Documents you own. Only you decide who sees them.'],
  shared: ['Shared with me', 'Documents other people granted you access to.'],
  trash: ['Trash', 'Deleted documents. Nobody else can reach them; you can restore them.'],
};

export default function DocumentsPage({ scope }) {
  const { user } = useAuth();
  const [filters, setFilters] = useState({ q: '', owner: '', category: '', from: '', to: '' });
  const [docs, setDocs] = useState(null);
  const [error, setError] = useState('');
  const [showUpload, setShowUpload] = useState(false);

  const load = useCallback(async (f) => {
    setError('');
    try {
      const d = await api.get(`/api/documents${qs({ scope, ...f })}`);
      setDocs(d.documents);
    } catch (err) {
      setError(err.message);
      setDocs([]);
    }
  }, [scope]);

  useEffect(() => { setDocs(null); load(filters); }, [scope]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = (k) => (e) => setFilters({ ...filters, [k]: e.target.value });
  const search = (e) => { e.preventDefault(); load(filters); };
  const clear = () => { const f = { q: '', owner: '', category: '', from: '', to: '' }; setFilters(f); load(f); };
  const restore = async (id) => { try { await api.post(`/api/documents/${id}/restore`); load(filters); } catch (err) { setError(err.message); } };

  const [title, subtitle] = TITLES[scope];
  return (
    <>
      <div className="page-head">
        <div><h1>{title}</h1><p className="muted">{subtitle}</p></div>
        {user.role === 'owner' && scope !== 'trash' && (
          <button className="btn btn-cta" onClick={() => setShowUpload(true)}><Icon name="upload" /> Upload</button>
        )}
      </div>

      <form className="card filters" onSubmit={search}>
        <Field label="Name"><input placeholder="Search by name" value={filters.q} onChange={set('q')} /></Field>
        <Field label="Owner"><input placeholder="Name or email" value={filters.owner} onChange={set('owner')} /></Field>
        <Field label="Category">
          <select value={filters.category} onChange={set('category')}>
            <option value="">Any</option>
            {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
          </select>
        </Field>
        <Field label="Added from"><input type="date" value={filters.from} onChange={set('from')} /></Field>
        <Field label="Added to"><input type="date" value={filters.to} onChange={set('to')} /></Field>
        <div className="btn-row">
          <button className="btn btn-cta"><Icon name="search" size={16} /> Search</button>
          <button type="button" className="btn btn-quiet" onClick={clear}>Clear</button>
        </div>
      </form>

      <div className="card" style={{ marginTop: 16 }}>
        <Alert>{error}</Alert>
        {docs === null ? <div className="loading">Loading…</div> : docs.length === 0 ? (
          <Empty title="No documents here">
            {user.role === 'admin' ? 'Administrators only see documents someone shared with them.' : 'Nothing matches, or nothing has been shared with you yet.'}
          </Empty>
        ) : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Name</th><th>Category</th><th>Owner</th><th>Your access</th><th>Size</th><th>{scope === 'trash' ? 'Deleted' : 'Updated'}</th>{scope === 'trash' && <th />}</tr></thead>
              <tbody>
                {docs.map((d) => (
                  <tr key={d.id}>
                    <td>
                      {scope === 'trash' ? (
                        <span className="doc-name"><span className="doc-icon"><Icon name="doc" /></span>{d.name}</span>
                      ) : (
                        <Link to={`/documents/${d.id}`} className="doc-name"><span className="doc-icon"><Icon name="doc" /></span>{d.name}</Link>
                      )}
                    </td>
                    <td><Badge>{d.category}</Badge></td>
                    <td>{d.owner_name}<div className="small muted">{d.owner_email}</div></td>
                    <td><AccessBadge access={d.access} /></td>
                    <td className="muted">{fmtSize(d.size_bytes)}</td>
                    <td className="muted">{fmtDate(scope === 'trash' ? d.deleted_at : d.updated_at)}</td>
                    {scope === 'trash' && <td><button className="btn btn-sm" onClick={() => restore(d.id)}>Restore</button></td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showUpload && <UploadDialog onClose={() => setShowUpload(false)} onDone={() => { setShowUpload(false); load(filters); }} />}
    </>
  );
}

function UploadDialog({ onClose, onDone }) {
  const [file, setFile] = useState(null);
  const [name, setName] = useState('');
  const [category, setCategory] = useState('Other');
  const [description, setDescription] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!file) return setError('Choose a file to upload.');
    if (file.size > 5 * 1024 * 1024) return setError('The file is larger than 5 MB.'); // the server checks this too
    const form = new FormData();
    form.append('name', name);
    form.append('category', category);
    form.append('description', description);
    form.append('file', file);
    setBusy(true);
    setError('');
    try {
      await api.post('/api/documents', form);
      onDone();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog title="Upload a document" onClose={onClose} footer={<>
      <button className="btn btn-quiet" onClick={onClose}>Cancel</button>
      <button className="btn btn-cta" onClick={submit} disabled={busy}>{busy ? 'Uploading…' : 'Upload'}</button>
    </>}>
      <div className="form-grid">
        <Alert>{error}</Alert>
        <Field label="File" hint="PDF, Word, Excel, PowerPoint, PNG, JPG, TXT or CSV. Up to 5 MB.">
          <input type="file" accept=".pdf,.docx,.xlsx,.pptx,.png,.jpg,.jpeg,.txt,.csv" onChange={(e) => setFile(e.target.files[0] || null)} />
        </Field>
        <Field label="Name" hint="Leave empty to use the file name."><input value={name} maxLength={150} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="Category">
          <select value={category} onChange={(e) => setCategory(e.target.value)}>{CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select>
        </Field>
        <Field label="Description"><textarea rows={3} maxLength={1000} value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
        <p className="small muted">Only you can see this document until you share it.</p>
      </div>
    </Dialog>
  );
}
