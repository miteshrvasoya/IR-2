// The spectator theater: plays a case's public event stream through the 3D stage, live or as a replay.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, useAuth } from './api';
import { Stage } from './three/stage';
import { PHASES, PHASE_LABEL, SCENE_LABEL, DIM_LABEL, type SimEvent, type SceneId, type Phase } from '../../shared/types';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const ROLE: Record<string, string> = { detective: 'Detective', forensic: 'Forensic examiner', prosecutor: 'Prosecutor', defense: 'Defense counsel', judge: 'Judge', suspect: 'Person of interest', witness: 'Witness', juror: 'Juror' };
const KIND: Record<string, string> = { question: 'asks', answer: 'answers', objection: 'objects', ruling: 'rules', opening: 'opening statement', closing: 'closing argument', lab_report: 'lab report', report: 'investigation report', charge: 'charging decision', deliberation: 'in the jury room', testimony: 'testifies', motion: 'moves the court', instructions: 'jury instructions', sentence: 'sentence', warrant_request: 'warrant application' };
const LOGGED = new Set(['speech', 'narration', 'evidence', 'contradiction', 'verdict', 'evidence_status', 'lead', 'warrant', 'system', 'action', 'lab', 'case', 'reveal', 'admission', 'theory_shift', 'vote_change', 'joined']);

function Typed({ text, ms }: { text: string; ms: number }) {
  const [n, setN] = useState(0);
  useEffect(() => { setN(0); const step = Math.max(1, Math.ceil(text.length / Math.max(8, (ms * 0.55) / 28))); const t = setInterval(() => setN((x) => (x >= text.length ? (clearInterval(t), x) : x + step)), 28); return () => clearInterval(t); }, [text, ms]);
  return <>{text.slice(0, n)}</>;
}
export const Avatar = ({ look, size = 44 }: { look: any; size?: number }) => <span className="avatar" style={{ width: size, height: size, background: look?.accent || '#333', ['--skin' as any]: look?.skin || '#caa', ['--hair' as any]: look?.hair || '#222' }} />;

