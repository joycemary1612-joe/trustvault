import { createContext, useContext, useEffect, useState } from 'react';
import { Navigate, NavLink, Route, Routes, useNavigate } from 'react-router-dom';
import { api } from './api.js';
import { Icon } from './components/ui.jsx';
import LoginPage from './pages/LoginPage.jsx';
import DocumentsPage from './pages/DocumentsPage.jsx';
import DocumentPage from './pages/DocumentPage.jsx';
import AdminPage from './pages/AdminPage.jsx';
import AccountPage from './pages/AccountPage.jsx';

const AuthContext = createContext(null);
export const useAuth = () => useContext(AuthContext);

export default function App() {
  const [user, setUser] = useState(undefined); // undefined = still checking

  useEffect(() => {
    api.get('/api/auth/me').then((d) => setUser(d.user)).catch(() => setUser(null));
  }, []);

  if (user === undefined) return <div className="loading">Loading TrustVault…</div>;

  return (
    <AuthContext.Provider value={{ user, setUser }}>
      {user ? (
        <Shell>
          <Routes>
            <Route path="/" element={<DocumentsPage scope="all" />} />
            <Route path="/mine" element={<DocumentsPage scope="mine" />} />
            <Route path="/shared" element={<DocumentsPage scope="shared" />} />
            <Route path="/trash" element={<DocumentsPage scope="trash" />} />
            <Route path="/documents/:id" element={<DocumentPage />} />
            <Route path="/account" element={<AccountPage />} />
            {/* Hiding this route is only for convenience; the API refuses non-admins. */}
            {user.role === 'admin' && <Route path="/admin" element={<AdminPage />} />}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Shell>
      ) : (
        <Routes>
          <Route path="*" element={<LoginPage />} />
        </Routes>
      )}
    </AuthContext.Provider>
  );
}

const roleLabel = { admin: 'Administrator', owner: 'Document owner', viewer: 'Viewer' };

function Shell({ children }) {
  const { user, setUser } = useAuth();
  const navigate = useNavigate();
  const signOut = async () => {
    await api.post('/api/auth/logout').catch(() => {});
    setUser(null);
    navigate('/');
  };
  const link = ({ isActive }) => `nav-link${isActive ? ' active' : ''}`;
  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark"><Icon name="shield" size={18} /></span>
          TrustVault <small>Secure documents</small>
        </div>
        <div className="spacer" />
        <div className="user-chip">
          <div style={{ textAlign: 'right', lineHeight: 1.2 }}>
            <div style={{ fontWeight: 700 }}>{user.name}</div>
            <div className="small muted">{roleLabel[user.role]}</div>
          </div>
          <span className="avatar">{user.name.split(' ').map((p) => p[0]).join('').slice(0, 2)}</span>
          <button className="icon-btn" onClick={signOut} title="Sign out" aria-label="Sign out"><Icon name="logout" /></button>
        </div>
      </header>
      <nav className="sidenav">
        <div className="nav-section">Documents</div>
        <NavLink end to="/" className={link}><Icon name="grid" /> All documents</NavLink>
        {user.role === 'owner' && <NavLink to="/mine" className={link}><Icon name="folder" /> My documents</NavLink>}
        <NavLink to="/shared" className={link}><Icon name="share" /> Shared with me</NavLink>
        {user.role === 'owner' && <NavLink to="/trash" className={link}><Icon name="trash" /> Trash</NavLink>}
        {user.role === 'admin' && (<>
          <div className="nav-section">Administration</div>
          <NavLink to="/admin" className={link}><Icon name="shield" /> Activity &amp; users</NavLink>
        </>)}
        <div className="nav-section">You</div>
        <NavLink to="/account" className={link}><Icon name="key" /> Account</NavLink>
      </nav>
      <main className="main">{children}</main>
    </div>
  );
}
