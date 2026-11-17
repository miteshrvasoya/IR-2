import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Theater, Avatar, type TheaterSource } from './Theater';
import { Stage } from './three/stage';
import { loadCases, loadRuns, loadRun, loadBundle, houseAgents, type CaseSummary, type RunSummary } from './data';
import * as local from './local';
import { LiveCase } from './live';
import { Sim } from '../../core/sim';
import { publicCase } from '../../core/caselib';
import { publicState, evidenceView } from '../../core/views';
import { PHASE_LABEL, DIM_LABEL, type AgentProfile, type SceneId } from '../../shared/types';

const ROLES = ['detective', 'forensic', 'prosecutor', 'defense', 'judge', 'suspect', 'witness', 'juror'];
const ROLE_LABEL: Record<string, string> = { detective: 'Detective', forensic: 'Forensic', prosecutor: 'Prosecutor', defense: 'Defense', judge: 'Judge', suspect: 'Suspect', witness: 'Witness', juror: 'Juror' };
const ago = (iso?: string) => { if (!iso) return ''; const s = (Date.now() - Date.parse(iso)) / 1000; return s < 90 ? 'just now' : s < 5400 ? `${Math.round(s / 60)} min ago` : s < 129600 ? `${Math.round(s / 3600)} h ago` : `${Math.round(s / 86400)} d ago`; };
const mins = (ms: number) => `${Math.max(1, Math.round(ms / 60000))} min`;
const Err = ({ e }: { e: string }) => (e ? <div className="err">{e}</div> : null);

/** Load anything async with a stable re-load handle. */
function useAsync<T>(fn: () => Promise<T>, deps: any[]): [T | null, string, () => void] {
  const [v, setV] = useState<T | null>(null), [err, setErr] = useState(''), [n, setN] = useState(0);
  useEffect(() => { let live = true; fn().then((x) => live && (setV(x), setErr(''))).catch((e) => live && setErr(String(e.message || e))); return () => { live = false; }; }, [...deps, n]);
  return [v, err, () => setN((x) => x + 1)];
}

/** A slowly orbiting, unpopulated environment used as a living backdrop. */
function Backdrop({ scene }: { scene: SceneId }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { let st: Stage | null = null; try { st = new Stage(ref.current!); st.visit(scene); st.autoRotate(true); } catch { /* no WebGL: the page still works */ } return () => st?.dispose(); }, [scene]);
  return <div className="stagehost" ref={ref} />;
}

/** Everything the theater panels need, derived from a session document with the shared engine views. */
function detailOf(sim: Sim) {
  const me = local.profile().id;
  return {
    state: publicState(sim), case: publicCase(sim.b), evidence: sim.discovered().map((e) => evidenceView(sim, e)),
    markets: sim.preds.markets, result: (sim.st as any).result || null,
    mySeats: Object.values(sim.st.seats).filter((s) => s.ownerId === me).map((s) => s.seatId),
  };
}
function mindOf(sim: Sim, seat: string) {
  return { memory: sim.memory(seat), thoughts: sim.events.filter((e) => e.type === 'thought' && e.actor?.seatId === seat).slice(-40).map((e) => ({ seq: e.seq, phase: e.phase, text: e.text })) };
}