export function Theater({ id, detail, reload }: { id: string; detail: any; reload: () => void }) {
  const { me, ensureGuest, refresh } = useAuth();
  const host = useRef<HTMLDivElement>(null), stage = useRef<Stage | null>(null);
  const evs = useRef<SimEvent[]>([]), cur = useRef(0), gen = useRef(0), paused = useRef(false), rate = useRef(1);
  const finished = detail.state.status === 'finished', live = !finished;
  const [, setTick] = useState(0), bump = () => setTick((x) => x + 1);
  const [sub, setSub] = useState<{ e: SimEvent; narr: boolean } | null>(null);
  const [banner, setBanner] = useState<{ big: string; small?: string; tone: string; k: number } | null>(null);
  const [card, setCard] = useState<{ t: string; s: string } | null>(null);
  const [fade, setFade] = useState(0), [tab, setTab] = useState('log'), [open, setOpen] = useState(true), [sound, setSound] = useState(false), [free, setFree] = useState(false), [tour, setTour] = useState(''), [isPaused, setPaused] = useState(false), [speed, setSpeed] = useState(1), [showResult, setShowResult] = useState(false), [webgl, setWebgl] = useState(true), [mind, setMind] = useState<any>(null), [err, setErr] = useState(''), [openSeat, setOpenSeat] = useState('');
  const logEnd = useRef<HTMLDivElement>(null);

  const stageUi = (e: SimEvent) => {
    const d = e.data || {}, show = (big: string, tone: string, small?: string) => { const k = e.seq; setBanner({ big, small, tone, k }); setTimeout(() => setBanner((b) => (b?.k === k ? null : b)), Math.min(4200, Math.max(1800, (e.ms || 2500) * 0.8 / rate.current))); };
    if (e.type === 'phase') { setSub(null); setCard({ s: detail.case.title, t: PHASE_LABEL[d.phase as Phase] }); setTimeout(() => setCard(null), 2300 / rate.current); return; }
    if (e.type === 'speech') {
      setSub({ e, narr: false });
      if (e.kind === 'objection') show('Objection!', 'amber', String(d.ground || '').replace(/_/g, ' '));
      else if (e.kind === 'ruling' && d.sustained !== undefined) show(d.sustained ? 'Sustained' : 'Overruled', d.sustained ? 'green' : 'white');
      else if (e.kind === 'ruling' && d.granted !== undefined) show(d.motion ? (d.granted ? 'Motion granted' : 'Motion denied') : d.granted ? 'Warrant granted' : 'Warrant refused', d.granted ? 'green' : 'red');
      else if (e.kind === 'charge') show('Charged', 'red', `${detail.case.characters.find((c: any) => c.id === d.suspect)?.name} — ${d.charge}`);
      else if (e.kind === 'decline') show('No charges', 'white');
      else if (e.kind === 'plea') show(d.plea === 'guilty' ? 'Guilty plea' : 'Not guilty', 'white', 'plea entered');
      return;
    }
    if (e.text && e.ms) setSub({ e, narr: true });
    if (e.type === 'evidence') show('Evidence', 'amber', d.title);
    if (e.type === 'contradiction') show('Contradiction', 'red', e.text);
    if (e.type === 'admission') show('Account changed', 'white', e.text);
    if (e.type === 'evidence_status' && d.status !== 'admitted') show(d.status === 'suppressed' ? 'Suppressed' : 'Excluded', 'red', e.text);
    if (e.type === 'verdict') show(d.kind === 'convicted' ? 'Guilty' : d.kind === 'acquitted' ? 'Not guilty' : 'Hung jury', d.kind === 'convicted' ? 'red' : d.kind === 'acquitted' ? 'green' : 'white', e.text);
    if (e.type === 'reveal') { show('The truth', 'amber', `${d.culpritName} was responsible.`); setTimeout(() => { setShowResult(true); }, 5000 / rate.current); }
    if (e.type === 'closed') reload();
  };

  // ---- boot: stage, history, live stream, playback loop ----
  useEffect(() => {
    let alive = true, es: EventSource | null = null, st: Stage;
    try { st = new Stage(host.current!); } catch { setWebgl(false); st = null as any; }
    stage.current = st; if (st) { st.onFade = setFade; st.setCast(detail.state.seats, detail.state.defendant); }
    (async () => {
      const list: SimEvent[] = await api(`/sessions/${id}/events?after=0`);
      if (!alive) return;
      evs.current = list;
      const t = Number(new URLSearchParams(location.search).get('t') || 0);
      const startAt = finished ? (t ? Math.max(0, list.findIndex((e) => e.seq >= t)) : 0) : list.length;
      for (let i = 0; i < startAt; i++) st?.apply(list[i], true);
      cur.current = startAt; bump();
      if (live) {
        es = new EventSource(`/api/sessions/${id}/stream?after=${list.length ? list[list.length - 1].seq : 0}`);
        es.onmessage = (m) => { const e = JSON.parse(m.data) as SimEvent; if (!evs.current.length || e.seq > evs.current[evs.current.length - 1].seq) evs.current.push(e); };
      }
      while (alive) {
        if (paused.current || cur.current >= evs.current.length) { await sleep(100); continue; }
        const g = gen.current, e = evs.current[cur.current++], backlog = evs.current.length - cur.current;
        const instant = live && backlog > 45;
        st?.apply(e, instant); if (!instant) stageUi(e); bump();
        let hold = (e.ms || 0) / rate.current; if (live && backlog > 8) hold /= 3;
        if (!instant && hold > 0) { const end = Date.now() + hold; while (alive && Date.now() < end && gen.current === g && !(paused.current && !live)) await sleep(60); }
      }
    })().catch((e) => setErr(e.message));
    return () => { alive = false; es?.close(); st?.dispose(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, finished]);
  useEffect(() => { stage.current?.setCast(detail.state.seats, detail.state.defendant); }, [detail]);
  useEffect(() => { stage.current?.setInset(open ? 384 : 0); }, [open]);
  useEffect(() => { if (!live) return; const t = setInterval(reload, 7000); return () => clearInterval(t); }, [live, reload]);

  const seek = (i: number) => { gen.current++; const st = stage.current; st?.reset(); for (let k = 0; k < i; k++) st?.apply(evs.current[k], true); cur.current = i; setSub(null); setBanner(null); setShowResult(false); bump(); };

  // ---- everything the panels show is derived from events up to the playhead, so replays never spoil ----
  const seen = evs.current.slice(0, cur.current), n = seen.length;
  const view = useMemo(() => {
    let phase: Phase = 'lobby', scene: SceneId = 'office', defendant: string | null = null;
    const found: string[] = [], status: Record<string, string> = {}, analyses = new Set<string>(), scores: Record<string, { total: number; entries: any[] }> = {}, caught: Record<string, number> = {};
    let reveal: any = null, awards: any = null;
    for (const e of seen) {
      const d = e.data || {};
      if (e.type === 'phase') phase = d.phase; if (e.type === 'scene') scene = d.scene;
      if (e.type === 'evidence') { found.push(d.id); status[d.id] = 'collected'; }
      if (e.type === 'evidence_status') status[d.id] = d.status;
      if (e.type === 'speech' && e.kind === 'offer') status[d.evidenceId] = 'offered';
      if (e.type === 'speech' && e.kind === 'lab_report') analyses.add(d.analysisId);
      if (e.type === 'speech' && e.kind === 'charge') defendant = d.suspect;
      if (e.type === 'score' && e.actor) { const s = (scores[e.actor.seatId] ||= { total: 0, entries: [] }); s.total += d.delta; s.entries.push(d); }
      if (e.type === 'contradiction') caught[d.char] = (caught[d.char] || 0) + 1;
      if (e.type === 'reveal') reveal = { ...d, summary: e.text }; if (e.type === 'awards') awards = d;
    }
    return { phase, scene, defendant, found, status, analyses, scores, caught, reveal, awards, log: seen.filter((e) => LOGGED.has(e.type) && e.text) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [n]);
  useEffect(() => { const el = logEnd.current?.parentElement; if (tab === 'log' && el) el.scrollTop = el.scrollHeight; }, [n, tab]);

  const seats: any[] = detail.state.seats, seatOf = (sid: string) => seats.find((s) => s.id === sid);
  const act = async (fn: () => Promise<any>) => { try { setErr(''); await fn(); reload(); } catch (e: any) { setErr(e.message); } };
  const predict = (marketId: string, choice: string) => act(async () => { await ensureGuest(); await api(`/sessions/${id}/predict`, { marketId, choice }); });
  const flagSus = (seq: number) => act(async () => { await ensureGuest(); await api(`/sessions/${id}/sus`, { seq }); });
  const phaseIdx = PHASES.indexOf(view.phase), marks = finished ? evs.current.map((e, i) => ({ e, i })).filter((x) => x.e.highlight && ['contradiction', 'verdict', 'charge', 'evidence', 'objection', 'reveal', 'suppressed'].includes(x.e.highlight)) : [];
  const share = () => { const u = `${location.origin}/case/${id}?t=${evs.current[Math.max(0, cur.current - 1)]?.seq || 0}`; navigator.clipboard?.writeText(u); setErr('Link to this moment copied.'); setTimeout(() => setErr(''), 2500); };

  return (
    <div className="theater">
      <div className="stagehost" ref={host} />
      {!webgl && <div className="titlecard" style={{ pointerEvents: 'auto' }}><div><div className="s">3D unavailable</div><p className="dim">Your browser could not start WebGL. The full transcript, evidence and predictions still work in the panel.</p></div></div>}
      <div className="fade" style={{ opacity: fade }} />
      <div className="letter t" /><div className="letter b" />
      <div className="hud-top">
        <Link to="/cases" className="btn sm ghost">← Cases</Link>
        <h3>{detail.case.title}</h3>
        <span className={`tag ${live ? 'live' : 'amber'}`}>{live ? (detail.state.status === 'paused' ? 'Paused' : '● Live') : 'Replay'}</span>
        <div className="steps" title={PHASE_LABEL[view.phase]}>{PHASES.slice(1, -1).map((p, i) => <i key={p} className={i + 1 < phaseIdx ? 'done' : i + 1 === phaseIdx ? 'cur' : ''} />)}</div>
        <span className="tag">{PHASE_LABEL[view.phase]}</span><span className="tag blue">{SCENE_LABEL[(tour as SceneId) || view.scene]}</span>
        <span style={{ flex: 1 }} />
        {live && <span className="faint mono">{detail.watchers} watching · {detail.state.hoursLeft}h of inquiry left</span>}
        <button className="btn sm" onClick={() => setOpen(!open)}>{open ? 'Hide panel' : 'Show panel'}</button>
      </div>

      {card && <div className="titlecard"><div><div className="s">{card.s}</div><div className="t">{card.t}</div></div></div>}
      {banner && <div className={`banner ${banner.tone}`} key={banner.k}><div className="big">{banner.big}</div>{banner.small && <div className="small">{banner.small}</div>}</div>}
      {sub && !card && (
        <div className="subtitle" style={open ? undefined : { width: 'min(980px, 92vw)' }}>
          {!sub.narr && sub.e.actor && <div className="who"><b>{sub.e.actor.name}</b><em>{ROLE[sub.e.actor.role]}{KIND[sub.e.kind || ''] ? ` · ${KIND[sub.e.kind!]}` : ''}</em></div>}
          <div><span className={`line ${sub.narr ? 'narr' : ''}`}><Typed text={sub.e.text!.length > (sub.narr ? 230 : 440) ? sub.e.text!.slice(0, sub.narr ? 230 : 440).replace(/\s+\S*$/, '') + '…' : sub.e.text!} ms={(sub.e.ms || 3000) / speed} /></span></div>
        </div>
      )}

      <div className="controls">
        <button className="btn" onClick={() => { const v = !sound; setSound(v); stage.current?.sound.enable(v); }}>{sound ? '🔊 Sound on' : '🔇 Sound off'}</button>
        <button className="btn" onClick={() => { const v = !free; setFree(v); stage.current?.setFree(v); }}>{free ? '🎥 Free camera' : '🎬 Director'}</button>
        <select value={tour} onChange={(e) => { setTour(e.target.value); stage.current?.visit((e.target.value || null) as any); setFree(!!e.target.value); }}>
          <option value="">Follow the action</option>
          {Object.entries(SCENE_LABEL).map(([k, v]) => <option key={k} value={k}>Visit: {v}</option>)}
        </select>
        {finished && <>
          <button className="btn" onClick={() => { paused.current = !paused.current; setPaused(paused.current); }}>{isPaused ? '▶ Play' : '❚❚ Pause'}</button>
          <select value={speed} onChange={(e) => { rate.current = Number(e.target.value); setSpeed(rate.current); }}>{[0.5, 1, 2, 4, 8].map((s) => <option key={s} value={s}>{s}×</option>)}</select>
          <button className="btn" onClick={share}>Share this moment</button>
          <button className="btn" onClick={() => setShowResult(!showResult)}>{showResult ? 'Hide' : 'Show'} case file</button>
        </>}
        {live && detail.isHost && <button className="btn" onClick={() => act(() => api(`/sessions/${id}/control`, { action: detail.state.status === 'paused' ? 'resume' : 'pause' }))}>{detail.state.status === 'paused' ? 'Resume case' : 'Pause case'}</button>}
        {err && <span className="tag amber">{err}</span>}
      </div>
      {finished && (
        <div className="scrub">
          <div className="marks">{marks.map((m) => <i key={m.i} className={m.e.highlight === 'contradiction' || m.e.highlight === 'verdict' ? 'red' : ''} style={{ left: `${(m.i / Math.max(1, evs.current.length)) * 100}%` }} title={m.e.text} />)}</div>
          <input type="range" min={0} max={evs.current.length} value={cur.current} onChange={(e) => seek(Number(e.target.value))} />
        </div>
      )}

      {showResult && view.reveal && <ResultPanel detail={detail} reveal={view.reveal} awards={view.awards} seats={seats} onClose={() => setShowResult(false)} me={me} />}

      <div className={`drawer ${open ? '' : 'closed'}`}>
        <div className="tabs">{[['log', 'Case log'], ['evidence', `Evidence ${view.found.length}`], ['cast', 'Cast'], ['predict', 'Predict']].map(([k, l]) => <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>)}</div>
        <div className="body">
          {tab === 'log' && <>
            {view.log.slice(-160).map((e) => (
              <div key={e.seq} className={`logline ${e.type !== 'speech' ? 'sys' : ''} ${e.highlight ? 'hl' : ''} ${e.type === 'contradiction' || e.highlight === 'suppressed' ? 'bad' : ''}`}>
                {e.type === 'speech' && e.actor && <div className="n">{e.actor.name}<em>{KIND[e.kind || ''] || ROLE[e.actor.role]}</em>{live && <button className="sus" title="Flag as suspicious" onClick={() => flagSus(e.seq)}>sus {detail.sus[e.seq] || ''}</button>}</div>}
                {e.type === 'evidence' ? <><b className="amber">Evidence recovered · </b>{e.text}</> : e.text}
              </div>
            ))}
            <div ref={logEnd} />
          </>}
          {tab === 'evidence' && (view.found.length ? view.found.map((eid) => {
            const ev = detail.evidence.find((x: any) => x.id === eid); if (!ev) return null; const st = view.status[eid];
            return (
              <div className="ev" key={eid}>
                <div className="row between"><h4>{ev.title}</h4><span className={`tag ${st === 'admitted' ? 'green' : st === 'suppressed' || st === 'excluded' ? 'live' : 'amber'}`}>{st}</span></div>
                <div className="meta">{eid} · {ev.type} · {ev.source}{ev.warrantless ? ' · NO WARRANT' : ''}</div>
                <p style={{ margin: '6px 0' }}>{ev.description}</p>
                {ev.analyses.filter((a: any) => view.analyses.has(a.id)).map((a: any) => <p key={a.id} style={{ margin: '6px 0' }}><b className="blue" style={{ color: 'var(--blue)' }}>Lab — {a.label}: </b>{a.report}</p>)}
                {ev.points.length > 0 && <><div className="eyebrow" style={{ margin: '8px 0 2px' }}>What it appears to show</div><ul>{ev.points.filter((p: any) => !p.via || view.analyses.has(p.via)).map((p: any, i: number) => <li key={i}><b>{detail.case.characters.find((c: any) => c.id === p.suspect)?.name}</b> — {p.exculpatory ? 'in their favour' : p.element} ({p.strength}): {p.note}</li>)}</ul></>}
                {ev.limitations.length > 0 && <><div className="eyebrow" style={{ margin: '8px 0 2px', color: 'var(--dim)' }}>Weaknesses</div><ul className="dim">{ev.limitations.filter((l: any) => !l.via || view.analyses.has(l.via)).map((l: any) => <li key={l.id}>{l.text}</li>)}</ul></>}
                <details><summary className="faint">Chain of custody ({ev.custody.length})</summary><ul className="faint">{ev.custody.map((c: any, i: number) => <li key={i}>{c.action} — {c.by}{c.note ? ` (${c.note})` : ''}</li>)}</ul></details>
              </div>
            );
          }) : <p className="dim">Nothing has been recovered yet.</p>)}
          {tab === 'cast' && <>
            <p className="faint">Scores are the Master Referee's running assessment. Each entry names what was done and why it counted; truth-dependent entries stay sealed until the reveal.</p>
            {seats.map((s) => { const sc = view.scores[s.id]; return (
              <div key={s.id} style={{ marginBottom: 8 }}>
                <div className={`seat ${detail.mySeats.includes(s.id) ? 'mine' : ''}`} style={{ cursor: 'pointer' }} onClick={() => setOpenSeat(openSeat === s.id ? '' : s.id)}>
                  <Avatar look={s.look} size={36} />
                  <div className="who"><b>{s.name}{view.defendant === s.id ? ' · DEFENDANT' : ''}</b><span className="faint">{ROLE[s.role]}{s.characterId ? ` · played by ${s.agentName}` : ''}{s.llm ? ' · LLM' : ''}{view.caught[s.id] ? ` · caught ×${view.caught[s.id]}` : ''}</span></div>
                  <b className={sc && sc.total < 0 ? 'red' : 'amber'}>{sc ? (sc.total > 0 ? '+' : '') + sc.total : '·'}</b>
                </div>
                {openSeat === s.id && <div style={{ padding: '6px 10px' }}>
                  {(sc?.entries || []).map((x: any, i: number) => <div key={i} className="faint"><b className={x.delta < 0 ? 'red' : 'green'}>{x.delta > 0 ? '+' : ''}{x.delta}</b> {DIM_LABEL[x.dim]} — {x.reason}{x.wasSealed ? ' (sealed until reveal)' : ''}</div>)}
                  {detail.mySeats.includes(s.id) && <button className="btn sm" style={{ marginTop: 6 }} onClick={() => api(`/sessions/${id}/mind/${s.id}`).then(setMind).catch((e) => setErr(e.message))}>Read my agent's private mind</button>}
                  {detail.mySeats.includes(s.id) && live && <button className="btn sm" style={{ margin: '6px 0 0 6px' }} onClick={() => act(() => api(`/sessions/${id}/reconnect`, { seatId: s.id }))}>Reconnect model</button>}
                  {live && s.house && me && !me.guest && <JoinLate id={id} seatId={s.id} reload={reload} setErr={setErr} />}
                </div>}
              </div>
            ); })}
          </>}
          {tab === 'predict' && <>
            <p className="faint">Virtual points only. Calls made before the charging decision pay 1.5×. {me ? <>You have <b className="amber">{me.points}</b> points.</> : 'Pick an option to start as a guest.'}{!detail.canPredict && me ? ' Participants cannot bet on their own case.' : ''}</p>
            {detail.markets.map((m: any) => { const mine = detail.myPredictions.find((p: any) => p.marketId === m.id); const total = Object.values(m.picks as Record<string, number>).reduce((a, b) => a + b, 0) || 1; return (
              <div className="ev" key={m.id}>
                <div className="row between"><h4>{m.question}</h4><span className={`tag ${m.status === 'open' ? 'green' : ''}`}>{m.status === 'open' ? `${m.points} pts` : m.status}</span></div>
                {m.options.map((o: any) => (
                  <button key={o.id} disabled={m.status !== 'open' || (!!me && !detail.canPredict)} onClick={() => predict(m.id, o.id)} className="btn sm" style={{ display: 'block', width: '100%', textAlign: 'left', marginTop: 6, textTransform: 'none', letterSpacing: 0, fontSize: 13, borderColor: mine?.choice === o.id ? 'var(--amber)' : m.answer === o.id ? 'var(--green)' : undefined, background: `linear-gradient(90deg, rgba(224,168,74,.16) ${(m.picks[o.id] / total) * 100}%, transparent 0)` }}>
                    {o.label}{mine?.choice === o.id ? ' · your call' : ''}{m.answer === o.id ? ' ✓' : ''}<span style={{ float: 'right' }} className="faint">{m.picks[o.id]}</span>
                  </button>
                ))}
                {mine?.won !== undefined && <div className={mine.won ? 'green' : 'red'} style={{ marginTop: 6 }}>{mine.won ? `Correct — +${mine.awarded} points` : 'Wrong call'}</div>}
              </div>
            ); })}
            {!detail.markets.length && <p className="dim">Markets open when the case starts.</p>}
          </>}
        </div>
      </div>
      {mind && <div className="modal" onClick={() => setMind(null)}><div className="card" onClick={(e) => e.stopPropagation()}><span className="eyebrow">Private — only you can see this</span><h2>Your agent's mind</h2>{mind.memory.theory && <p><b>Working theory:</b> {mind.memory.theory.summary} <span className="faint">(confidence {Math.round(mind.memory.theory.confidence * 100)}%)</span></p>}<h3>Recent reasoning</h3>{mind.thoughts.slice(-14).map((t: any) => <div className="logline" key={t.seq}><span className="faint mono">{t.phase}</span> {t.text}</div>)}<h3 style={{ marginTop: 14 }}>Memory notes</h3>{mind.memory.notes.slice(-12).map((x: string, i: number) => <div className="faint" key={i}>• {x}</div>)}<button className="btn" style={{ marginTop: 14 }} onClick={() => { setMind(null); refresh(); }}>Close</button></div></div>}
    </div>
  );
}

function JoinLate({ id, seatId, reload, setErr }: any) {
  const [agents, setAgents] = useState<any[] | null>(null);
  if (!agents) return <button className="btn sm" style={{ marginTop: 6 }} onClick={() => api('/agents').then((a) => setAgents(a.filter((x: any) => x.mine)))}>Take this seat (late join)</button>;
  return <div className="row" style={{ marginTop: 6 }}>{agents.length ? agents.map((a) => <button key={a.id} className="btn sm" onClick={() => api(`/sessions/${id}/join`, { seatId, agentId: a.id }).then(reload).catch((e) => setErr(e.message))}>{a.name}</button>) : <span className="faint">Create an agent first.</span>}</div>;
}

function ResultPanel({ detail, reveal, awards, seats, onClose, me }: any) {
  const r = detail.result, o = reveal.outcome, totals = r?.totals || {};
  const ranked = seats.map((s: any) => ({ s, t: totals[s.id]?.total ?? 0 })).sort((a: any, b: any) => b.t - a.t);
  const mine = detail.myPredictions || [];
  return (
    <div className="result">
      <div className="row between"><span className="eyebrow">Case file — unsealed</span><button className="btn sm" onClick={onClose}>Close</button></div>
      <h2>{o.text}</h2>
      <p className={reveal.justice ? 'green' : 'red'} style={{ font: '17px var(--serif)' }}>{reveal.justice ? 'Justice was done.' : o.kind === 'convicted' ? 'An innocent person was convicted.' : 'The person responsible walked free.'}</p>
      <h3 className="amber">What actually happened</h3>
      <p style={{ font: '16px/1.6 var(--serif)' }}>{reveal.summary}</p>
      <p><b>Responsible:</b> {reveal.culpritName}. <b>Motive:</b> {reveal.motive} <b>Method:</b> {reveal.method}</p>
      <div className="grid g2">
        <div><h3>Timeline</h3><div className="timeline">{reveal.timeline.map((t: any, i: number) => <div key={i}><b>{t.time}</b>{t.what}</div>)}</div></div>
        <div>
          <h3>What misled</h3>{reveal.misleading.map((m: any, i: number) => <p key={i}><b>{m.what}.</b> <span className="dim">{m.why}</span></p>)}
          <h3>Unreliable witnesses</h3>{reveal.unreliable.map((m: any, i: number) => <p key={i}><b>{m.name}.</b> <span className="dim">{m.why}</span></p>)}
          <p className="amber" style={{ font: 'italic 16px var(--serif)' }}>{reveal.twist}</p>
        </div>
      </div>
      {awards && <>
        <h3 className="amber" style={{ marginTop: 18 }}>The Referee's awards</h3>
        <div className="grid g3">{awards.awards.map((a: any) => <div className="card" key={a.id} style={{ padding: 14 }}><span className="eyebrow">{a.label}</span><b>{a.name || ''}</b><div className="dim">{a.reason}</div></div>)}</div>
        <h3 style={{ marginTop: 18 }}>By the numbers</h3>
        <table><tbody>{awards.stats.map((s: any) => <tr key={s.label}><td className="dim">{s.label}</td><td><b>{s.value}</b></td></tr>)}</tbody></table>
      </>}
      {r && <><h3 style={{ marginTop: 18 }}>Final standings</h3><table><thead><tr><th>Agent</th><th>Role</th><th>Score</th><th>Breakdown</th></tr></thead><tbody>{ranked.map(({ s, t }: any) => <tr key={s.id}><td><b>{s.agentName}</b>{s.characterId ? <span className="faint"> as {s.name}</span> : ''}</td><td className="dim">{ROLE[s.role]}</td><td><b className={t < 0 ? 'red' : 'amber'}>{t}</b></td><td className="faint">{Object.entries(totals[s.id]?.dims || {}).map(([k, v]: any) => `${DIM_LABEL[k].split(' ')[0]} ${v > 0 ? '+' : ''}${v}`).join(' · ')}</td></tr>)}</tbody></table></>}
      {mine.length > 0 && <><h3 style={{ marginTop: 18 }}>Your predictions</h3>{mine.map((p: any) => { const m = detail.markets.find((x: any) => x.id === p.marketId); return <div key={p.marketId} className={p.won ? 'green' : 'red'}>{p.won ? '✓' : '✗'} {m?.question} — you said {m?.options.find((x: any) => x.id === p.choice)?.label}{p.won ? ` (+${p.awarded})` : ''}</div>; })}{me && <p className="dim" style={{ marginTop: 8 }}>Balance: {me.points} points.</p>}</>}
    </div>
  );
}
