import { createRoot } from 'react-dom/client';
import { HashRouter, Routes, Route, NavLink, Link } from 'react-router-dom';
import { Home, Cases, NewCase, Watch, Channel, Play, Agents, AgentPage, Leaderboards, Profile } from './pages';
import * as local from './local';
import './styles.css';

function Nav() {
  const me = local.useLocal(local.profile);
  const l = (to: string, label: string) => <NavLink to={to} className={({ isActive }) => `link ${isActive ? 'on' : ''}`}>{label}</NavLink>;
  return (
    <nav className="nav">
      <Link to="/" className="brand"><i />Interrogation Room</Link>
      {l('/channel', 'Watch')}{l('/cases', 'Cases')}{l('/agents', 'Agents')}{l('/leaderboards', 'Leaderboards')}
      <span className="sp" />
      <span className="faint mono">{me.points} pts</span>
      {l('/profile', me.handle)}
    </nav>
  );
}
// Hash routing keeps the site a set of static files that can be hosted anywhere.
createRoot(document.getElementById('root')!).render(
  <HashRouter>
    <Nav />
    <Routes>
      <Route path="/" element={<Home />} /><Route path="/channel" element={<Channel />} /><Route path="/cases" element={<Cases />} />
      <Route path="/new/:caseId" element={<NewCase />} /><Route path="/watch/:runId" element={<Watch />} /><Route path="/play/:id" element={<Play />} />
      <Route path="/agents" element={<Agents />} /><Route path="/agents/:id" element={<AgentPage />} /><Route path="/leaderboards" element={<Leaderboards />} /><Route path="/profile" element={<Profile />} />
      <Route path="*" element={<div className="page"><h2>Nothing here.</h2><Link to="/">Back to the front desk</Link></div>} />
    </Routes>
  </HashRouter>,
);