function RunCard({ r, cases }: { r: RunSummary; cases?: CaseSummary[] }) {
  const c = cases?.find((x) => x.id === r.caseId);
  return (
    <Link to={`/watch/${r.id}`} className="card hover" style={{ color: 'inherit', display: 'block' }}>
      <div className="row between"><span className="tag amber">{r.featured ? '★ Featured recording' : 'Recording'}</span><span className="faint mono">{c?.type} · {mins(r.durationMs)}</span></div>
      <h3 style={{ marginTop: 12 }}>{r.title}</h3>
      <p className="dim" style={{ minHeight: 44 }}>{r.blurb}</p>
      <div className="faint" style={{ fontSize: 12 }}>{r.cast.map((x) => `${x.name} (${ROLE_LABEL[x.role]})`).join(' · ')}</div>
      <div className="faint" style={{ fontSize: 12, marginTop: 6 }}>Verdict hidden — watch it unfold.</div>
    </Link>
  );
}
function SessionCard({ s, onDelete }: { s: local.SessionSummary; onDelete: () => void }) {
  const live = s.status === 'live' || s.status === 'paused';
  return (
    <div className="card">
      <div className="row between"><span className={`tag ${live ? 'live' : s.status === 'finished' ? 'amber' : 'green'}`}>{live ? (s.status === 'paused' ? 'Paused' : '● Running') : s.status === 'finished' ? 'Finished' : 'Not started'}</span><span className="faint mono">{ago(s.createdAt)}</span></div>
      <h3 style={{ marginTop: 12 }}>{s.title}</h3>
      <p className="dim">{s.status === 'finished' ? s.outcome?.text : PHASE_LABEL[s.phase as keyof typeof PHASE_LABEL]}</p>
      <div className="row">
        <Link className="btn sm primary" to={`/play/${s.id}`}>{s.status === 'finished' ? 'Replay' : 'Open'}</Link>
        <button className="btn sm" onClick={() => local.download(`${s.id}.json`, local.loadSession(s.id))}>Download JSON</button>
        <button className="btn sm danger" onClick={() => confirm('Delete this proceeding from this browser?') && onDelete()}>Delete</button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- home & docket
export function Home() {
  const [runs] = useAsync(loadRuns, []), [cases] = useAsync(loadCases, []), [house] = useAsync(houseAgents, []);
  const featured = (runs?.runs || []).filter((r) => r.featured);
  return (
    <>
      <section className="hero">
        <Backdrop scene="interrogation" />
        <div className="veil" />
        <div className="copy">
          <span className="eyebrow">Autonomous agents · fictional crimes · real reasoning</span>
          <h1>Nobody wrote<br />what happens next.</h1>
          <p className="lead">Independent agents take the seats of detective, prosecutor, defense, judge, jury and suspects. Each knows only what its role would know. They investigate, interrogate, object, deliberate — and sometimes get it wrong. Watch it unfold in 3D, and call it before they do.</p>
          <div className="row">
            <Link className="btn primary" to="/channel">▶ Watch now</Link>
            <Link className="btn" to="/cases">Run a case yourself</Link>
            <Link className="btn" to="/agents">Build an agent</Link>
          </div>
        </div>
      </section>
      <div className="page">
        <div className="grid g3" style={{ marginBottom: 40 }}>
          {[['Sealed truth', 'Every case has one consistent answer. Each agent sees only what its role is entitled to see, so the detective can chase the wrong suspect and a jury can acquit the guilty.'], ['Real procedure', 'Leads cost hours. Private spaces need warrants. Evidence has a chain of custody, can be suppressed, and proves nothing until someone argues it to a jury.'], ['A referee, not a script', 'The Master Referee scores reasoning, evidence use, procedure and honesty as separate things — never who talked most — and explains every point.']].map(([t, d]) => <div className="card" key={t}><span className="eyebrow">{t}</span><p className="dim" style={{ margin: 0 }}>{d}</p></div>)}
        </div>
        <div className="row between"><h2>Featured recordings</h2><Link to="/channel" className="btn sm">Play them back to back</Link></div>
        <div className="grid g2" style={{ marginBottom: 34 }}>{featured.map((r) => <RunCard key={r.id} r={r} cases={cases || undefined} />)}</div>
        <h2>Case files</h2>
        <div className="grid g2" style={{ marginBottom: 34 }}>{(cases || []).map((c) => <CaseFileCard key={c.id} c={c} />)}</div>
        {house && <><h2>Top house agents</h2><div className="grid g4">{house.filter((a) => a.stats.cases).sort((a, b) => b.stats.rating - a.stats.rating).slice(0, 8).map((a) => <Link to={`/agents/${a.id}`} key={a.id} className="card hover" style={{ color: 'inherit', padding: 14 }}><div className="row"><Avatar look={a.look} /><div><b>{a.name}</b><div className="faint">{a.stats.rating} rating · {a.stats.cases} cases</div></div></div></Link>)}</div></>}
      </div>
    </>
  );
}

function CaseFileCard({ c }: { c: CaseSummary }) {
  return (
    <div className="card">
      <span className="eyebrow">{c.type} · difficulty {'●'.repeat(c.difficulty)}{'○'.repeat(5 - c.difficulty)} · about {c.estimatedMinutes} min</span>
      <h3>{c.title}</h3><p className="dim">{c.tagline}</p>
      <p className="faint">{c.seats.length} seats · {c.characters.length} people of interest · {c.evidenceCount} pieces of evidence to find</p>
      <Link className="btn primary" to={`/new/${c.id}`}>Start a new proceeding</Link>
    </div>
  );
}

export function Cases() {
  const [runs] = useAsync(loadRuns, []), [cases] = useAsync(loadCases, []);
  const sessions = local.useLocal(local.listSessions), [msg, setMsg] = useState(''), file = useRef<HTMLInputElement>(null);
  const importJson = async (f: File) => { try { setMsg(local.importFile(JSON.parse(await f.text()))); } catch (e: any) { setMsg(e.message); } };
  return (
    <div className="page">
      <span className="eyebrow">Docket</span><h1 style={{ fontSize: 44 }}>Cases</h1>
      <section style={{ marginTop: 24 }}>
        <div className="row between"><h2>Sample proceedings</h2><Link to="/channel" className="btn sm">Watch them all</Link></div>
        <p className="dim">Complete cases played out by the house agents and stored as JSON files. Each line-up reasoned its own way to its own verdict.</p>
        <div className="grid g2">{(runs?.runs || []).map((r) => <RunCard key={r.id} r={r} cases={cases || undefined} />)}</div>
      </section>
      <section style={{ marginTop: 36 }}>
        <h2>Case files</h2>
        <p className="dim">Start a fresh proceeding. It runs live in your browser with your agents in any seats you choose and house agents in the rest.</p>
        <div className="grid g2">{(cases || []).map((c) => <CaseFileCard key={c.id} c={c} />)}</div>
      </section>
      <section style={{ marginTop: 36 }}>
        <div className="row between"><h2>My proceedings</h2>
          <div className="row"><input ref={file} type="file" accept="application/json,.json" style={{ display: 'none' }} onChange={(e) => e.target.files?.[0] && importJson(e.target.files[0])} /><button className="btn sm" onClick={() => file.current?.click()}>Import a JSON file</button></div>
        </div>
        {msg && <p className="amber">{msg}</p>}
        <div className="grid g2">{sessions.map((s) => <SessionCard key={s.id} s={s} onDelete={() => local.deleteSession(s.id)} />)}{!sessions.length && <p className="dim">Nothing yet. Proceedings you start are saved in this browser as JSON and can be downloaded.</p>}</div>
      </section>
    </div>
  );
}

// ---------------------------------------------------------------- new proceeding (lobby)
export function NewCase() {
  const { caseId } = useParams(), nav = useNavigate();
  const [cases] = useAsync(loadCases, []), [house] = useAsync(houseAgents, []);
  const mine = local.useLocal(local.myAgents), [picks, setPicks] = useState<Record<string, string>>({}), [err, setErr] = useState(''), [busy, setBusy] = useState(false);
  const c = cases?.find((x) => x.id === caseId);
  if (!cases || !house) return <div className="page dim">Opening the case file…</div>;
  if (!c) return <div className="page"><h2>No such case.</h2><Link to="/cases">Back to the docket</Link></div>;
  const taken = (id: string, seat: string) => Object.entries(picks).some(([s, a]) => a === id && s !== seat);
  const start = async () => {
    setBusy(true); setErr('');
    try { const lc = await LiveCase.create(c.id, picks); lc.start(); nav(`/play/${lc.sim.id}`); }
    catch (e: any) { setErr(e.message); setBusy(false); }
  };
  return (
    <>
      <section className="hero" style={{ height: 360 }}><Backdrop scene="courtroom" /><div className="veil" />
        <div className="copy"><span className="eyebrow">{c.type} · new proceeding</span><h1 style={{ fontSize: 46 }}>{c.title}</h1><p className="lead">{c.tagline}</p></div>
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
            <h2>Seats</h2>
            <p className="faint">Leave a seat on <b>House</b> and the platform casts a suitable house agent. {mine.length ? '' : <>You have no agents yet — <Link to="/agents">create one</Link> to take a seat yourself.</>}</p>
            <div className="col">
              {c.seats.map((s: any) => {
                const options = [...mine.filter((a) => a.preferredRoles.includes(s.role)), ...house.filter((a) => a.preferredRoles.includes(s.role)), ...mine.filter((a) => !a.preferredRoles.includes(s.role))];
                const chosen = [...mine, ...house].find((a) => a.id === picks[s.id]);
                return (
                  <div key={s.id} className={`seat ${chosen && !chosen.house ? 'mine' : ''}`}>
                    <Avatar look={s.characterId ? c.characters.find((x: any) => x.id === s.characterId)?.look : chosen?.look} size={38} />
                    <div className="who"><b>{s.title}</b><span className="faint">{chosen ? `${chosen.name}${chosen.house ? ' · house' : ' · yours'}${chosen.model.provider !== 'house' ? ' · own model' : ''}` : s.blurb}</span></div>
                    <select style={{ width: 170 }} value={picks[s.id] || ''} onChange={(e) => setPicks({ ...picks, [s.id]: e.target.value })}>
                      <option value="">House (auto)</option>
                      {options.map((a) => <option key={a.id} value={a.id} disabled={taken(a.id, s.id)}>{a.house ? '' : '★ '}{a.name}</option>)}
                    </select>
                  </div>
                );
              })}
            </div>
            <div className="row" style={{ marginTop: 16 }}><button className="btn primary" disabled={busy} onClick={start}>{busy ? 'Opening…' : 'Begin the case'}</button><span className="faint">Runs live in this tab and is saved as JSON in this browser.</span></div>
            <Err e={err} />
          </div>
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------- watching
function useReplay(runId: string | undefined) {
  return useAsync(async () => {
    const run = await loadRun(runId!), b = await loadBundle(run.meta.caseId);
    return { run, sim: Sim.fromDoc(run, b) };
  }, [runId]);
}

export function Watch() {
  const { runId } = useParams(), [data, err] = useReplay(runId);
  if (err) return <div className="page"><h2>Recording not found</h2><p className="dim">{err}</p><Link to="/cases">Back to the docket</Link></div>;
  if (!data) return <div className="page dim">Loading the recording…</div>;
  return <ReplayTheater key={runId} id={runId!} sim={data.sim} />;
}
function ReplayTheater({ id, sim, onEnded, channel }: { id: string; sim: Sim; onEnded?: () => void; channel?: string }) {
  const detail = useMemo(() => detailOf(sim), [sim]);
  const source = useMemo<TheaterSource>(() => ({ kind: 'replay', id, events: () => sim.events, refresh: () => {} }), [sim, id]);
  return <Theater id={id} detail={detail} source={source} onEnded={onEnded} channel={channel} />;
}

/** "On air": plays the sample recordings back to back, forever. */
export function Channel() {
  const [runs] = useAsync(loadRuns, []), [i, setI] = useState(0);
  const list = useMemo(() => (runs?.runs || []).slice().sort((a, b) => Number(b.featured) - Number(a.featured)), [runs]);
  const cur = list.length ? list[i % list.length] : null, [data, err] = useReplay(cur?.id);
  if (err) return <div className="page dim">{err}</div>;
  if (!cur || !data || data.run.meta.id !== cur.id) return <div className="page dim">Tuning in…</div>;
  return <ReplayTheater key={cur.id + i} id={cur.id} sim={data.sim} onEnded={() => setI((x) => x + 1)} channel={`On air · ${(i % list.length) + 1}/${list.length}`} />;
}

export function Play() {
  const { id } = useParams(), [lc, setLc] = useState<LiveCase | null | undefined>(undefined), [tick, setTick] = useState(0);
  useEffect(() => { LiveCase.open(id!).then(setLc).catch(() => setLc(null)); }, [id]);
  const refresh = useCallback(() => setTick((x) => x + 1), []);
  const kind = lc && lc.sim.st.status !== 'finished' ? 'live' : 'replay';
  const detail = useMemo(() => (lc ? detailOf(lc.sim) : null), [lc, tick]);
  const source = useMemo<TheaterSource | null>(() => lc ? {
    kind, id: lc.sim.id, events: () => lc.sim.events, subscribe: (f) => lc.subscribe(f), refresh,
    control: (a) => (a === 'pause' ? lc.pause() : lc.resume()), mind: (s) => mindOf(lc.sim, s), reconnect: (s) => lc.reconnect(s),
  } : null, [lc, kind, refresh]);
  if (lc === null) return <div className="page"><h2>Proceeding not found in this browser.</h2><p className="dim">Proceedings are stored locally. If you have its JSON file, import it from the Cases page.</p><Link to="/cases">Back to the docket</Link></div>;
  if (!lc || !detail || !source) return <div className="page dim">Opening the file…</div>;
  return <Theater key={id + kind} id={id!} detail={detail} source={source} />;
}

// ---------------------------------------------------------------- agents
const blank = () => ({ name: '', tagline: '', preferredRoles: ['detective'], personality: '', background: '', style: 'measured', traits: { rigor: 0.6, aggression: 0.5, skepticism: 0.5, drama: 0.4, empathy: 0.5, humor: 0.3 }, instructions: '', model: { provider: 'house' } as any, look: { skin: '#d9a37e', hair: '#2a1d18', hairStyle: 'short', accent: '#7a1f33', build: 1 } });
const TRAITS: [string, string, string][] = [['rigor', 'Instinctive', 'Methodical'], ['aggression', 'Patient', 'Confrontational'], ['skepticism', 'Trusting', 'Skeptical'], ['drama', 'Plain', 'Theatrical'], ['empathy', 'Detached', 'Empathetic'], ['humor', 'Dry', 'Playful']];

function AgentEditor({ initial, onDone }: { initial: any; onDone: () => void }) {
  const [a, setA] = useState<any>(initial), keys = local.useLocal(local.listKeys), [err, setErr] = useState('');
  const set = (k: string, v: any) => setA({ ...a, [k]: v });
  const save = () => { try { local.saveAgent(a, a.id); onDone(); } catch (e: any) { setErr(e.issues ? e.issues.map((i: any) => i.message).join(' ') : e.message); } };
  const usable = keys.filter((k) => k.provider === a.model.provider);
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
            <option value="house">House reasoner (built in, offline)</option><option value="anthropic">Anthropic — your API key</option><option value="openai-compatible">OpenAI-compatible endpoint — your API key</option>
          </select>
          {a.model.provider !== 'house' && <>
            <label className="f">Model id</label><input value={a.model.model || ''} onChange={(e) => set('model', { ...a.model, model: e.target.value })} placeholder={a.model.provider === 'anthropic' ? 'claude-opus-5-5' : 'gpt-4o'} />
            {a.model.provider === 'openai-compatible' && <><label className="f">Base URL (https)</label><input value={a.model.baseUrl || ''} onChange={(e) => set('model', { ...a.model, baseUrl: e.target.value || undefined })} placeholder="https://api.openai.com/v1" /></>}
            <label className="f">API key</label>
            <select value={a.model.credentialId || ''} onChange={(e) => set('model', { ...a.model, credentialId: e.target.value })}><option value="">Choose a saved key</option>{usable.map((c) => <option key={c.id} value={c.id}>{c.label} (…{c.last4})</option>)}</select>
            <KeyForm provider={a.model.provider} onSaved={(id) => set('model', { ...a.model, credentialId: id })} />
            <p className="faint" style={{ fontSize: 12 }}>The key is kept in this browser only and sent straight to the provider when this agent thinks. It is never included in exports.</p>
          </>}
          <label className="f">Private instructions (strategy and voice only)</label>
          <textarea value={a.instructions} maxLength={1500} onChange={(e) => set('instructions', e.target.value)} placeholder="e.g. Never recommend a charge without a physical link. Always ask for a warrant." />
        </div>
      </div>
      <Err e={err} />
      <div className="row" style={{ marginTop: 16 }}><button className="btn primary" onClick={save}>Save agent</button></div>
    </div></div>
  );
}
function KeyForm({ provider, onSaved }: { provider: string; onSaved: (id: string) => void }) {
  const [secret, setSecret] = useState(''), [label, setLabel] = useState(''), [err, setErr] = useState('');
  return <div className="row" style={{ marginTop: 8, flexWrap: 'nowrap' }}><input placeholder="Label" value={label} onChange={(e) => setLabel(e.target.value)} style={{ flex: 1 }} /><input type="password" autoComplete="off" placeholder="Paste a new key" value={secret} onChange={(e) => setSecret(e.target.value)} style={{ flex: 2 }} /><button className="btn sm" disabled={secret.length < 8} onClick={() => { try { const id = local.saveKey(provider as any, label || provider, secret); setSecret(''); onSaved(id); } catch (e: any) { setErr(e.message); } }}>Save key</button><Err e={err} /></div>;
}

function AgentCard({ a, children }: { a: AgentProfile; children?: any }) {
  return (
    <div className="card">
      <div className="row" style={{ flexWrap: 'nowrap', alignItems: 'flex-start' }}><Avatar look={a.look} size={52} />
        <div style={{ flex: 1, minWidth: 0 }}><Link to={`/agents/${a.id}`}><h3 style={{ margin: 0 }}>{a.name}</h3></Link><div className="dim" style={{ fontStyle: 'italic' }}>{a.tagline}</div></div>
        <div style={{ textAlign: 'right' }}><b className="amber">{a.stats.rating}</b><div className="faint" style={{ fontSize: 11 }}>{a.stats.cases} cases</div></div>
      </div>
      <p className="dim" style={{ margin: '10px 0', fontSize: 13 }}>{a.personality}</p>
      <div className="row">{a.preferredRoles.map((r) => <span className="tag" key={r}>{r}</span>)}{a.house ? <span className="tag amber">house</span> : <span className="tag green">yours</span>}{a.model.provider !== 'house' && <span className="tag blue">{a.model.provider === 'anthropic' ? 'Claude' : 'LLM'}</span>}</div>
      {children && <div className="row" style={{ marginTop: 12 }}>{children}</div>}
    </div>
  );
}

export function Agents() {
  const mine = local.useLocal(local.myAgents), [house] = useAsync(houseAgents, []), [edit, setEdit] = useState<any>(null), [role, setRole] = useState('');
  const market = (house || []).filter((a) => !role || a.preferredRoles.includes(role as any));
  const adopt = (a: AgentProfile) => { const { name, tagline, preferredRoles, personality, background, style, traits, look } = a; local.saveAgent({ name, tagline, preferredRoles, personality, background, style, traits, look, instructions: '', model: { provider: 'house' } }); };
  return (
    <div className="page">
      <span className="eyebrow">Agents</span><h1 style={{ fontSize: 44 }}>Build a mind. Give it a seat.</h1>
      <p className="dim" style={{ maxWidth: 720 }}>An agent is a persistent identity: a personality, a temperament, a look, and a mind — the built-in house reasoner or your own model through your own API key. Your agents live in this browser and keep their record from case to case.</p>
      <div className="row between" style={{ marginTop: 26 }}><h2>My agents</h2><button className="btn primary" onClick={() => setEdit(blank())}>Create an agent</button></div>
      <div className="grid g2">{mine.map((a) => <AgentCard key={a.id} a={a}><button className="btn sm" onClick={() => setEdit(a)}>Edit</button><button className="btn sm danger" onClick={() => confirm(`Delete ${a.name}?`) && local.deleteAgent(a.id)}>Delete</button></AgentCard>)}{!mine.length && <p className="dim">You have no agents yet. Create one, or adopt a house persona below and make it your own.</p>}</div>
      <div className="row between" style={{ marginTop: 36 }}><h2>House agents</h2><select style={{ width: 200 }} value={role} onChange={(e) => setRole(e.target.value)}><option value="">All roles</option>{ROLES.map((r) => <option key={r}>{r}</option>)}</select></div>
      <p className="faint">The platform's default cast, defined in <span className="mono">data/agents.json</span>. Their records come from the sample proceedings.</p>
      <div className="grid g2">{market.map((a) => <AgentCard key={a.id} a={a}><button className="btn sm" onClick={() => adopt(a)}>Adopt a copy</button></AgentCard>)}</div>
      {edit && <AgentEditor initial={edit} onDone={() => setEdit(null)} />}
    </div>
  );
}

export function AgentPage() {
  const { id } = useParams(), mine = local.useLocal(local.myAgents), [house] = useAsync(houseAgents, []);
  const a = mine.find((x) => x.id === id) || house?.find((x) => x.id === id);
  if (!a) return <div className="page dim">{house ? 'Agent not found.' : 'Loading…'}</div>;
  const s = a.stats, maxDim = Math.max(1, ...Object.values(s.dims as Record<string, number>).map(Math.abs));
  const link = (sid: string) => (a.house ? `/watch/${sid}` : `/play/${sid}`);
  return (
    <div className="page">
      <div className="row" style={{ flexWrap: 'nowrap', alignItems: 'flex-start', gap: 20 }}><Avatar look={a.look} size={96} /><div><span className="eyebrow">{a.house ? 'House agent' : 'Your agent'} · {a.preferredRoles.join(' · ')}</span><h1 style={{ fontSize: 44 }}>{a.name}</h1><p className="dim" style={{ font: 'italic 18px var(--serif)' }}>{a.tagline}</p></div></div>
      <div className="grid g4" style={{ margin: '24px 0' }}>{[['Rating', s.rating], ['Experience', `${s.xp} XP`], ['Cases', s.cases], ['Won / lost', `${s.wins} / ${s.losses}`], ['Contradictions exposed', s.contradictions], ['Objections sustained', s.objectionsWon], ['Evidence recovered', s.evidenceFound], ['Achievements', s.achievements.length]].map(([l, v]) => <div className="card" key={l as string} style={{ padding: 14 }}><span className="eyebrow">{l}</span><b style={{ font: '600 26px var(--serif)' }}>{v}</b></div>)}</div>
      <div className="grid g2">
        <div className="card"><h3>Character</h3><p>{a.personality}</p><p className="dim">{a.background}</p>
          <h3>Career scoring by dimension</h3>{Object.entries(s.dims as Record<string, number>).map(([k, v]) => <div key={k} style={{ marginBottom: 8 }}><div className="row between"><span className="dim">{DIM_LABEL[k]}</span><b className={v < 0 ? 'red' : ''}>{v}</b></div><div className="bar"><i style={{ width: `${(Math.abs(v) / maxDim) * 100}%`, background: v < 0 ? 'var(--red)' : undefined }} /></div></div>)}{!Object.keys(s.dims).length && <p className="dim">No cases yet.</p>}
          <h3 style={{ marginTop: 14 }}>By role</h3>{Object.entries(s.byRole as Record<string, any>).map(([r, v]) => <div key={r} className="row between"><span>{r}</span><span className="dim">{v.cases} cases · avg {v.avgScore}</span></div>)}
        </div>
        <div className="card"><h3>Achievements</h3><div className="row">{s.achievements.map((x, i) => <span className="tag amber" key={i}>{x.label}</span>)}{!s.achievements.length && <span className="dim">None yet.</span>}</div>
          <h3 style={{ marginTop: 18 }}>Case history</h3><table><tbody>{s.history.map((h) => <tr key={h.sessionId + h.role}><td><Link to={link(h.sessionId)}>{h.caseTitle}</Link><div className="faint">{h.role} · {h.outcome}</div></td><td><b className={h.score < 0 ? 'red' : 'amber'}>{h.score}</b></td><td className="faint">{h.awards.join(', ')}</td></tr>)}</tbody></table>{!s.history.length && <p className="dim">No cases yet.</p>}
        </div>
      </div>
    </div>
  );
}

export function Leaderboards() {
  const mine = local.useLocal(local.myAgents), me = local.useLocal(local.profile), [house] = useAsync(houseAgents, []);
  const agents = [...(house || []), ...mine].filter((a) => a.stats.cases > 0).sort((a, b) => b.stats.rating - a.stats.rating);
  return (
    <div className="page">
      <span className="eyebrow">Standings</span><h1 style={{ fontSize: 44 }}>Leaderboards</h1>
      <div className="grid g2" style={{ alignItems: 'start' }}>
        <div className="card"><h2>Agents</h2><p className="faint">Rating moves with the Referee's score for the role played — not with winning. House records come from the sample proceedings; yours from the cases you run.</p>
          <table><thead><tr><th>#</th><th>Agent</th><th>Rating</th><th>Cases</th><th>W/L</th></tr></thead><tbody>{agents.map((a, i) => <tr key={a.id}><td className="faint">{i + 1}</td><td><Link to={`/agents/${a.id}`}><b>{a.name}</b></Link><div className="faint">{Object.keys(a.stats.byRole).join(', ')}{a.house ? ' · house' : ' · yours'}</div></td><td><b className="amber">{a.stats.rating}</b></td><td>{a.stats.cases}</td><td className="dim">{a.stats.wins}/{a.stats.losses}</td></tr>)}</tbody></table>
        </div>
        <div className="card"><h2>Your record as a spectator</h2><p className="faint">Predictions are settled when you watch a case reach its reveal. Virtual points only.</p>
          <table><tbody>{[['Points', me.points], ['Correct calls', `${me.correct} / ${me.total}`], ['Streak', `${me.streak} (best ${me.bestStreak})`]].map(([l, v]) => <tr key={l as string}><td className="dim">{l}</td><td><b>{v}</b></td></tr>)}</tbody></table>
          <div className="row" style={{ marginTop: 12 }}>{me.achievements.map((a) => <span className="tag amber" key={a.id}>{a.label}</span>)}</div>
        </div>
      </div>
    </div>
  );
}

export function Profile() {
  const me = local.useLocal(local.profile), keys = local.useLocal(local.listKeys), [handle, setHandle] = useState(me.handle), [msg, setMsg] = useState(''), [rot, setRot] = useState<Record<string, string>>({}), file = useRef<HTMLInputElement>(null);
  return (
    <div className="page">
      <span className="eyebrow">Profile · stored in this browser</span><h1 style={{ fontSize: 44 }}>{me.handle}</h1>
      <div className="row" style={{ maxWidth: 480, flexWrap: 'nowrap' }}><input value={handle} maxLength={24} onChange={(e) => setHandle(e.target.value)} /><button className="btn" onClick={() => local.updateProfile((p) => { p.handle = handle.trim().slice(0, 24) || p.handle; })}>Rename</button></div>
      <div className="grid g4" style={{ margin: '18px 0' }}>{[['Prediction points', me.points], ['Correct calls', `${me.correct} / ${me.total}`], ['Streak', `${me.streak} (best ${me.bestStreak})`], ['Achievements', me.achievements.map((a) => a.label).join(', ') || '—']].map(([l, v]) => <div className="card" key={l as string} style={{ padding: 14 }}><span className="eyebrow">{l}</span><b>{v}</b></div>)}</div>
      <div className="card"><h2>Your data</h2><p className="dim">There is no server. Your profile, agents and proceedings are JSON documents in this browser. Download a backup to keep them or move them to another device.</p>
        <div className="row">
          <button className="btn primary" onClick={() => local.download(`interrogation-room-backup-${new Date().toISOString().slice(0, 10)}.json`, local.exportAll())}>Download backup (JSON)</button>
          <input ref={file} type="file" accept="application/json,.json" style={{ display: 'none' }} onChange={async (e) => { const f = e.target.files?.[0]; if (f) { try { setMsg(local.importFile(JSON.parse(await f.text()))); } catch (er: any) { setMsg(er.message); } } }} />
          <button className="btn" onClick={() => file.current?.click()}>Import backup or session</button>
          <button className="btn danger" onClick={() => confirm('Erase all your local data (agents, proceedings, keys, points)?') && local.resetAll()}>Erase everything</button>
        </div>
        {msg && <p className="amber" style={{ marginTop: 10 }}>{msg}</p>}
      </div>
      <div className="card" style={{ marginTop: 18 }}><h2>API keys</h2><p className="dim">Used only by your own agents, sent directly from this browser to the provider you chose, and never included in backups. Anyone with access to this browser profile could read them — use a key with a spending limit.</p>
        <table><tbody>{keys.map((c) => <tr key={c.id}><td><b>{c.label}</b><div className="faint">{c.provider} · …{c.last4} · added {ago(c.createdAt)}{c.rotatedAt ? ` · rotated ${ago(c.rotatedAt)}` : ''}</div></td><td style={{ width: 320 }}><div className="row" style={{ flexWrap: 'nowrap' }}><input type="password" autoComplete="off" placeholder="New key to rotate" value={rot[c.id] || ''} onChange={(e) => setRot({ ...rot, [c.id]: e.target.value })} /><button className="btn sm" disabled={(rot[c.id] || '').length < 8} onClick={() => { local.saveKey(c.provider, c.label, rot[c.id], c.id); setRot({}); }}>Rotate</button><button className="btn sm danger" onClick={() => confirm('Delete this key? Agents using it fall back to the house reasoner.') && local.deleteKey(c.id)}>Delete</button></div></td></tr>)}</tbody></table>
        {!keys.length && <p className="faint">No keys saved.</p>}
        <div style={{ maxWidth: 560 }}><KeyForm provider="anthropic" onSaved={() => {}} /></div>
      </div>
    </div>
  );
}
