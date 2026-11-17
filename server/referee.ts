// The Master Referee's end-of-case work and the audience prediction markets.
// (In-case scoring happens at the point each action is validated, in engine.ts, through sim.score: every
// entry names one dimension and a plain-language reason. Nothing here or there rewards volume of speech.)
import type { Sim } from './sim.ts';
import type { Market, Phase } from '../shared/types.ts';
import { PHASES } from '../shared/types.ts';
import { writeJson } from './store.ts';
import { getAgent, updateAgent, updateUser } from './accounts.ts';

const idx = (p: Phase) => PHASES.indexOf(p);

// ---------- prediction markets (virtual points only) ----------
export function openMarkets(sim: Sim) {
  const sus = Object.values(sim.b.characters).filter((c) => c.kind === 'suspect').map((c) => ({ id: c.id, label: c.name }));
  const all = Object.values(sim.b.characters).map((c) => ({ id: c.id, label: c.name }));
  const pros = ['detective', 'forensic', 'prosecutor', 'defense', 'judge'].map((s) => ({ id: s, label: `${sim.nameOf(s)} (${sim.role(s)})` }));
  const m = (id: string, question: string, options: Market['options'], closesAtPhase: Phase, points: number): Market => ({ id, question, options, closesAtPhase, points, status: 'open' });
  sim.preds.markets = [
    m('culprit', 'Who is actually responsible for the death?', sus, 'pretrial', 150),
    m('charged', 'Who will the prosecutor charge?', [...sus, { id: 'nobody', label: 'Nobody' }], 'charging', 100),
    m('caught', 'Who will be caught in the most contradictions?', [...all, { id: 'nobody', label: 'Nobody' }], 'pretrial', 80),
    m('suppressed', 'Will any evidence be suppressed or excluded?', [{ id: 'yes', label: 'Yes' }, { id: 'no', label: 'No' }], 'opening', 60),
    m('outcome', 'How will the case end?', [{ id: 'convicted', label: 'Conviction' }, { id: 'acquitted', label: 'Acquittal' }, { id: 'hung', label: 'Hung jury' }, { id: 'no_trial', label: 'No trial' }], 'closing', 120),
    m('mvp', 'Which professional will the Referee score highest?', pros, 'closing', 100),
  ];
  sim.emit('markets', { data: { markets: sim.preds.markets.map((x) => x.id) }, ms: 0 });
}
export function closeMarkets(sim: Sim) {
  for (const m of sim.preds.markets) if (m.status === 'open' && idx(sim.st.phase) >= idx(m.closesAtPhase)) m.status = 'closed';
}

function totals(sim: Sim) {
  const t: Record<string, { total: number; dims: Record<string, number> }> = {};
  for (const s of sim.b.def.seats) t[s.id] = { total: 0, dims: {} };
  for (const e of sim.scores) { t[e.seatId].total += e.delta; t[e.seatId].dims[e.dim] = (t[e.seatId].dims[e.dim] || 0) + e.delta; }
  return t;
}

