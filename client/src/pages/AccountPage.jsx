import { useState } from 'react';
import { api } from '../api.js';
import { useAuth } from '../App.jsx';
import { Alert, Field } from '../components/ui.jsx';

export default function AccountPage() {
  const { user } = useAuth();
  const [currentPassword, setCurrent] = useState('');
  const [newPassword, setNext] = useState('');
  const [msg, setMsg] = useState({});
  const save = async (e) => {
    e.preventDefault();
    try {
      await api.post('/api/auth/password', { currentPassword, newPassword });
      setMsg({ ok: 'Password changed. You were signed out on every other device.' });
      setCurrent(''); setNext('');
    } catch (err) { setMsg({ error: err.message }); }
  };
  return (
    <>
      <div className="page-head"><div><h1>Account</h1><p className="muted">{user.name} · {user.email} · {user.role}</p></div></div>
      <form className="card card-body form-grid" style={{ maxWidth: 440 }} onSubmit={save}>
        <h2>Change password</h2>
        <Alert>{msg.error}</Alert>
        <Alert kind="positive">{msg.ok}</Alert>
        <Field label="Current password"><input type="password" autoComplete="current-password" value={currentPassword} onChange={(e) => setCurrent(e.target.value)} required /></Field>
        <Field label="New password" hint="At least 10 characters, with letters and numbers."><input type="password" autoComplete="new-password" value={newPassword} onChange={(e) => setNext(e.target.value)} required /></Field>
        <div><button className="btn btn-cta">Change password</button></div>
      </form>
    </>
  );
}
