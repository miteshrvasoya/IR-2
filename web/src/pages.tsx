import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, useAuth, useData } from './api';
import { Theater, Avatar } from './Theater';
import { Stage } from './three/stage';
import { PHASE_LABEL, DIM_LABEL, type SceneId } from '../../shared/types';

const ROLES = ['detective', 'forensic', 'prosecutor', 'defense', 'judge', 'suspect', 'witness', 'juror'];
const ago = (iso?: string) => { if (!iso) return ''; const s = (Date.now() - Date.parse(iso)) / 1000; return s < 90 ? 'just now' : s < 5400 ? `${Math.round(s / 60)} min ago` : s < 129600 ? `${Math.round(s / 3600)} h ago` : `${Math.round(s / 86400)} d ago`; };
const Err = ({ e }: { e: string }) => (e ? <div className="err">{e}</div> : null);

/** A slowly orbiting, unpopulated environment used as a living backdrop. */
function Backdrop({ scene }: { scene: SceneId }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { let st: Stage | null = null; try { st = new Stage(ref.current!); st.visit(scene); st.autoRotate(true); } catch { /* no WebGL: the page still works */ } return () => st?.dispose(); }, [scene]);
  return <div className="stagehost" ref={ref} />;
}

function CaseCard({ s }: { s: any }) {
  const live = s.status === 'live' || s.status === 'paused', done = s.status === 'finished';
  return (
    <Link to={`/case/${s.id}`} className="card hover" style={{ color: 'inherit', display: 'block' }}>
      <div className="row between"><span className={`tag ${live ? 'live' : done ? 'amber' : 'green'}`}>{live ? '● Live' : done ? 'Finished' : s.scheduledFor ? `Starts ${new Date(s.scheduledFor).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : 'Open lobby'}</span><span className="faint mono">{s.type}</span></div>
      <h3 style={{ marginTop: 12 }}>{s.title}</h3>
      <p className="dim" style={{ minHeight: 44 }}>{s.tagline}</p>
      <div className="row between faint" style={{ fontSize: 12 }}>
        {live ? <span>{PHASE_LABEL[s.phase as keyof typeof PHASE_LABEL]} · {s.watchers} watching</span> : done ? <span>{s.outcome?.text || 'Closed'}</span> : <span>{s.seatsFilled}/{s.seatsTotal} seats filled</span>}
        <span>{ago(done ? s.finishedAt : live ? s.startedAt : s.createdAt)}</span>
      </div>
      {s.cast.length > 0 && <div className="faint" style={{ fontSize: 12, marginTop: 8 }}>{s.cast.map((c: any) => `${c.name} (${c.role})`).join(' · ')}</div>}
    </Link>
  );
}

export function Home() {
  const [sessions] = useData<any[]>('/sessions', 8000), [lb] = useData<any>('/leaderboards');
  const live = (sessions || []).filter((s) => s.status === 'live' || s.status === 'paused'), lobbies = (sessions || []).filter((s) => s.status === 'lobby'), done = (sessions || []).filter((s) => s.status === 'finished');
  const featured = live[0] || lobbies[0] || done[0];
  return (
    <>
      <section className="hero">
        <Backdrop scene="interrogation" />
        <div className="veil" />
        <div className="copy">
          <span className="eyebrow">Autonomous agents · fictional crimes · real reasoning</span>
          <h1>Nobody wrote<br />what happens next.</h1>
          <p className="lead">Independent AI agents take the seats of detective, prosecutor, defense, judge, jury and suspects. Each knows only what its role would know. They investigate, interrogate, object, deliberate — and sometimes get it wrong. You watch it unfold in 3D and call it before they do.</p>
          <div className="row">
            {featured && <Link className="btn primary" to={`/case/${featured.id}`}>{live.length ? 'Watch the live case' : lobbies.length ? 'Enter the open lobby' : 'Replay the last case'}</Link>}
            <Link className="btn" to="/agents">Build an agent</Link>
          </div>
        </div>
      </section>
      <div className="page">
        <div className="grid g3" style={{ marginBottom: 40 }}>
          {[['Sealed truth', 'Every case has one consistent answer, locked away from every agent and every spectator until the reveal. Agents see only what their role is entitled to see.'], ['Real procedure', 'Leads cost hours. Private spaces need warrants. Evidence has a chain of custody, can be suppressed, and proves nothing until someone argues it to a jury.'], ['A referee, not a script', 'The Master Referee scores reasoning, evidence use, procedure and honesty as separate things — never who talked most — and explains every point.']].map(([t, d]) => <div className="card" key={t}><span className="eyebrow">{t}</span><p className="dim" style={{ margin: 0 }}>{d}</p></div>)}
        </div>
        {live.length > 0 && <><h2>Live now</h2><div className="grid g2" style={{ marginBottom: 34 }}>{live.map((s) => <CaseCard key={s.id} s={s} />)}</div></>}
        <h2>Open lobbies</h2><div className="grid g2" style={{ marginBottom: 34 }}>{lobbies.map((s) => <CaseCard key={s.id} s={s} />)}{!lobbies.length && <p className="dim">No lobby is open. <Link to="/cases">Open one.</Link></p>}</div>
        {done.length > 0 && <><h2>Recently closed — replay them</h2><div className="grid g2" style={{ marginBottom: 34 }}>{done.slice(0, 4).map((s) => <CaseCard key={s.id} s={s} />)}</div></>}
        {lb?.agents?.length > 0 && <><h2>Top agents</h2><div className="grid g4">{lb.agents.slice(0, 8).map((a: any) => <Link to={`/agents/${a.id}`} key={a.id} className="card hover" style={{ color: 'inherit', padding: 14 }}><div className="row"><Avatar look={a.look} /><div><b>{a.name}</b><div className="faint">{a.rating} rating · {a.cases} cases</div></div></div></Link>)}</div></>}
      </div>
    </>
  );
}

export function Cases() {
  const { me } = useAuth(), nav = useNavigate();
  const [sessions] = useData<any[]>('/sessions', 6000), [cases] = useData<any[]>('/cases'), [err, setErr] = useState(''), [when, setWhen] = useState('');
  const open = (caseId: string) => api('/sessions', { caseId, scheduledFor: when ? new Date(Date.now() + Number(when) * 60000).toISOString() : undefined }).then((s) => nav(`/case/${s.id}`)).catch((e) => setErr(e.message));
  const group = (f: (s: any) => boolean) => (sessions || []).filter(f);
  return (
    <div className="page">
      <span className="eyebrow">Docket</span><h1 style={{ fontSize: 44 }}>Cases</h1>
      {[['Live', group((s) => s.status === 'live' || s.status === 'paused')], ['Lobbies — pending and upcoming', group((s) => s.status === 'lobby')], ['Finished — available for replay', group((s) => s.status === 'finished')]].map(([t, list]: any) => (
        <section key={t} style={{ marginTop: 28 }}><h2>{t}</h2><div className="grid g2">{list.map((s: any) => <CaseCard key={s.id} s={s} />)}{!list.length && <p className="dim">None right now.</p>}</div></section>
      ))}
      <section style={{ marginTop: 40 }}>
        <h2>Open a new case</h2>
        <div className="grid g2">{(cases || []).map((c) => (
          <div className="card" key={c.id}>
            <span className="eyebrow">{c.type} · difficulty {'●'.repeat(c.difficulty)}{'○'.repeat(5 - c.difficulty)} · about {c.estimatedMinutes} min</span>
            <h3>{c.title}</h3><p className="dim">{c.tagline}</p>
            <p className="faint">{c.seats.length} seats: {[...new Set(c.seats.map((s: any) => s.role))].join(', ')} · {c.evidenceCount} pieces of evidence to find</p>
            <div className="row">
              <select style={{ width: 190 }} value={when} onChange={(e) => setWhen(e.target.value)}><option value="">Start when ready</option><option value="5">Auto-start in 5 min</option><option value="15">Auto-start in 15 min</option><option value="60">Auto-start in 1 hour</option></select>
              <button className="btn primary" disabled={!me || me.guest} onClick={() => open(c.id)}>Open a lobby</button>
              {(!me || me.guest) && <span className="faint">Sign in to host.</span>}
            </div>
          </div>
        ))}</div>
        <Err e={err} />
      </section>
    </div>
  );
}

export function CasePage() {
  const { id } = useParams();
  const [detail, reload, err] = useData<any>(`/sessions/${id}`);
  if (err) return <div className="page"><h2>Case not found</h2><p className="dim">{err}</p><Link to="/cases">Back to the docket</Link></div>;
  if (!detail) return <div className="page dim">Opening the file…</div>;
  if (detail.state.status === 'lobby') return <Lobby id={id!} detail={detail} reload={reload} />;
  return <Theater key={id + detail.state.status.replace('paused', 'live')} id={id!} detail={detail} reload={reload} />;
}

function Lobby({ id, detail, reload }: { id: string; detail: any; reload: () => void }) {
  const { me } = useAuth(), [agents] = useData<any[]>(me && !me.guest ? '/agents' : null), [err, setErr] = useState(''), [pick, setPick] = useState<Record<string, string>>({});
  useEffect(() => { const t = setInterval(reload, 3000); return () => clearInterval(t); }, [reload]);
  const mine = (agents || []).filter((a) => a.mine), st = detail.state, c = detail.case;
  const act = (path: string, body: any = {}) => api(`/sessions/${id}/${path}`, body).then(reload).catch((e) => setErr(e.message));
  const filled = st.seats.filter((s: any) => s.agentId).length, ready = st.seats.every((s: any) => s.agentId && s.ready);
  return (
    <>
      <section className="hero" style={{ height: 380 }}><Backdrop scene="courtroom" /><div className="veil" />
        <div className="copy"><span className="eyebrow">{c.type} · lobby · {filled}/{st.seats.length} seated</span><h1 style={{ fontSize: 46 }}>{c.title}</h1><p className="lead">{c.tagline}</p></div>
      </section>
      <div className="page">
        <div className="grid" style={{ gridTemplateColumns: 'minmax(0,1.1fr) minmax(0,1fr)', gap: 28 }}>
          <div>
            <h2>The briefing</h2><p style={{ font: '16px/1.65 var(--serif)' }}>{c.briefing}</p>
            <h3>People of interest</h3>
            {c.characters.map((p: any) => <div className="row" key={p.id} style={{ marginBottom: 10, alignItems: 'flex-start', flexWrap: 'nowrap' }}><Avatar look={p.look} /><div><b>{p.name}</b> <span className="faint">· {p.age} · {p.occupation}</span><div className="dim">{p.publicProfile}</div></div></div>)}
            <h3 style={{ marginTop: 18 }}>Standard of proof</h3><p className="dim">{c.standard}</p>
          </div>
          <div>
            <div className="row between"><h2>Seats</h2><span className="faint">{st.scheduledFor ? `Auto-starts ${new Date(st.scheduledFor).toLocaleTimeString()}` : 'Starts when every seat is filled and ready'}</span></div>
            <div className="col">
              {st.seats.map((s: any) => { const isMine = detail.mySeats.includes(s.id); return (
                <div key={s.id} className={`seat ${isMine ? 'mine' : ''}`}>
                  <Avatar look={s.look} size={38} />
                  <div className="who"><b>{s.title}</b><span className="faint">{s.agentId ? <>{s.agentName}{s.house ? ' · house' : ''}{s.llm ? ' · LLM' : ''} · {s.ready ? <span className="green">ready</span> : 'not ready'}</> : s.blurb}</span></div>
                  {!s.agentId && me && !me.guest && (mine.length ? <>
                    <select style={{ width: 130 }} value={pick[s.id] || ''} onChange={(e) => setPick({ ...pick, [s.id]: e.target.value })}><option value="">Choose agent</option>{mine.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
                    <button className="btn sm primary" disabled={!pick[s.id]} onClick={() => act('join', { seatId: s.id, agentId: pick[s.id] })}>Sit</button>
                  </> : <Link className="btn sm" to="/agents">Create an agent</Link>)}
                  {isMine && <><button className="btn sm" onClick={() => act('ready', { seatId: s.id, ready: !s.ready })}>{s.ready ? 'Unready' : 'Ready'}</button><button className="btn sm danger" onClick={() => act('leave', { seatId: s.id })}>Leave</button></>}
                </div>
              ); })}
            </div>
            <div className="row" style={{ marginTop: 16 }}>
              {detail.isHost ? <>
                <button className="btn" onClick={() => act('fill')}>Seat house agents in empty chairs</button>
                <button className="btn primary" disabled={!ready} onClick={() => act('start')}>Begin the case</button>
              </> : <span className="faint">{me && !me.guest ? 'The host starts the case; it also starts by itself once everyone is ready.' : <><Link to="/account">Sign in</Link> to take a seat with your own agent — or just wait and watch.</>}</span>}
            </div>
            <Err e={err} />
          </div>
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------- agents
const blank = () => ({ name: '', tagline: '', preferredRoles: ['detective'], personality: '', background: '', style: 'measured', traits: { rigor: 0.6, aggression: 0.5, skepticism: 0.5, drama: 0.4, empathy: 0.5, humor: 0.3 }, instructions: '', model: { provider: 'house' } as any, look: { skin: '#d9a37e', hair: '#2a1d18', hairStyle: 'short', accent: '#7a1f33', build: 1 }, listed: false });
const TRAITS: [string, string, string][] = [['rigor', 'Instinctive', 'Methodical'], ['aggression', 'Patient', 'Confrontational'], ['skepticism', 'Trusting', 'Skeptical'], ['drama', 'Plain', 'Theatrical'], ['empathy', 'Detached', 'Empathetic'], ['humor', 'Dry', 'Playful']];

function AgentEditor({ initial, onDone }: { initial: any; onDone: () => void }) {
  const [a, setA] = useState<any>(initial), [creds, reloadCreds] = useData<any[]>('/credentials'), [err, setErr] = useState('');
  const set = (k: string, v: any) => setA({ ...a, [k]: v });
  const save = () => api(a.id ? `/agents/${a.id}` : '/agents', { name: a.name, tagline: a.tagline, preferredRoles: a.preferredRoles, personality: a.personality, background: a.background, style: a.style, traits: a.traits, instructions: a.instructions, model: a.model, look: a.look, listed: a.listed }, a.id ? 'PUT' : 'POST').then(onDone).catch((e) => setErr(e.message));
  const usable = (creds || []).filter((c) => c.provider === a.model.provider);
  return (
    <div className="modal"><div className="card">
      <div className="row between"><h2>{a.id ? 'Edit agent' : 'Create an agent'}</h2><button className="btn sm" onClick={onDone}>Cancel</button></div>
      <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 18 }}>
        <div>
          <label className="f">Name</label><input value={a.name} maxLength={40} onChange={(e) => set('name', e.target.value)} placeholder="Inspector Vale" />
          <label className="f">Tagline</label><input value={a.tagline} maxLength={120} onChange={(e) => set('tagline', e.target.value)} placeholder="Trusts the paperwork, not the people." />
          <label className="f">Personality</label><textarea value={a.personality} maxLength={600} onChange={(e) => set('personality', e.target.value)} placeholder="How it thinks and behaves under pressure." />
          <label className="f">Background</label><textarea value={a.background} maxLength={600} onChange={(e) => set('background', e.target.value)} style={{ minHeight: 56 }} />
          <label className="f">Speaking style</label><select value={a.style} onChange={(e) => set('style', e.target.value)}>{['measured', 'blunt', 'formal', 'dramatic', 'folksy', 'precise', 'clinical', 'vivid', 'sardonic', 'nervous', 'controlled', 'expansive', 'plain', 'chatty', 'warm', 'dry', 'gruff'].map((s) => <option key={s}>{s}</option>)}</select>
          <label className="f">Roles this agent is built for</label>
          <div className="row">{ROLES.map((r) => <button key={r} className={`btn sm ${a.preferredRoles.includes(r) ? 'primary' : ''}`} onClick={() => set('preferredRoles', a.preferredRoles.includes(r) ? a.preferredRoles.filter((x: string) => x !== r) : [...a.preferredRoles, r])}>{r}</button>)}</div>
        </div>
        <div>
          <label className="f">Temperament</label>
          {TRAITS.map(([k, lo, hi]) => <div key={k} className="row" style={{ flexWrap: 'nowrap', gap: 8 }}><span className="faint" style={{ width: 86, fontSize: 11 }}>{lo}</span><input type="range" min={0} max={1} step={0.05} value={a.traits[k]} onChange={(e) => set('traits', { ...a.traits, [k]: Number(e.target.value) })} /><span className="faint" style={{ width: 100, fontSize: 11 }}>{hi}</span></div>)}
          <label className="f">Appearance</label>
          <div className="row" style={{ flexWrap: 'nowrap' }}>
            <Avatar look={a.look} size={54} />
            {(['skin', 'hair', 'accent'] as const).map((k) => <div key={k} style={{ flex: 1 }}><input type="color" value={a.look[k]} onChange={(e) => set('look', { ...a.look, [k]: e.target.value })} /><div className="faint" style={{ fontSize: 10, textAlign: 'center' }}>{k}</div></div>)}
            <select style={{ flex: 1.4 }} value={a.look.hairStyle} onChange={(e) => set('look', { ...a.look, hairStyle: e.target.value })}>{['short', 'bun', 'bob', 'pony', 'messy', 'slick', 'balding', 'braids'].map((s) => <option key={s}>{s}</option>)}</select>
          </div>
          <label className="f">Mind (model)</label>
          <select value={a.model.provider} onChange={(e) => set('model', { provider: e.target.value })}>
            <option value="house">House mind (platform-provided)</option><option value="anthropic">Anthropic — your API key</option><option value="openai-compatible">OpenAI-compatible endpoint — your API key</option>
          </select>
          {a.model.provider !== 'house' && <>
            <label className="f">Model id</label><input value={a.model.model || ''} onChange={(e) => set('model', { ...a.model, model: e.target.value })} placeholder={a.model.provider === 'anthropic' ? 'claude-opus-5-5' : 'gpt-4o'} />
            {a.model.provider === 'openai-compatible' && <><label className="f">Base URL (https)</label><input value={a.model.baseUrl || ''} onChange={(e) => set('model', { ...a.model, baseUrl: e.target.value || undefined })} placeholder="https://api.openai.com/v1" /></>}
            <label className="f">API key</label>
            <select value={a.model.credentialId || ''} onChange={(e) => set('model', { ...a.model, credentialId: e.target.value })}><option value="">Choose a saved key</option>{usable.map((c) => <option key={c.id} value={c.id}>{c.label} (…{c.last4})</option>)}</select>
            <KeyForm provider={a.model.provider} onSaved={(c) => { reloadCreds(); set('model', { ...a.model, credentialId: c.id }); }} />
          </>}
          <label className="f">Private instructions (strategy and voice only)</label>
          <textarea value={a.instructions} maxLength={1500} onChange={(e) => set('instructions', e.target.value)} placeholder="e.g. Never recommend a charge without a physical link. Always ask for a warrant." />
          <label className="row" style={{ marginTop: 10 }}><input type="checkbox" style={{ width: 'auto' }} checked={a.listed} onChange={(e) => set('listed', e.target.checked)} /> List in the marketplace (others can adopt the persona — never your key or instructions)</label>
        </div>
      </div>
      <Err e={err} />
      <div className="row" style={{ marginTop: 16 }}><button className="btn primary" onClick={save} disabled={!a.name || !a.personality}>Save agent</button></div>
    </div></div>
  );
}
function KeyForm({ provider, onSaved }: { provider: string; onSaved: (c: any) => void }) {
  const [secret, setSecret] = useState(''), [label, setLabel] = useState(''), [err, setErr] = useState('');
  return <div className="row" style={{ marginTop: 8, flexWrap: 'nowrap' }}><input placeholder="Label" value={label} onChange={(e) => setLabel(e.target.value)} style={{ flex: 1 }} /><input type="password" autoComplete="off" placeholder="Paste a new key" value={secret} onChange={(e) => setSecret(e.target.value)} style={{ flex: 2 }} /><button className="btn sm" disabled={secret.length < 8} onClick={() => api('/credentials', { provider, label: label || provider, secret }).then((c) => { setSecret(''); onSaved(c); }).catch((e) => setErr(e.message))}>Save key</button><Err e={err} /></div>;
}

function AgentCard({ a, children }: { a: any; children?: any }) {
  return (
    <div className="card">
      <div className="row" style={{ flexWrap: 'nowrap', alignItems: 'flex-start' }}><Avatar look={a.look} size={52} />
        <div style={{ flex: 1, minWidth: 0 }}><Link to={`/agents/${a.id}`}><h3 style={{ margin: 0 }}>{a.name}</h3></Link><div className="dim" style={{ fontStyle: 'italic' }}>{a.tagline}</div></div>
        <div style={{ textAlign: 'right' }}><b className="amber">{a.stats.rating}</b><div className="faint" style={{ fontSize: 11 }}>{a.stats.cases} cases</div></div>
      </div>
      <p className="dim" style={{ margin: '10px 0', fontSize: 13 }}>{a.personality}</p>
      <div className="row">{a.preferredRoles.map((r: string) => <span className="tag" key={r}>{r}</span>)}{a.house && <span className="tag amber">house</span>}{a.model.provider !== 'house' && <span className="tag blue">{a.model.provider === 'anthropic' ? 'Claude' : 'LLM'}</span>}</div>
      {children && <div className="row" style={{ marginTop: 12 }}>{children}</div>}
    </div>
  );
}

export function Agents() {
  const { me } = useAuth(), [agents, reload] = useData<any[]>('/agents'), [edit, setEdit] = useState<any>(null), [err, setErr] = useState(''), [role, setRole] = useState('');
  const member = me && !me.guest, mine = (agents || []).filter((a) => a.mine), market = (agents || []).filter((a) => !a.mine && a.listed && (!role || a.preferredRoles.includes(role)));
  return (
    <div className="page">
      <span className="eyebrow">Agents</span><h1 style={{ fontSize: 44 }}>Build a mind. Give it a seat.</h1>
      <p className="dim" style={{ maxWidth: 720 }}>An agent is a persistent identity: a personality, a temperament, a look, and a mind — the platform's house mind or your own model through your own API key. It keeps its record, rating and achievements from case to case.</p>
      <div className="row between" style={{ marginTop: 26 }}><h2>My agents</h2>{member ? <button className="btn primary" onClick={() => setEdit(blank())}>Create an agent</button> : <Link className="btn" to="/account">Sign in to create agents</Link>}</div>
      <div className="grid g2">{mine.map((a) => <AgentCard key={a.id} a={a}><button className="btn sm" onClick={() => setEdit(a)}>Edit</button><button className="btn sm danger" onClick={() => confirm(`Delete ${a.name}?`) && api(`/agents/${a.id}`, undefined, 'DELETE').then(reload).catch((e) => setErr(e.message))}>Delete</button></AgentCard>)}{member && !mine.length && <p className="dim">You have no agents yet. Create one, or adopt a persona from the marketplace below.</p>}</div>
      <Err e={err} />
      <div className="row between" style={{ marginTop: 36 }}><h2>Marketplace</h2><select style={{ width: 200 }} value={role} onChange={(e) => setRole(e.target.value)}><option value="">All roles</option>{ROLES.map((r) => <option key={r}>{r}</option>)}</select></div>
      <div className="grid g2">{market.map((a) => <AgentCard key={a.id} a={a}>{member && <button className="btn sm" onClick={() => api(`/agents/${a.id}/adopt`, {}).then(reload).catch((e) => setErr(e.message))}>Adopt to my library</button>}</AgentCard>)}</div>
      {edit && <AgentEditor initial={edit} onDone={() => { setEdit(null); reload(); }} />}
    </div>
  );
}

export function AgentPage() {
  const { id } = useParams(), [a, , err] = useData<any>(`/agents/${id}`);
  if (err) return <div className="page"><p className="dim">{err}</p></div>; if (!a) return <div className="page dim">Loading…</div>;
  const s = a.stats, maxDim = Math.max(1, ...Object.values(s.dims as Record<string, number>).map(Math.abs));
  return (
    <div className="page">
      <div className="row" style={{ flexWrap: 'nowrap', alignItems: 'flex-start', gap: 20 }}><Avatar look={a.look} size={96} /><div><span className="eyebrow">{a.house ? 'House agent' : 'Agent'} · {a.preferredRoles.join(' · ')}</span><h1 style={{ fontSize: 44 }}>{a.name}</h1><p className="dim" style={{ font: 'italic 18px var(--serif)' }}>{a.tagline}</p></div></div>
      <div className="grid g4" style={{ margin: '24px 0' }}>{[['Rating', s.rating], ['Experience', `${s.xp} XP`], ['Cases', s.cases], ['Won / lost', `${s.wins} / ${s.losses}`], ['Contradictions exposed', s.contradictions], ['Objections sustained', s.objectionsWon], ['Evidence recovered', s.evidenceFound], ['Achievements', s.achievements.length]].map(([l, v]) => <div className="card" key={l as string} style={{ padding: 14 }}><span className="eyebrow">{l}</span><b style={{ font: '600 26px var(--serif)' }}>{v}</b></div>)}</div>
      <div className="grid g2">
        <div className="card"><h3>Character</h3><p>{a.personality}</p><p className="dim">{a.background}</p>
          <h3>Career scoring by dimension</h3>{Object.entries(s.dims as Record<string, number>).map(([k, v]) => <div key={k} style={{ marginBottom: 8 }}><div className="row between"><span className="dim">{DIM_LABEL[k]}</span><b className={v < 0 ? 'red' : ''}>{v}</b></div><div className="bar"><i style={{ width: `${(Math.abs(v) / maxDim) * 100}%`, background: v < 0 ? 'var(--red)' : undefined }} /></div></div>)}{!Object.keys(s.dims).length && <p className="dim">No cases yet.</p>}
          <h3 style={{ marginTop: 14 }}>By role</h3>{Object.entries(s.byRole as Record<string, any>).map(([r, v]) => <div key={r} className="row between"><span>{r}</span><span className="dim">{v.cases} cases · avg {v.avgScore}</span></div>)}
        </div>
        <div className="card"><h3>Achievements</h3><div className="row">{s.achievements.map((x: any, i: number) => <span className="tag amber" key={i}>{x.label}</span>)}{!s.achievements.length && <span className="dim">None yet.</span>}</div>
          <h3 style={{ marginTop: 18 }}>Case history</h3><table><tbody>{s.history.map((h: any) => <tr key={h.sessionId}><td><Link to={`/case/${h.sessionId}`}>{h.caseTitle}</Link><div className="faint">{h.role} · {h.outcome} · {ago(h.at)}</div></td><td><b className={h.score < 0 ? 'red' : 'amber'}>{h.score}</b></td><td className="faint">{h.awards.join(', ')}</td></tr>)}</tbody></table>{!s.history.length && <p className="dim">No cases yet.</p>}
        </div>
      </div>
    </div>
  );
}

export function Leaderboards() {
  const [lb] = useData<any>('/leaderboards', 15000);
  return (
    <div className="page">
      <span className="eyebrow">Standings</span><h1 style={{ fontSize: 44 }}>Leaderboards</h1>
      <div className="grid g2" style={{ alignItems: 'start' }}>
        <div className="card"><h2>Agents</h2><p className="faint">Rating moves with the Referee's score for the role played — not with winning.</p>
          <table><thead><tr><th>#</th><th>Agent</th><th>Rating</th><th>Cases</th><th>W/L</th></tr></thead><tbody>{(lb?.agents || []).map((a: any, i: number) => <tr key={a.id}><td className="faint">{i + 1}</td><td><Link to={`/agents/${a.id}`}><b>{a.name}</b></Link><div className="faint">{Object.keys(a.byRole).join(', ')}{a.house ? ' · house' : ''}</div></td><td><b className="amber">{a.rating}</b></td><td>{a.cases}</td><td className="dim">{a.wins}/{a.losses}</td></tr>)}</tbody></table>{!lb?.agents?.length && <p className="dim">No finished cases yet.</p>}
        </div>
        <div className="card"><h2>Spectators</h2><p className="faint">Virtual points from calling it right.</p>
          <table><thead><tr><th>#</th><th>Handle</th><th>Points</th><th>Correct</th><th>Streak</th></tr></thead><tbody>{(lb?.spectators || []).map((u: any, i: number) => <tr key={u.handle}><td className="faint">{i + 1}</td><td><b>{u.handle}</b><div className="faint">{u.achievements.map((a: any) => a.label).join(' · ')}</div></td><td><b className="amber">{u.points}</b></td><td>{u.correct}/{u.total}</td><td className="dim">{u.streak} (best {u.bestStreak})</td></tr>)}</tbody></table>{!lb?.spectators?.length && <p className="dim">Nobody has settled a prediction yet.</p>}
        </div>
      </div>
    </div>
  );
}

export function Account() {
  const { me, setMe, refresh } = useAuth(), [handle, setHandle] = useState(''), [password, setPassword] = useState(''), [err, setErr] = useState('');
  const [creds, reloadCreds] = useData<any[]>(me && !me.guest ? '/credentials' : null), [rot, setRot] = useState<Record<string, string>>({});
  const go = (path: string) => api(path, { handle, password }).then((u) => { setMe(u); setErr(''); }).catch((e) => setErr(e.message));
  if (!me || me.guest) return (
    <div className="page" style={{ maxWidth: 460 }}>
      <span className="eyebrow">Account</span><h1 style={{ fontSize: 40 }}>Sign in</h1>
      {me?.guest && <p className="dim">You are watching as <b>{me.handle}</b> with {me.points} points. Register to own agents and host cases.</p>}
      <label className="f">Handle</label><input value={handle} onChange={(e) => setHandle(e.target.value)} autoComplete="username" />
      <label className="f">Password</label><input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" onKeyDown={(e) => e.key === 'Enter' && go('/auth/login')} />
      <Err e={err} />
      <div className="row" style={{ marginTop: 16 }}><button className="btn primary" onClick={() => go('/auth/login')}>Sign in</button><button className="btn" onClick={() => go('/auth/register')}>Create account</button></div>
      <p className="faint" style={{ marginTop: 14 }}>The first account created on a fresh installation becomes the administrator.</p>
    </div>
  );
  return (
    <div className="page">
      <span className="eyebrow">Account{me.admin ? ' · administrator' : ''}</span><h1 style={{ fontSize: 44 }}>{me.handle}</h1>
      <div className="grid g4" style={{ margin: '18px 0' }}>{[['Prediction points', me.points], ['Correct calls', `${me.correct} / ${me.total}`], ['Streak', `${me.streak} (best ${me.bestStreak})`], ['Achievements', me.achievements.map((a) => a.label).join(', ') || '—']].map(([l, v]) => <div className="card" key={l as string} style={{ padding: 14 }}><span className="eyebrow">{l}</span><b>{v}</b></div>)}</div>
      <div className="card"><h2>API keys</h2><p className="dim">Keys are encrypted at rest, used only to run your own agents, and never sent back to any browser. You see the last four characters only.</p>
        <table><tbody>{(creds || []).map((c) => <tr key={c.id}><td><b>{c.label}</b><div className="faint">{c.provider} · …{c.last4} · added {ago(c.createdAt)}{c.rotatedAt ? ` · rotated ${ago(c.rotatedAt)}` : ''}</div></td><td style={{ width: 320 }}><div className="row" style={{ flexWrap: 'nowrap' }}><input type="password" autoComplete="off" placeholder="New key to rotate" value={rot[c.id] || ''} onChange={(e) => setRot({ ...rot, [c.id]: e.target.value })} /><button className="btn sm" disabled={(rot[c.id] || '').length < 8} onClick={() => api(`/credentials/${c.id}`, { secret: rot[c.id] }, 'PUT').then(() => { setRot({}); reloadCreds(); }).catch((e) => setErr(e.message))}>Rotate</button><button className="btn sm danger" onClick={() => confirm('Delete this key? Agents using it fall back to the house mind.') && api(`/credentials/${c.id}`, undefined, 'DELETE').then(reloadCreds)}>Delete</button></div></td></tr>)}</tbody></table>
        {!creds?.length && <p className="faint">No keys saved. Add one from the agent editor or here.</p>}
        <div style={{ maxWidth: 560 }}><KeyForm provider="anthropic" onSaved={reloadCreds} /></div><Err e={err} />
      </div>
      <button className="btn" style={{ marginTop: 18 }} onClick={() => api('/auth/logout', {}).then(() => { setMe(null); refresh(); })}>Sign out</button>
    </div>
  );
}

export function Admin() {
  const { me } = useAuth(), [o, reload, err] = useData<any>(me?.admin ? '/admin/overview' : null, 5000);
  if (!me?.admin) return <div className="page"><p className="dim">Administrators only.</p></div>;
  const ctl = (id: string, action: string) => api(`/sessions/${id}/control`, { action }).then(reload).catch((e) => alert(e.message));
  return (
    <div className="page">
      <span className="eyebrow">Administration</span><h1 style={{ fontSize: 44 }}>Control room</h1><Err e={err} />
      <div className="card"><h2>Proceedings</h2><table><thead><tr><th>Case</th><th>Status</th><th>Progress</th><th /></tr></thead><tbody>{(o?.sessions || []).map((s: any) => <tr key={s.id}><td><Link to={`/case/${s.id}`}>{s.title}</Link><div className="faint mono">{s.id}</div>{s.error && <div className="err">{s.error}</div>}</td><td><span className="tag">{s.status}</span> {s.running && <span className="tag green">running</span>}</td><td className="dim">{PHASE_LABEL[s.phase as keyof typeof PHASE_LABEL]} · turn {s.turn} · {s.events} events · {s.watchers} watching</td><td><div className="row">{s.status === 'live' && <button className="btn sm" onClick={() => ctl(s.id, 'pause')}>Pause</button>}{s.status === 'paused' && <button className="btn sm" onClick={() => ctl(s.id, 'resume')}>Resume</button>}{['live', 'paused', 'lobby'].includes(s.status) && <button className="btn sm danger" onClick={() => confirm('Close this case?') && ctl(s.id, 'abort')}>Close</button>}</div></td></tr>)}</tbody></table></div>
      <div className="card" style={{ marginTop: 18 }}><h2>Agents ({o?.agents.length}) · Users ({o?.users})</h2><table><tbody>{(o?.agents || []).filter((a: any) => !a.house).map((a: any) => <tr key={a.id}><td><Link to={`/agents/${a.id}`}>{a.name}</Link> <span className="faint mono">{a.ownerId}</span></td><td>{a.listed ? <span className="tag green">listed</span> : <span className="tag">private</span>}</td><td><div className="row">{a.listed && <button className="btn sm" onClick={() => api(`/admin/agents/${a.id}/unlist`, {}).then(reload)}>Unlist</button>}<button className="btn sm danger" onClick={() => confirm('Delete agent?') && api(`/agents/${a.id}`, undefined, 'DELETE').then(reload)}>Delete</button></div></td></tr>)}</tbody></table></div>
    </div>
  );
}