/** Close the case: outcome-dependent scoring, the reveal, awards, statistics, and market settlement. */
export function finalize(sim: Sim) {
  const st = sim.st, T = sim.b.truth, culprit = T.culprit, o = (st.outcome ||= { kind: 'no_charges', defendant: null, correct: null, text: 'No charges were brought.' });
  o.correct = o.kind === 'convicted' || o.kind === 'plea' ? st.defendant === culprit : o.kind === 'no_charges' ? false : st.defendant !== culprit;
  const speech = sim.events.filter((e) => e.type === 'speech');

  // --- outcome-dependent scoring (kept separate from in-case performance; all sealed until now) ---
  for (const j of sim.seatsOf('juror')) {
    const v = st.trial.votes[j]; if (!v) continue;
    sim.score(v === 'guilty' ? 'prosecutor' : 'defense', 'persuasion', 2, `Carried ${sim.nameOf(j)}'s vote`);
    sim.score(j, 'accuracy', (v === 'guilty') === (st.defendant === culprit) ? 4 : -4, (v === 'guilty') === (st.defendant === culprit) ? 'Voted in line with what actually happened' : 'Voted against what actually happened', true);
  }
  if (st.defendant) sim.score('defense', 'accuracy', st.defendant !== culprit && o.kind !== 'convicted' ? 5 : st.defendant !== culprit ? -2 : 0, st.defendant !== culprit ? (o.kind !== 'convicted' ? 'Kept an innocent client from conviction' : 'An innocent client was convicted') : 'Represented a guilty client', true);
  for (const c of Object.values(sim.b.characters)) {
    const rtc = st.chars[c.id];
    if (!rtc.caught.length && rtc.interviews + (rtc.sworn ? 1 : 0) > 0) sim.score(c.id, 'credibility', 3, 'Never caught in a contradiction');
    if (c.id === culprit && !(st.defendant === c.id && (o.kind === 'convicted' || o.kind === 'plea'))) sim.score(c.id, 'persuasion', 6, 'Walked free', true);
    if (c.kind === 'suspect' && c.id !== culprit && st.defendant !== c.id) sim.score(c.id, 'persuasion', 2, 'Cleared without being charged', true);
  }

  // --- the reveal ---
  sim.emit('reveal', {
    text: T.summary, highlight: 'reveal', ms: 14000,
    data: { culprit, culpritName: sim.charName(culprit), motive: T.motive, method: T.method, timeline: T.timeline, misleading: T.misleading, unreliable: T.unreliable.map((u) => ({ ...u, name: sim.charName(u.who) })), twist: T.twist, outcome: o, justice: o.correct },
  });

  // --- awards & statistics ---
  const tot = totals(sim), by = (f: (s: string) => number, seats = Object.keys(tot)) => seats.map((s) => [s, f(s)] as const).sort((a, b) => b[1] - a[1])[0];
  const awards: { id: string; label: string; seat?: string; name?: string; reason: string }[] = [];
  const give = (id: string, label: string, seat: string | undefined, reason: string) => awards.push({ id, label, seat, name: seat ? sim.nameOf(seat) : undefined, reason });
  const mvp = by((s) => tot[s].total); give('mvp', 'Most Valuable Agent', mvp[0], `Highest Referee score of the case (${mvp[1]}).`);
  const sharp = by((s) => tot[s].dims.reasoning || 0); if (sharp[1] > 0) give('sharpest', 'Sharpest Mind', sharp[0], `${sharp[1]} points of pure reasoning.`);
  give(tot.detective.total >= 15 ? 'best_detective' : 'lost_detective', tot.detective.total >= 15 ? 'Best Detective' : 'Most Lost Detective', 'detective', `${sim.discovered().length} of ${Object.keys(sim.b.evidence).length} exhibits found, ${st.hoursLeft}h unused, recommended ${sim.charName(st.report?.recommended)}.`);
  const manip = by((c) => st.chars[c].denied.length - st.chars[c].caught.length, Object.keys(st.chars)); if (manip[1] > 0) give('manipulator', 'Master Manipulator', manip[0], `Kept ${manip[1]} false account(s) standing to the very end.`);
  const worst = by((c) => st.chars[c].caught.length, Object.keys(st.chars)); if (worst[1] > 0) give('worst_witness', 'Worst Witness', worst[0], `Caught in ${worst[1]} contradiction(s).`);
  const drama = (s: string) => speech.filter((e) => e.actor?.seatId === s).reduce((n, e) => n + (e.text!.match(/[!—]/g)?.length || 0) + (['opening', 'closing', 'objection'].includes(e.kind || '') ? e.text!.length / 120 : 0), 0) * (0.5 + (sim.agents[s]?.traits.drama || 0));
  if (st.defendant) { const d = by(drama, ['prosecutor', 'defense']); give('dramatic', 'Most Dramatic Lawyer', d[0], 'For services to theatre in a court of law.'); }
  const objs = (s: string) => speech.filter((e) => e.kind === 'objection' && e.actor?.seatId === s).length;
  const om = by(objs, ['prosecutor', 'defense']); if (om[1] > 1) give('objection_machine', 'Objection Machine', om[0], `${om[1]} objections.`);
  if (speech.some((e) => e.kind === 'ruling')) give((tot.judge.dims.procedure || 0) >= 0 ? 'iron_gavel' : 'wobbly_gavel', (tot.judge.dims.procedure || 0) >= 0 ? 'Iron Gavel' : 'Wobbly Gavel', 'judge', (tot.judge.dims.procedure || 0) >= 0 ? 'Every ruling held up.' : 'Some rulings will not survive appeal.');
  if (o.kind === 'hung') { const votes = st.trial.votes, g = Object.values(votes).filter((v) => v === 'guilty').length, lone = Object.keys(votes).find((j) => (votes[j] === 'guilty') === (g === 1)); if (lone && (g === 1 || g === Object.keys(votes).length - 1)) give('holdout', 'Lone Holdout', lone, 'One juror against the room.'); }
  const susTop = Object.entries(sim.preds.sus).sort((a, b) => b[1].length - a[1].length)[0];
  if (susTop && susTop[1].length) { const e = sim.events.find((x) => x.seq === Number(susTop[0])); if (e?.actor) give('sus', 'Most Suspicious Statement (audience)', e.actor.seatId, `"${e.text!.slice(0, 140)}" — flagged by ${susTop[1].length} spectator(s).`); }
  const twist = st.defendant && st.defendant !== culprit && o.kind === 'convicted' ? `An innocent person, ${sim.charName(st.defendant)}, was convicted while ${sim.charName(culprit)} watched.`
    : st.report && st.defendant && st.report.recommended !== st.defendant ? `The prosecutor overruled the detective and charged ${sim.charName(st.defendant)} instead of ${sim.charName(st.report.recommended)}.`
    : !st.chars[culprit].interviews ? `Nobody ever interviewed ${sim.charName(culprit)}.`
    : o.kind === 'no_charges' ? `Everyone went home. So did ${sim.charName(culprit)}.` : T.twist;
  give('twist', 'Biggest Plot Twist', undefined, twist);

  const words = (s: string) => speech.filter((e) => e.actor?.seatId === s).reduce((n, e) => n + e.text!.split(/\s+/).length, 0);
  const talk = by(words), longest = speech.slice().sort((a, b) => b.text!.length - a.text!.length)[0];
  const rulings = speech.filter((e) => e.kind === 'ruling' && e.data?.sustained !== undefined);
  const stats = [
    { label: 'Words spoken on the record', value: speech.reduce((n, e) => n + e.text!.split(/\s+/).length, 0) },
    { label: 'Most talkative', value: `${sim.nameOf(talk[0])} (${talk[1]} words)` },
    { label: 'Questions asked', value: speech.filter((e) => e.kind === 'question').length },
    { label: 'False accounts given', value: Object.values(st.chars).reduce((n, c) => n + c.denied.length + c.caught.length - c.denied.filter((d) => c.caught.includes(d)).length, 0) },
    { label: 'Lies exposed', value: Object.values(st.chars).reduce((n, c) => n + c.caught.length, 0) },
    { label: 'Objections (sustained)', value: `${speech.filter((e) => e.kind === 'objection').length} (${rulings.filter((e) => e.data.sustained).length})` },
    { label: 'Exhibits kept from the jury', value: Object.values(sim.ev).filter((e) => e.status === 'suppressed' || e.status === 'excluded').length },
    { label: 'Investigative hours left unused', value: st.hoursLeft },
    { label: 'Longest single speech', value: longest ? `${longest.actor?.name}, ${longest.text!.split(/\s+/).length} words` : '—' },
    { label: 'Times a theory was revised', value: sim.events.filter((e) => e.type === 'theory_shift').length },
  ];
  sim.emit('awards', { data: { awards, stats }, text: 'The Referee\'s awards', ms: 9000, highlight: 'awards' });

  // --- settle markets ---
  const caughtTop = by((c) => st.chars[c].caught.length, Object.keys(st.chars));
  const mvpPro = by((s) => totals(sim)[s].total, ['detective', 'forensic', 'prosecutor', 'defense', 'judge']);
  const answers: Record<string, string> = {
    culprit, charged: st.defendant || 'nobody', caught: caughtTop[1] > 0 ? caughtTop[0] : 'nobody',
    suppressed: Object.values(sim.ev).some((e) => e.status === 'suppressed' || e.status === 'excluded') ? 'yes' : 'no',
    outcome: o.kind === 'plea' ? 'convicted' : o.kind === 'no_charges' ? 'no_trial' : o.kind, mvp: mvpPro[0],
  };
  for (const m of sim.preds.markets) { m.answer = answers[m.id] ?? null; m.status = 'settled'; }
  for (const p of sim.preds.entries) {
    const m = sim.preds.markets.find((x) => x.id === p.marketId)!;
    p.won = p.choice === m.answer;
    p.awarded = p.won ? Math.round(m.points * (idx(p.phase) <= idx('investigation') ? 1.5 : 1)) : 0;
  }
  sim.preds.settled = true;

  const final = totals(sim);
  (st as any).result = { awards, stats, answers, totals: final };
  sim.emit('closed', { text: 'Case closed.', data: { totals: final }, ms: 3000 });
  st.phase = 'closed'; st.status = 'finished'; st.finishedAt = new Date().toISOString(); st.queue = [];
}

