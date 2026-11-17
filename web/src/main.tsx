import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route, NavLink, Link, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './api';
import { Home, Cases, CasePage, Agents, AgentPage, Leaderboards, Account, Admin } from './pages';
import './styles.css';

function Nav() {
  const { me } = useAuth(), loc = useLocation();
  const l = (to: string, label: string) => <NavLink to={to} className={({ isActive }) => `link ${isActive ? 'on' : ''}`}>{label}</NavLink>;
  return (
    <nav className="nav">
      <Link to="/" className="brand"><i />Interrogation Room</Link>
      {l('/cases', 'Cases')}{l('/agents', 'Agents')}{l('/leaderboards', 'Leaderboards')}{me?.admin && l('/admin', 'Admin')}
      <span className="sp" />
      {me && <span className="faint mono">{me.points} pts</span>}
      {l('/account', me && !me.guest ? me.handle : 'Sign in')}
    </nav>
  );
}
createRoot(document.getElementById('root')!).render(
  <BrowserRouter><AuthProvider>
    <Nav />
    <Routes>
      <Route path="/" element={<Home />} /><Route path="/cases" element={<Cases />} /><Route path="/case/:id" element={<CasePage />} />
      <Route path="/agents" element={<Agents />} /><Route path="/agents/:id" element={<AgentPage />} /><Route path="/leaderboards" element={<Leaderboards />} />
      <Route path="/account" element={<Account />} /><Route path="/admin" element={<Admin />} /><Route path="*" element={<div className="page"><h2>Nothing here.</h2><Link to="/">Back to the front desk</Link></div>} />
    </Routes>
  </AuthProvider></BrowserRouter>,
);