/** Write the durable consequences of a finished case: result.json, agent careers, spectator points. Idempotent. */
export async function commitResults(sim: Sim) {
  const st = sim.st as any;
  if (st.status !== 'finished' || st.committed) return;
  const res = st.result, o = st.outcome, culprit = sim.b.truth.culprit, now = new Date().toISOString();
  await writeJson(sim.dir('result.json'), { sessionId: sim.id, caseId: st.caseId, title: st.title, finishedAt: st.finishedAt, outcome: o, defendant: st.defendant, charge: st.charge, truth: sim.b.truth, ...res, scores: sim.scores, predictions: sim.preds });
  const count = (seat: string, re: RegExp) => sim.scores.filter((e) => e.seatId === seat && re.test(e.reason)).length;
  for (const d of sim.b.def.seats) {
    const seat = st.seats[d.id]; if (!seat.agentId || !(await getAgent(seat.agentId))) continue;
    const t = res.totals[d.id], mine = res.awards.filter((a: any) => a.seat === d.id);
    const won = d.role === 'prosecutor' ? (o.kind === 'convicted' || o.kind === 'plea') : d.role === 'defense' ? (st.defendant ? o.kind === 'acquitted' || o.kind === 'hung' : null) : d.role === 'detective' ? st.report?.recommended === culprit : null;
    await updateAgent(seat.agentId, (a) => {
      const s = a.stats; s.cases++; s.xp += 20 + Math.max(0, t.total) * 2;
      s.rating = Math.round(s.rating + Math.max(-40, Math.min(40, (t.total - 6) * 1.5)));
      if (won === true) s.wins++; if (won === false) s.losses++;
      const r = (s.byRole[d.role] ||= { cases: 0, avgScore: 0 }); r.avgScore = Math.round(((r.avgScore * r.cases + t.total) / (r.cases + 1)) * 10) / 10; r.cases++;
      for (const [k, v] of Object.entries(t.dims as Record<string, number>)) s.dims[k] = (s.dims[k] || 0) + v;
      s.objectionsWon += count(d.id, /^Objection sustained/); s.contradictions += count(d.id, /^Exposed a contradiction/); s.evidenceFound += count(d.id, /^Recovered /);
      s.history.unshift({ sessionId: sim.id, caseTitle: st.title, role: d.role, score: t.total, outcome: o.kind, at: now, awards: mine.map((m: any) => m.label) });
      s.history = s.history.slice(0, 30);
      for (const m of mine) s.achievements.push({ id: m.id, label: m.label, at: now, sessionId: sim.id });
      if (s.cases === 1) s.achievements.push({ id: 'first_case', label: 'First Case', at: now, sessionId: sim.id });
      if (s.cases === 5) s.achievements.push({ id: 'veteran', label: 'Five-Case Veteran', at: now });
      s.achievements = s.achievements.slice(-40);
    });
  }
  const byUser: Record<string, typeof sim.preds.entries> = {};
  for (const p of sim.preds.entries) (byUser[p.userId] ||= []).push(p);
  for (const [uid, list] of Object.entries(byUser)) {
    const right = list.filter((p) => p.won).length, gain = list.reduce((n, p) => n + (p.awarded || 0), 0);
    await updateUser(uid, (u) => {
      u.points += gain; u.total += list.length; u.correct += right;
      u.streak = right * 2 >= list.length && right > 0 ? u.streak + 1 : 0; u.bestStreak = Math.max(u.bestStreak, u.streak);
      const ach = (id: string, label: string) => { if (!u.achievements.some((a) => a.id === id)) u.achievements.push({ id, label, at: now }); };
      if (right) ach('first_call', 'First Correct Call');
      if (right === list.length && list.length >= 4) ach('oracle', 'Oracle: a perfect card');
      if (list.some((p) => p.marketId === 'culprit' && p.won)) ach('sleuth', 'Armchair Sleuth');
      if (u.streak >= 3) ach('hot_streak', 'Hot Streak');
    }).catch(() => {});
  }
  st.committed = true;
  await writeJson(sim.dir('predictions.json'), sim.preds);
  await writeJson(sim.dir('state.json'), sim.st, true);
}
