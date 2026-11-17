// The procedural engine. Agents PROPOSE actions; this module decides who has the floor, what they are
// allowed to do, validates each proposal against the rules of procedure, and turns valid ones into
// state changes and events. It never writes dialogue and never chooses an agent's action for it.
import type { Sim } from './sim.ts';
import type { ActionOption, AgentDecision, Inference, Phase, Turn } from '../shared/types.ts';
import { detectObjections, similarity, GROUND_LABEL } from './legal.ts';
import { evidenceView, evidenceFor } from './views.ts';
import { finalize, openMarkets, closeMarkets } from './referee.ts';
import { config } from './config.ts';

export class RuleError extends Error {}
const fail = (m: string): never => { throw new RuleError(m); };
const clean = (s: any, max = 900): string => {
  const t = String(s ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
  if (t.length < 2) fail('`text` must be a non-empty sentence.');
  return t;
};
const ids = (x: any): string[] => (Array.isArray(x) ? x.filter((i) => typeof i === 'string').slice(0, 12) : []);
const GROUNDS = ['reliability', 'chain_of_custody', 'relevance', 'alternative_explanation', 'unlawful_search', 'bias'];
const OBJ = ['leading', 'hearsay', 'speculation', 'relevance', 'asked_and_answered', 'facts_not_in_evidence', 'argumentative', 'foundation', 'unlawful_search', 'chain_of_custody'];

const INV = ['detective', 'forensic', 'prosecutor'];
const court = (sim: Sim) => ['judge', 'prosecutor', 'defense', ...(sim.st.defendant ? [sim.st.defendant] : [])];
const trialRoom = (sim: Sim, stand?: string) => [...court(sim), ...sim.seatsOf('juror'), ...(stand && !court(sim).includes(stand) ? [stand] : [])];

function aud(sim: Sim): string[] {
  const p = sim.st.phase, sub = sim.st.sub || {};
  if (p === 'briefing' || p === 'investigation' || p === 'charging') return sub.interview ? ['inv', sub.interview.char] : ['inv'];
  if (p === 'pretrial') return ['court'];
  if (p === 'deliberation') return ['jury'];
  return sub.exam ? ['trial', sub.exam.witness] : ['trial'];
}
function say(sim: Sim, seat: string, kind: string, text: string, extra: any = {}) {
  return sim.emit('speech', { seat, kind, text, aud: aud(sim), ...extra });
}
const narrate = (sim: Sim, text: string, extra: any = {}) => sim.emit('narration', { text, aud: aud(sim), ...extra });

// ---------- apparent weight of evidence (what the material in hand appears to show; not the truth) ----------
export function apparent(sim: Sim, evIds: string[], factIds: string[], opts: { discount?: boolean } = {}) {
  const out: Record<string, Record<string, number>> = {};
  const add = (p: Inference, mult: number) => { const o = (out[p.suspect] ||= { motive: 0, opportunity: 0, means: 0, identity: 0, exculp: 0 }); if (p.exculpatory) o.exculp += p.strength * mult; else o[p.element] += p.strength * mult; };
  for (const id of evIds) {
    const d = sim.b.evidence[id], s = sim.ev[id];
    const done = d.analyses.filter((a) => s.analyses[a.id]?.status === 'done');
    let mult = 1;
    if (opts.discount) { const lims = [...d.limitations, ...done.flatMap((a) => a.addsLimitations || [])]; const hit = Math.max(0, ...s.challenges.filter((c) => c.effective).map((c) => lims.find((l) => l.id === c.limitationId)?.strength || 0)); mult = 1 - 0.7 * hit; }
    for (const p of [...d.points, ...done.flatMap((a) => a.addsPoints || [])]) add(p, mult);
  }
  for (const f of factIds) for (const p of sim.b.facts[f].points || []) add(p, 1);
  return out;
}
export const supportOf = (o?: Record<string, number>) => (o ? Math.min(6, o.motive) + Math.min(6, o.opportunity) + Math.min(6, o.identity + o.means) - 1.5 * o.exculp : 0);

// ---------- helpers that mutate the world ----------
function discover(sim: Sim, id: string, by: string, lead?: string, warrantless = false) {
  const s = sim.ev[id]; if (s.discovered) return false;
  const d = sim.b.evidence[id], now = new Date().toISOString();
  Object.assign(s, { discovered: true, discoveredAt: now, discoveredBy: by, viaLead: lead, status: 'collected', warrantless: warrantless || undefined });
  s.custody.push({ t: now, by: sim.nameOf(by), action: 'collected', note: d.collection + (warrantless ? ' (no warrant)' : '') }, { t: now, by: 'Evidence custodian', action: 'logged and sealed', note: `Exhibit ${id}` });
  sim.emit('evidence', { seat: by, text: `${d.title} — ${d.description}`, data: { id, title: d.title, type: d.type, visual: d.visual, warrantless }, highlight: 'evidence', ms: 5200 });
  sim.score(by, 'discovery', 2, `Recovered ${d.title}`);
  for (const s2 of INV) sim.remember(s2, `Evidence ${id} (${d.title}) recovered.`);
  return true;
}
function learnFact(sim: Sim, f: string, source: string) {
  if (sim.st.investigatorFacts.includes(f)) return false;
  sim.st.investigatorFacts.push(f);
  sim.emit('fact', { text: sim.b.facts[f].text, data: { id: f, source }, aud: ['inv'], ms: 0 });
  return true;
}
export function leadAvailable(sim: Sim, id: string) {
  const l = sim.b.leads[id];
  if (sim.st.leadsDone.includes(id)) return false;
  if ((l.yields.evidence || []).every((e) => sim.ev[e].discovered) && !(l.yields.facts || []).length) return false;
  return (l.requires?.all || []).every((r) => sim.holds(r)) && (!l.requires?.any || l.requires.any.some((r) => sim.holds(r)));
}
function announceLeads(sim: Sim) {
  const open: string[] = ((sim.st as any).leadsOpen ||= []);
  for (const l of Object.keys(sim.b.leads)) if (leadAvailable(sim, l) && !open.includes(l)) {
    open.push(l);
    if (sim.st.phase === 'investigation') sim.emit('lead', { text: `New line of inquiry: ${sim.b.leads[l].label}`, data: { id: l }, aud: ['inv'], ms: 1800 });
  }
}
/** Put an exhibit or a witness account to a character and see whether it exposes one of their denials. */
function confront(sim: Sim, by: string, ch: string, present: string): number {
  const rtc = sim.st.chars[ch], e = sim.b.evidence[present];
  const set = new Set([present, ...(e ? e.analyses.filter((a) => sim.holds(a.id)).map((a) => a.id) : [])]);
  let hits = 0, relevant = false;
  for (const f of Object.values(sim.b.facts)) {
    const k = f.knownBy[ch]; if (!k) continue;
    if ((k.yieldsTo || []).some((y) => set.has(y))) { relevant = true; rtc.pressure += 1.5; }
    if ((f.contradictedBy || []).some((c) => set.has(c))) {
      relevant = true;
      if (rtc.denied.includes(f.id) && !rtc.caught.includes(f.id)) { hits++; exposeLie(sim, by, ch, f.id, present); }
    }
  }
  if (e && (e.relevantTo.includes(ch) || e.topics.some((t) => Object.values(sim.b.facts).some((f) => f.knownBy[ch] && f.topic === t)))) relevant = true;
  if (!relevant) sim.score(by, 'evidence', -1, `Put ${e?.title || 'a statement'} to ${sim.charName(ch)} although it has no bearing on them`);
  return hits;
}
function exposeLie(sim: Sim, by: string | null, ch: string, f: string, present: string) {
  const rtc = sim.st.chars[ch], fact = sim.b.facts[f];
  rtc.caught.push(f); rtc.pressure += 2.5; rtc.credibility = Math.max(0, rtc.credibility - 18);
  const what = sim.b.evidence[present]?.title || sim.b.analyses[present]?.label || 'another witness\'s account';
  sim.emit('contradiction', { seat: by || undefined, target: ch, text: `${sim.charName(ch)}'s account — "${fact.knownBy[ch].cover}" — is contradicted by ${what}.`, data: { char: ch, topic: fact.topic, present, statement: fact.knownBy[ch].cover }, highlight: 'contradiction', aud: aud(sim), ms: 5200 });
  if (by) { sim.score(by, 'reasoning', 6, `Exposed a contradiction in ${sim.charName(ch)}'s account using ${what}`); sim.remember(by, `${sim.charName(ch)} was caught out on "${fact.topic}" by ${what}.`); }
  sim.score(ch, 'credibility', -5, `Account contradicted by ${what}`);
  sim.remember(ch, `I was caught in a contradiction about ${fact.topic}; ${what} disproves my line.`);
}
function challenge(sim: Sim, seat: string, evId: string, ground: string) {
  const s = sim.ev[evId], v = evidenceView(sim, evId);
  const lim = v.limitations.find((l) => l.ground === ground && !s.challenges.some((c) => c.by === seat && c.limitationId === l.id));
  const effective = !!lim || (ground === 'unlawful_search' && !!s.warrantless && !s.challenges.some((c) => c.by === seat && c.ground === ground));
  s.challenges.push({ by: seat, ground, effective, limitationId: lim?.id, phase: sim.st.phase, seq: sim.st.seq });
  if (effective) sim.score(seat, 'evidence', 3, `Exposed a genuine weakness in ${v.title} (${GROUND_LABEL[ground] || ground})`);
  else if (s.challenges.filter((c) => c.by === seat && !c.effective).length > 1) sim.score(seat, 'evidence', -1, `Repeated an unfounded attack on ${v.title}`);
  sim.emit('challenge', { seat, data: { evidenceId: evId, ground, title: v.title }, aud: aud(sim), ms: 0 });
}
function setTheory(sim: Sim, seat: string, t: AgentDecision['theory']) {
  if (!t || typeof t !== 'object') return;
  const suspect = t.suspect && sim.b.characters[t.suspect] ? t.suspect : null;
  const m = sim.memory(seat), prev = m.theory, evCount = evidenceFor(sim, seat).length + sim.st.investigatorFacts.length;
  m.theory = { suspect, confidence: Math.max(0, Math.min(1, Number(t.confidence) || 0)), summary: String(t.summary || '').slice(0, 400) };
  if (prev && prev.suspect && prev.suspect !== suspect) {
    m.theoryHistory.push({ seq: sim.st.seq, suspect, confidence: m.theory.confidence });
    sim.emit('theory', { seat, text: `${sim.nameOf(seat)} has revised their working theory.`, data: { from: prev.suspect, to: suspect, summary: m.theory.summary }, vis: 'sealed', aud: [seat], ms: 0 });
    sim.emit('theory_shift', { seat, text: `${sim.nameOf(seat)} revises their working theory.`, ms: 2200, highlight: 'theory' });
    if (evCount > m.lastEvidenceCount && m.theoryHistory.length <= 3) sim.score(seat, 'honesty', 3, 'Revised a theory in response to new evidence');
  } else if (!prev) m.theoryHistory.push({ seq: sim.st.seq, suspect, confidence: m.theory.confidence });
  m.lastEvidenceCount = evCount;
}

// ---------- lifecycle ----------
export function startCase(sim: Sim) {
  const st = sim.st;
  st.status = 'live'; st.startedAt = new Date().toISOString(); st.phase = 'briefing'; st.sub = {}; st.scene = 'archive';
  sim.emit('case', { text: sim.b.def.briefing, data: { title: sim.b.def.title }, ms: 9000, highlight: 'start' });
  sim.emit('phase', { data: { phase: 'briefing' }, ms: 2200 });
  sim.scene('briefing', INV);
  openMarkets(sim);
}

function enterPhase(sim: Sim, p: Phase) {
  const st = sim.st, prev = st.sub?.present;
  sim.setPhase(p); st.sub = { present: prev }; closeMarkets(sim);
  if (p === 'investigation') { sim.scene('office', ['detective', 'forensic']); announceLeads(sim); }
  if (p === 'charging') sim.scene('office', ['detective', 'prosecutor']);
  if (p === 'pretrial') { sim.scene('courtroom', court(sim)); st.sub.stage = 'arraign'; st.sub.moved = []; }
  if (p === 'opening') { sim.scene('courtroom', trialRoom(sim)); narrate(sim, 'The jury is brought in and sworn.'); }
  if (p === 'deliberation') { sim.scene('jury_room', sim.seatsOf('juror')); st.sub.spoke = []; st.trial.round = 1; narrate(sim, 'The jury retires to consider its verdict.'); }
  if (p === 'verdict') { sim.scene('courtroom', trialRoom(sim)); st.sub.stage = 'announce'; }
  if (p === 'sentencing') sim.scene('courtroom', court(sim));
  if (p === 'reveal') sim.scene('archive', []);
}

function completeJobs(sim: Sim) {
  const st = sim.st;
  if (st.phase !== 'investigation' || st.sub?.interview) return;
  for (const j of st.jobs) if (j.dueTurn <= st.turn && !(j as any).queued) { (j as any).queued = true; st.queue.push({ seat: 'forensic', purpose: 'lab_report', data: { jobId: j.id } }); }
}

/** Who acts next? Obligations (a pending question, an objection awaiting a ruling) come first; otherwise
 *  the phase decides who holds the initiative. Returns null when the case is over. */
export function nextTurn(sim: Sim): Turn | null {
  for (let guard = 0; guard < 30; guard++) {
    const st = sim.st;
    if (st.phase === 'closed' || st.status === 'finished') return null;
    if (st.turn > config.maxTotalTurns) { narrate(sim, 'The proceeding has exceeded its time allocation and is closed by the court administrator.'); st.outcome ||= { kind: 'hung', defendant: st.defendant, correct: null, text: 'Proceeding closed without a verdict.' }; enterPhase(sim, 'reveal'); }
    completeJobs(sim);
    if (st.queue.length) return st.queue[0];
    if (st.phaseTurns > config.maxTurnsPerPhase) forceAdvance(sim);
    const t = initiative(sim);
    if (t) return t;
  }
  throw new Error('orchestrator made no progress');
}

function forceAdvance(sim: Sim) {
  const st = sim.st, p = st.phase;
  narrate(sim, 'The court administrator notes that this stage has run out of time and moves the proceeding on.');
  if (p === 'investigation') { st.sub.interview = null; st.report ||= { recommended: null, summary: 'Investigation closed for time.' }; enterPhase(sim, 'charging'); }
  else if (p === 'prosecution_case' || p === 'defense_case') { st.sub.exam = null; st.trial.rested[p === 'prosecution_case' ? 'prosecutor' : 'defense'] = true; st.phaseTurns = 0; }
  else st.phaseTurns = 0;
}

function initiative(sim: Sim): Turn | null {
  const st = sim.st, sub = st.sub, t = st.trial, P = sim.b.def.procedure;
  switch (st.phase) {
    case 'briefing': {
      const order = ['detective', 'forensic', 'prosecutor'];
      if (st.phaseTurns < order.length) return { seat: order[st.phaseTurns], purpose: 'brief' };
      enterPhase(sim, 'investigation'); return null;
    }
    case 'investigation':
      if (sub.interview) {
        if (sub.interview.exchanges >= P.interviewExchanges) { endInterview(sim, 'The interview is concluded.'); return null; }
        return { seat: 'detective', purpose: 'interview_ask' };
      }
      return { seat: 'detective', purpose: 'investigate' };
    case 'charging': return { seat: 'prosecutor', purpose: 'charge_decision' };
    case 'pretrial':
      if (sub.stage === 'arraign') return { seat: 'judge', purpose: 'arraign' };
      if (sub.stage === 'plea') return { seat: 'defense', purpose: 'plea' };
      if (!sub.noMotions && t.motions < 2) return { seat: 'defense', purpose: 'motions' };
      enterPhase(sim, 'opening'); return null;
    case 'opening':
      for (const s of ['prosecutor', 'defense']) if (!t.openingDone.includes(s)) return { seat: s, purpose: 'opening' };
      enterPhase(sim, 'prosecution_case'); narrate(sim, 'The prosecution may call its first witness.'); return null;
    case 'prosecution_case': case 'defense_case': {
      const side = st.phase === 'prosecution_case' ? 'prosecutor' : 'defense';
      if (sub.exam) {
        const x = sub.exam;
        if (x.stage === 'direct' && (x.done || x.asked >= P.maxQuestionsDirect)) { x.stage = 'cross'; x.asked = 0; x.done = false; narrate(sim, `Cross-examination of ${sim.nameOf(x.witness)}.`); }
        if (x.stage === 'cross' && (x.done || x.asked >= P.maxQuestionsCross)) { narrate(sim, `${sim.nameOf(x.witness)} is excused.`); sim.emit('stand', { data: { seat: null }, aud: ['trial'], ms: 0 }); sub.exam = null; sim.scene('courtroom', trialRoom(sim)); return null; }
        return { seat: x.stage === 'direct' ? x.by : sim.other(x.by), purpose: 'examine' };
      }
      if (t.rested[side]) {
        if (side === 'prosecutor') { enterPhase(sim, 'defense_case'); narrate(sim, 'The defense may present its case.'); }
        else enterPhase(sim, 'closing');
        return null;
      }
      return { seat: side, purpose: 'case_in_chief' };
    }
    case 'closing':
      for (const s of ['prosecutor', 'defense']) if (!t.closingDone.includes(s)) return { seat: s, purpose: 'closing' };
      if (!t.closingDone.includes('judge')) return { seat: 'judge', purpose: 'instruct' };
      enterPhase(sim, 'deliberation'); return null;
    case 'deliberation': {
      const jurors = sim.seatsOf('juror'), left = jurors.filter((j) => !sub.spoke.includes(j));
      if (left.length) {
        // No fixed order: whoever is currently in the minority gets the floor first to make their case.
        const tally = Object.values(t.votes).reduce((a: any, v) => ((a[v] = (a[v] || 0) + 1), a), {} as Record<string, number>);
        left.sort((a, b) => (tally[t.votes[a]] ?? 99) - (tally[t.votes[b]] ?? 99));
        return { seat: left[0], purpose: 'deliberate' };
      }
      const votes = jurors.map((j) => t.votes[j]);
      t.voteHistory.push({ ...t.votes });
      if (votes.every((v) => v === votes[0])) { st.outcome = { kind: votes[0] === 'guilty' ? 'convicted' : 'acquitted', defendant: st.defendant, correct: null, text: '' }; enterPhase(sim, 'verdict'); return null; }
      if (t.round >= P.juryRounds) { st.outcome = { kind: 'hung', defendant: st.defendant, correct: null, text: '' }; enterPhase(sim, 'verdict'); return null; }
      t.round++; sub.spoke = []; narrate(sim, `The jury is divided ${votes.filter((v) => v === 'guilty').length}–${votes.filter((v) => v !== 'guilty').length}. Deliberations continue (round ${t.round}).`);
      return null;
    }
    case 'verdict': {
      const o = st.outcome!;
      if (sub.stage === 'announce') {
        const name = sim.charName(st.defendant), charge = sim.b.def.charges.find((c) => c.id === st.charge)?.label || 'the charge';
        o.text = o.kind === 'convicted' ? `On the charge of ${charge}, the jury finds ${name} GUILTY.` : o.kind === 'acquitted' ? `On the charge of ${charge}, the jury finds ${name} NOT GUILTY.` : `The jury is unable to reach a unanimous verdict. A mistrial is declared and ${name} is released.`;
        sim.emit('verdict', { seat: sim.seatsOf('juror')[0], text: o.text, data: { kind: o.kind, defendant: st.defendant, votes: t.votes }, highlight: 'verdict', aud: ['trial'], ms: 8000 });
        sub.stage = 'judgment'; return null;
      }
      if (sub.stage === 'judgment') return { seat: 'judge', purpose: 'judgment' };
      enterPhase(sim, o.kind === 'convicted' ? 'sentencing' : 'reveal'); return null;
    }
    case 'sentencing':
      if (!sub.sentenced) return { seat: 'judge', purpose: 'sentence' };
      enterPhase(sim, 'reveal'); return null;
    case 'reveal': finalize(sim); return null;
  }
  return null;
}

function endInterview(sim: Sim, text: string) {
  const ch = sim.st.sub.interview.char;
  narrate(sim, `${text} ${sim.charName(ch)} leaves the room.`);
  sim.st.sub.interview = null; sim.scene('office', ['detective', 'forensic']);
}

// ---------- what a turn looks like to the agent ----------
const opt = (type: string, description: string, params?: Record<string, string>, choices?: ActionOption['choices']): ActionOption => ({ type, description, params, choices });
const pick = (list: string[], f: (id: string) => string) => list.map((id) => ({ id, label: f(id) }));

export function describe(sim: Sim, turn: Turn): { instruction: string; options: ActionOption[]; context: any } {
  const st = sim.st, sub = st.sub, P = sim.b.def.procedure, d = turn.data || {}, seat = turn.seat;
  const evTitle = (id: string) => `${id}: ${sim.b.evidence[id].title}`;
  const myEv = evidenceFor(sim, seat);
  const speak = (desc: string) => [opt('speak', desc, { text: 'what you say, in character' })];
  switch (turn.purpose) {
    case 'brief': return { instruction: `The case has just been assigned. Give the team your opening assessment from your professional standpoint: what matters first, what you want to know, what you are wary of assuming. Do not name a culprit — nothing has been examined yet.`, options: speak('Address the investigation team.'), context: {} };
    case 'investigate': {
      const leads = Object.keys(sim.b.leads).filter((l) => leadAvailable(sim, l));
      const an = Object.values(sim.b.analyses).filter((a) => sim.ev[a.evidenceId].discovered && !sim.ev[a.evidenceId].analyses[a.id]);
      const o: ActionOption[] = [];
      const affordable = leads.filter((l) => sim.b.leads[l].hours <= st.hoursLeft);
      if (affordable.length) o.push(opt('pursue_lead', 'Follow a line of inquiry. Leads marked PRIVATE SPACE need a warrant: searching without one is allowed but the evidence can be suppressed at trial.', { leadId: 'id of the lead' }, { leadId: affordable.map((l) => { const L = sim.b.leads[l]; return { id: l, label: `${L.label} (${L.hours}h) — ${L.description}${L.requiresWarrant ? ` [PRIVATE SPACE — warrant: ${st.warrants[l] || 'not requested'}]` : ''}` }; }) }));
      const wl = affordable.filter((l) => sim.b.leads[l].requiresWarrant && !st.warrants[l]);
      if (wl.length) o.push(opt('request_warrant', 'Ask the judge for a search warrant, stating your probable cause.', { leadId: 'lead to be authorised', justification: 'your grounds, citing evidence you hold' }, { leadId: pick(wl, (l) => sim.b.leads[l].label) }));
      if (an.length && st.jobs.length < 3) o.push(opt('request_analysis', 'Send an exhibit to the laboratory. Costs no hours; results arrive later while you keep working.', { analysisId: 'id of the analysis' }, { analysisId: an.map((a) => ({ id: a.id, label: `${a.label} — on ${sim.b.evidence[a.evidenceId].title}` })) }));
      if (st.hoursLeft >= 2) o.push(opt('interview', 'Bring someone in for questioning (2h). Suspects are interrogated; witnesses are interviewed. You may re-interview anyone.', { characterId: 'who' }, { characterId: Object.values(sim.b.characters).map((c) => ({ id: c.id, label: `${c.name} (${c.kind}; interviewed ${st.chars[c.id].interviews}x)` })) }));
      if (st.trial.confer < 4) o.push(opt('confer', 'Put a question to a colleague.', { to: 'forensic | prosecutor', text: 'your question' }, { to: [{ id: 'forensic', label: sim.nameOf('forensic') }, { id: 'prosecutor', label: sim.nameOf('prosecutor') }] }));
      if (st.jobs.length) o.push(opt('wait', 'Wait for the laboratory.'));
      o.push(opt('submit_report', 'Close the investigation and send your report to the prosecutor. Recommend a suspect to charge, or null if the evidence supports no one.', { recommended: 'character id or null', summary: 'your reasoning: motive, opportunity, physical link, and what remains uncertain' }, { recommended: Object.values(sim.b.characters).filter((c) => c.kind === 'suspect').map((c) => ({ id: c.id, label: c.name })) }));
      return { instruction: `You are running the investigation. ${st.hoursLeft} investigative hours remain; you cannot do everything, so choose what will actually test your theory. Decide your next step.`, options: o, context: { hoursLeft: st.hoursLeft, labInProgress: st.jobs.map((j) => sim.b.analyses[j.analysisId].label) } };
    }
    case 'interview_ask': {
      const x = sub.interview, c = sim.b.characters[x.char];
      const held = [...myEv, ...st.investigatorFacts];
      return {
        instruction: `You are questioning ${c.name} (${c.kind}). Exchange ${x.exchanges + 1} of at most ${P.interviewExchanges}. Ask ONE targeted question. You may put an exhibit or another witness's account to them with \`present\` — if it contradicts something they have told you, the contradiction will be established.`,
        options: [opt('ask', 'Ask a question.', { text: 'the question', present: '(optional) id of an exhibit or known fact to confront them with', topic: '(optional) topic tag' }, { present: held.map((h) => ({ id: h, label: sim.b.evidence[h] ? evTitle(h) : `${h}: ${sim.b.facts[h].text}` })) }), opt('end_interview', 'End the interview.')],
        context: { subject: { id: c.id, name: c.name, kind: c.kind }, alreadyShown: st.chars[c.id].shown, theirDenialsSoFar: st.chars[c.id].denied.map((f) => ({ topic: sim.b.facts[f].topic, said: sim.b.facts[f].knownBy[c.id].cover })), caughtOutOn: st.chars[c.id].caught.map((f) => sim.b.facts[f].topic), askedSoFar: x.questions },
      };
    }
    case 'answer': {
      const inCourt = !!sub.exam;
      return {
        instruction: `${d.byName} asks you: "${d.question}"${d.present ? ` — and puts ${d.presentLabel} in front of you.` : ''} Answer in character${inCourt ? ', under oath' : ''}. Stay consistent with what you actually know and with what you have already said. In \`reveals\` list the ids of facts from your knowledge that your answer discloses; in \`denies\` list facts your answer conceals or contradicts. You decide what to give up and what to hold.`,
        options: [opt('answer', 'Answer the question.', { text: 'your spoken answer', reveals: 'array of fact ids you disclose', denies: 'array of fact ids you deny or cover' })],
        context: { question: d.question, askedBy: d.byName, presented: d.present ? { id: d.present, label: d.presentLabel } : null, topic: d.topic || null, underOath: inCourt, stage: sub.exam?.stage || 'interview' },
      };
    }
    case 'testify': return { instruction: `You are on the witness stand as ${sim.seatDef(seat).title}. ${d.byName} asks: "${d.question}" Answer from what you personally did and found in this case. Do not overstate; acknowledge limits when they are real.`, options: speak('Give your testimony.'), context: { question: d.question, askedBy: d.byName, exhibit: d.present || null } };
    case 'lab_report': {
      const j = st.jobs.find((x) => x.id === d.jobId)!, a = sim.b.analyses[j.analysisId];
      return { instruction: `Your bench work on "${a.label}" (${sim.b.evidence[j.evidenceId].title}) is complete. Report the result to the detective in your own words. State what it shows and what it does NOT show.`, options: [opt('file_report', 'Deliver the laboratory report.', { text: 'your report' })], context: { benchFindings: a.findings, exhibit: evTitle(j.evidenceId) } };
    }
    case 'confer_reply': return { instruction: `${d.byName} asks you: "${d.question}" Give your professional view.`, options: speak('Reply.'), context: { question: d.question } };
    case 'warrant': {
      const L = sim.b.leads[d.leadId];
      return { instruction: `The detective applies for a warrant to: ${L.label} (${L.description}). Stated grounds: "${d.justification}". Grant it only if the material shown to you amounts to probable cause that evidence will be found there.`, options: [opt('rule_warrant', 'Rule on the application.', { granted: 'true | false', reasoning: 'one or two sentences' })], context: { materialInSupport: (sub.warrantBasis || []).map((b: string) => sim.b.evidence[b]?.title || sim.b.analyses[b]?.label || sim.b.facts[b]?.text) } };
    }
    case 'charge_decision': {
      const o = [opt('charge', 'File a charge. You will have to prove every element beyond reasonable doubt with admissible evidence.', { suspectId: 'whom', chargeId: 'which charge', theory: 'your theory of the case in two or three sentences' }, { suspectId: Object.values(sim.b.characters).filter((c) => c.kind === 'suspect').map((c) => ({ id: c.id, label: c.name })), chargeId: sim.b.def.charges.map((c) => ({ id: c.id, label: `${c.label} (elements: ${c.elements.join(', ')})` })) }), opt('decline', 'Decline to charge anyone on the present evidence.', { reason: 'why' })];
      if (!st.trial.sentRequestMore && st.hoursLeft > 0) o.push(opt('request_more', 'Send the file back for further investigation (once).', { text: 'what you need' }));
      return { instruction: `The detective's report is on your desk. Recommended: ${sim.charName(st.report?.recommended) || 'no one'}. "${st.report?.summary}" You are not bound by the recommendation. Decide.`, options: o, context: { report: st.report, hoursLeft: st.hoursLeft } };
    }
    case 'arraign': return { instruction: `Open the pre-trial hearing: state the charge against ${sim.charName(st.defendant)} and call for the plea.`, options: speak('Address the court.'), context: {} };
    case 'plea': return { instruction: `Enter your client ${sim.charName(st.defendant)}'s plea.`, options: [opt('plea', 'Enter a plea.', { plea: 'not_guilty | guilty', text: 'what you say' })], context: {} };
    case 'motions': {
      const can = myEv.filter((e) => sim.ev[e].status === 'collected' && !sub.moved.includes(e));
      return { instruction: `Pre-trial motions. You may move to suppress prosecution evidence (${2 - st.trial.motions} motion(s) left). A motion needs a real ground — check each exhibit's collection details and chain of custody. Otherwise say you have none.`, options: [...(can.length ? [opt('motion_suppress', 'Move to suppress an exhibit.', { evidenceId: 'exhibit', ground: GROUNDS.join(' | '), text: 'your argument' }, { evidenceId: pick(can, evTitle) })] : []), opt('no_motions', 'No (further) motions.')], context: {} };
    }
    case 'motion_response': return { instruction: `The defense moves to suppress ${evTitle(sub.motion.evidenceId)} on the ground of ${GROUND_LABEL[sub.motion.ground] || sub.motion.ground}. Respond.`, options: speak('Oppose (or concede) the motion.'), context: { motion: sub.motion } };
    case 'motion_ruling': return { instruction: `Rule on the motion to suppress ${evTitle(sub.motion.evidenceId)} (${GROUND_LABEL[sub.motion.ground] || sub.motion.ground}). Look at how the exhibit was actually obtained.`, options: [opt('rule', 'Rule.', { ruling: 'granted | denied', reasoning: 'one or two sentences' })], context: { motion: sub.motion, exhibit: evidenceView(sim, sub.motion.evidenceId) } };
    case 'opening': return { instruction: seat === 'prosecutor' ? `Deliver your opening statement to the jury: what you will prove and with what.` : `Deliver the defense opening: where the prosecution's case is weak and what the jury should watch for.`, options: [opt('statement', 'Opening statement.', { text: 'your statement (3-6 sentences)' })], context: {} };
    case 'case_in_chief': {
      const t = st.trial, called = t.witnessesCalled[seat] || [];
      const pool = sim.b.def.seats.filter((s) => ['witness', 'suspect', 'detective', 'forensic'].includes(s.role) && !called.includes(s.id) && (s.id !== st.defendant || seat === 'defense'));
      const offer = myEv.filter((e) => sim.ev[e].status === 'collected');
      const o: ActionOption[] = [];
      if (offer.length) o.push(opt('offer_exhibit', 'Offer an exhibit into evidence. The other side may object; the judge rules.', { evidenceId: 'exhibit', purpose: 'what it goes to prove' }, { evidenceId: pick(offer, evTitle) }));
      if (called.length < P.maxWitnessesPerSide && pool.length) o.push(opt('call_witness', `Call a witness (${P.maxWitnessesPerSide - called.length} left). You examine first; the other side cross-examines.`, { seatId: 'who' }, { seatId: pool.map((s) => ({ id: s.id, label: `${sim.nameOf(s.id)} (${s.role})` })) }));
      o.push(opt('rest', 'Rest your case.'));
      return { instruction: `It is your case to present. Admitted so far: ${sim.admitted().join(', ') || 'nothing'}. Only admitted exhibits and testimony given in court count. Choose your next move.`, options: o, context: { suppressedOrExcluded: Object.values(sim.ev).filter((e) => e.status === 'suppressed' || e.status === 'excluded').map((e) => e.id) } };
    }
    case 'exhibit_response': return { instruction: `${sim.nameOf(sim.other(seat))} offers ${evTitle(d.evidenceId)} into evidence. Object if you have a ground; otherwise let it in.`, options: [opt('object', 'Object to admission.', { ground: OBJ.join(' | '), text: 'your objection' }), opt('no_objection', 'No objection.')], context: { exhibit: evidenceView(sim, d.evidenceId) } };
    case 'examine': {
      const x = sub.exam, w = x.witness, isChar = !!sim.seatDef(w).characterId;
      const adm = sim.admitted();
      return {
        instruction: `${x.stage === 'direct' ? 'Direct examination' : 'Cross-examination'} of ${sim.nameOf(w)}. Question ${x.asked + 1} of at most ${x.stage === 'direct' ? P.maxQuestionsDirect : P.maxQuestionsCross}. ${x.stage === 'direct' ? 'Open questions only — leading your own witness draws an objection.' : 'Leading questions are allowed on cross. You may confront the witness with an admitted exhibit, and attack an exhibit\'s weight by naming a ground.'}`,
        options: [opt('ask', 'Ask a question.', { text: 'the question', exhibitId: '(optional) an ADMITTED exhibit to put to the witness', challengeGround: `(optional, with exhibitId) attack that exhibit's weight: ${GROUNDS.join(' | ')}`, topic: '(optional) topic tag' }, { exhibitId: pick(adm, evTitle) }), opt('no_further_questions', 'No further questions.')],
        context: { witness: { seat: w, name: sim.nameOf(w), role: sim.role(w) }, stage: x.stage, askedSoFar: x.questions, witnessSaidBefore: isChar ? { denied: st.chars[w].denied.map((f) => ({ id: f, topic: sim.b.facts[f].topic, said: sim.b.facts[f].knownBy[w].cover })), caught: st.chars[w].caught.map((f) => sim.b.facts[f].topic), toldInvestigators: sim.role(seat) === 'juror' ? [] : st.chars[w].revealed } : null },
      };
    }
    case 'objection_window': return { instruction: `${d.byName} has just asked the witness: "${d.question}" (${sub.exam.stage} examination). If the question is objectionable, object now and name the ground; a baseless objection costs you credit with the court.`, options: [opt('object', 'Object.', { ground: OBJ.join(' | '), text: 'your objection' }), opt('no_objection', 'Let the witness answer.')], context: { question: d.question, stage: sub.exam.stage, witness: sim.nameOf(sub.exam.witness), earlierQuestions: sub.exam.questions.slice(0, -1) } };
    case 'rule_objection': return { instruction: d.kind === 'exhibit' ? `Objection to the admission of ${evTitle(d.evidenceId)}: ${GROUND_LABEL[d.ground] || d.ground}. Rule.` : `Objection (${GROUND_LABEL[d.ground] || d.ground}) to the question: "${d.question}" — ${sub.exam?.stage} examination of a ${d.witnessKind} witness. Rule.`, options: [opt('rule', 'Rule on the objection.', { ruling: 'sustained | overruled', reasoning: 'one sentence' })], context: { objection: { ground: d.ground, by: sim.nameOf(d.by), kind: d.kind }, question: d.question || null, stage: sub.exam?.stage || null, witnessKind: d.witnessKind || null, earlierQuestions: sub.exam?.questions.slice(0, -1) || [], exhibit: d.evidenceId ? evidenceView(sim, d.evidenceId) : null } };
    case 'closing': return { instruction: seat === 'prosecutor' ? `Closing argument. Tie each element of the charge to admitted exhibits and testimony. Citing anything not in evidence will be struck.` : `Closing argument for the defense. Attack the weak links, name the doubts, and offer the alternative if you have one.`, options: [opt('argue', 'Closing argument.', { text: 'your argument (4-8 sentences)', cites: 'array of ADMITTED exhibit ids you rely on', challenges: 'array of {evidenceId, ground} attacking admitted exhibits', alternativeSuspect: '(defense, optional) character id of someone else the evidence points to' })], context: { admitted: sim.admitted() } };
    case 'instruct': return { instruction: `Instruct the jury on the burden and standard of proof and on what they may and may not consider.`, options: speak('Give the jury its instructions.'), context: {} };
    case 'deliberate': return { instruction: `Jury room, round ${st.trial.round}. Say where you stand and why, answering your fellow jurors if they disagree. Decide ONLY on admitted exhibits and testimony heard in court; the standard is proof beyond reasonable doubt on every element.`, options: [opt('deliberate', 'Speak and vote.', { text: 'what you say to the other jurors', vote: 'guilty | not_guilty', keyEvidence: 'array of admitted exhibit ids your view rests on' })], context: { votesSoFar: st.trial.votes, round: st.trial.round, previousRounds: st.trial.voteHistory } };
    case 'judgment': return { instruction: `The verdict has been returned: ${st.outcome!.text} Enter judgment and address the court.`, options: speak('Enter judgment.'), context: { outcome: st.outcome!.kind } };
    case 'sentence': return { instruction: `${sim.charName(st.defendant)} stands convicted${st.plea === 'guilty' ? ' on a guilty plea' : ''}. Pass sentence, with reasons.`, options: speak('Pass sentence.'), context: {} };
  }
  throw new Error(`unknown purpose ${turn.purpose}`);
}

// ---------- applying an agent's proposed action ----------
export function apply(sim: Sim, turn: Turn, dec: AgentDecision) {
  const st = sim.st, sub = st.sub, seat = turn.seat, a = dec.action || ({} as any), d = turn.data || {}, t = st.trial, P = sim.b.def.procedure;
  const allowed = describe(sim, turn).options.map((o) => o.type);
  if (!allowed.includes(a.type)) fail(`Action "${a.type}" is not available now. Allowed: ${allowed.join(', ')}.`);
  if (st.queue[0] === turn) st.queue.shift();
  st.turn++; st.phaseTurns++;
  if (dec.thought) sim.emit('thought', { seat, text: String(dec.thought).slice(0, 600), vis: 'sealed', aud: [seat], ms: 0 });
  if (dec.note) sim.remember(seat, String(dec.note));
  setTheory(sim, seat, dec.theory);
  const byName = sim.nameOf(seat);

  switch (turn.purpose) {
    case 'brief': say(sim, seat, 'assessment', clean(a.text)); break;
    case 'confer_reply': say(sim, seat, 'reply', clean(a.text), { target: 'detective' }); break;
    case 'investigate': investigate(sim, seat, a); break;
    case 'interview_ask': {
      const x = sub.interview, ch = x.char, rtc = st.chars[ch];
      if (a.type === 'end_interview') { endInterview(sim, `${byName} ends the interview.`); break; }
      const text = clean(a.text), present = typeof a.present === 'string' && a.present ? a.present : null;
      if (present && !sim.holds(present)) fail(`You do not hold "${present}".`);
      if (x.questions.some((q: string) => similarity(q, text) > 0.72)) sim.score(seat, 'reasoning', -1, 'Repeated a question already asked');
      x.questions.push(text); x.exchanges++;
      rtc.pressure += 0.4 + 0.5 * sim.agents[seat].traits.aggression;
      say(sim, seat, 'question', text, { target: ch, data: { present } });
      if (present) {
        if (sim.b.evidence[present]) { if (!rtc.shown.includes(present)) rtc.shown.push(present); sim.emit('present', { seat, target: ch, data: { id: present, title: sim.b.evidence[present].title, visual: sim.b.evidence[present].visual }, aud: aud(sim), ms: 2600 }); }
        confront(sim, seat, ch, present);
      }
      st.queue.unshift({ seat: ch, purpose: 'answer', data: { question: text, byName, by: seat, present, presentLabel: present ? sim.b.evidence[present]?.title || 'a witness account: ' + sim.b.facts[present]?.text : null, topic: a.topic } });
      break;
    }
    case 'answer': answer(sim, seat, a, d); break;
    case 'testify': say(sim, seat, 'testimony', clean(a.text), { target: d.by }); break;
    case 'lab_report': {
      const j = st.jobs.find((x) => x.id === d.jobId)!, an = sim.b.analyses[j.analysisId], text = clean(a.text, 1200);
      sim.scene('lab', ['forensic', 'detective']);
      sim.ev[j.evidenceId].analyses[an.id] = { status: 'done', by: byName, at: new Date().toISOString(), report: text };
      sim.ev[j.evidenceId].custody.push({ t: new Date().toISOString(), by: byName, action: 'examined', note: an.label });
      st.jobs = st.jobs.filter((x) => x.id !== j.id);
      say(sim, seat, 'lab_report', text, { target: 'detective', data: { evidenceId: j.evidenceId, analysisId: an.id, label: an.label, findings: an.findings }, highlight: 'lab' });
      sim.score(seat, 'evidence', 3, `Completed ${an.label}`);
      if ((an.addsLimitations?.length || /\b(cannot|can't|does not|doesn't|limit|however|only|not prove)\b/i.test(text)) && /\b(cannot|can't|does not|doesn't|limit|however|only|not)\b/i.test(text)) sim.score(seat, 'honesty', 1, 'Stated the limits of a finding');
      for (const f of an.yieldsFacts || []) learnFact(sim, f, an.label);
      for (const e of an.yieldsEvidence || []) discover(sim, e, 'forensic');
      for (const s of INV) sim.remember(s, `Lab result — ${an.label}: ${an.findings}`);
      announceLeads(sim);
      break;
    }
    case 'warrant': {
      const granted = a.granted === true || a.granted === 'true', L = sim.b.leads[d.leadId];
      const cause = (L.warrantBasis || []).filter((b) => sim.holds(b)).length >= 2;
      st.warrants[d.leadId] = granted ? 'granted' : 'denied';
      say(sim, seat, 'ruling', clean(a.reasoning || (granted ? 'The warrant is granted.' : 'The application is refused.')), { data: { warrant: d.leadId, granted }, highlight: 'ruling' });
      sim.emit('warrant', { text: `Search warrant ${granted ? 'GRANTED' : 'REFUSED'}: ${L.label}`, data: { leadId: d.leadId, granted }, aud: ['inv'], ms: 2400 });
      sim.score(seat, 'procedure', granted === cause ? 3 : -3, granted === cause ? 'Warrant ruling matched the strength of the application' : granted ? 'Granted a warrant on thin grounds' : 'Refused a warrant despite adequate probable cause');
      sub.warrantBasis = null;
      break;
    }
    case 'charge_decision': {
      if (a.type === 'request_more') { t.sentRequestMore = true; say(sim, seat, 'statement', clean(a.text), { target: 'detective' }); st.report = null; enterPhase(sim, 'investigation'); break; }
      const ap = apparent(sim, sim.discovered(), st.investigatorFacts), culprit = sim.b.truth.culprit;
      if (a.type === 'decline') {
        say(sim, seat, 'decline', clean(a.reason), { highlight: 'charge' });
        st.outcome = { kind: 'no_charges', defendant: null, correct: null, text: 'The prosecutor declined to bring charges.' };
        const best = Math.max(0, ...Object.values(ap).map(supportOf));
        sim.score(seat, 'reasoning', best < 8 ? 3 : -3, best < 8 ? 'Declined to charge on thin evidence' : 'Declined to charge despite a substantial evidential case');
        enterPhase(sim, 'reveal'); break;
      }
      const sus = sim.b.characters[a.suspectId]?.kind === 'suspect' ? a.suspectId : fail('suspectId must be one of the suspects.');
      const ch = sim.b.def.charges.find((c) => c.id === a.chargeId) || fail('Unknown chargeId.');
      st.defendant = sus; st.charge = ch.id;
      const o = ap[sus] || {}, covered = ch.elements.every((e) => (e === 'identity' ? (o.identity || 0) + (o.means || 0) : o[e] || 0) >= 2);
      say(sim, seat, 'charge', clean(a.theory), { target: sus, data: { suspect: sus, charge: ch.label }, highlight: 'charge' });
      narrate(sim, `${sim.charName(sus)} is charged with ${ch.label}. The prosecution's evidence is disclosed to the defense.`, { aud: ['all'] });
      sim.score(seat, 'reasoning', covered ? 5 : -4, covered ? 'Charged on evidence that covers every element' : 'Brought a charge with an element unsupported by the evidence in hand');
      sim.score(seat, 'accuracy', sus === culprit ? 8 : -8, sus === culprit ? 'Charged the person actually responsible' : 'Charged an innocent person', true);
      const now = new Date().toISOString();
      for (const e of sim.discovered()) { sim.ev[e].disclosedToDefense = true; sim.ev[e].custody.push({ t: now, by: byName, action: 'disclosed to defense' }); }
      sim.remember('defense', `My client is ${sim.charName(sus)}, charged with ${ch.label}.`);
      enterPhase(sim, 'pretrial');
      break;
    }
    case 'arraign': say(sim, seat, 'arraignment', clean(a.text)); sub.stage = 'plea'; break;
    case 'plea': {
      const plea = a.plea === 'guilty' ? 'guilty' : 'not_guilty'; st.plea = plea;
      say(sim, seat, 'plea', clean(a.text || (plea === 'guilty' ? 'Guilty, Your Honour.' : 'Not guilty, Your Honour.')), { data: { plea }, highlight: 'plea' });
      if (plea === 'guilty') { st.outcome = { kind: 'plea', defendant: st.defendant, correct: null, text: `${sim.charName(st.defendant)} pleaded guilty.` }; enterPhase(sim, 'sentencing'); }
      else sub.stage = 'motions';
      break;
    }
    case 'motions': {
      if (a.type === 'no_motions') { sub.noMotions = true; say(sim, seat, 'statement', t.motions ? 'No further motions, Your Honour.' : 'The defense has no pre-trial motions, Your Honour.'); break; }
      const e = a.evidenceId; if (!evidenceFor(sim, seat).includes(e) || sim.ev[e].status !== 'collected' || sub.moved.includes(e)) fail('That exhibit cannot be the subject of a motion.');
      if (!GROUNDS.includes(a.ground)) fail(`ground must be one of: ${GROUNDS.join(', ')}`);
      t.motions++; sub.moved.push(e); sub.motion = { evidenceId: e, ground: a.ground, by: seat };
      say(sim, seat, 'motion', clean(a.text), { data: { evidenceId: e, ground: a.ground }, highlight: 'motion' });
      st.queue.unshift({ seat: 'prosecutor', purpose: 'motion_response' }, { seat: 'judge', purpose: 'motion_ruling' });
      break;
    }
    case 'motion_response': say(sim, seat, 'response', clean(a.text)); break;
    case 'motion_ruling': {
      const m = sub.motion, granted = a.ruling === 'granted', s = sim.ev[m.evidenceId], should = m.ground === 'unlawful_search' && !!s.warrantless;
      say(sim, seat, 'ruling', clean(a.reasoning || (granted ? 'Motion granted.' : 'Motion denied.')), { data: { motion: m, granted }, highlight: 'ruling' });
      if (granted) { s.status = 'suppressed'; s.custody.push({ t: new Date().toISOString(), by: byName, action: 'suppressed by order of the court' }); sim.emit('evidence_status', { text: `${sim.b.evidence[m.evidenceId].title} is SUPPRESSED and may not be used at trial.`, data: { id: m.evidenceId, status: 'suppressed' }, highlight: 'suppressed', ms: 4200 }); }
      sim.score(seat, 'procedure', granted === should ? 3 : -4, granted === should ? 'Suppression ruling followed the law' : granted ? 'Suppressed lawfully obtained evidence' : 'Admitted the fruit of an unlawful search');
      if (granted) sim.score('defense', 'procedure', 6, `Won suppression of ${sim.b.evidence[m.evidenceId].title}`);
      else if (!should) sim.score('defense', 'procedure', -1, 'Brought a suppression motion without a real ground');
      sub.motion = null;
      break;
    }
    case 'opening': say(sim, seat, 'opening', clean(a.text, 1400), { highlight: 'opening' }); t.openingDone.push(seat); break;
    case 'case_in_chief': {
      if (a.type === 'rest') {
        if (seat === 'prosecutor' && !sim.admitted().length && !(t.witnessesCalled[seat] || []).length) fail('The prosecution cannot rest without presenting any evidence.');
        t.rested[seat] = true; say(sim, seat, 'rest', seat === 'prosecutor' ? 'The prosecution rests, Your Honour.' : 'The defense rests.'); break;
      }
      if (a.type === 'offer_exhibit') {
        const e = a.evidenceId; if (!evidenceFor(sim, seat).includes(e)) fail('You do not have that exhibit.');
        if (sim.ev[e].status !== 'collected') fail(`Exhibit ${e} is ${sim.ev[e].status} and cannot be offered.`);
        sim.ev[e].status = 'offered'; sim.ev[e].offeredBy = seat;
        say(sim, seat, 'offer', `I offer ${sim.b.evidence[e].title} as an exhibit. ${clean(a.purpose || 'It is relevant to the issues.', 400)}`, { data: { evidenceId: e } });
        sim.emit('present', { seat, data: { id: e, title: sim.b.evidence[e].title, visual: sim.b.evidence[e].visual }, aud: aud(sim), ms: 2600 });
        st.queue.unshift({ seat: sim.other(seat), purpose: 'exhibit_response', data: { evidenceId: e } });
        break;
      }
      const w = a.seatId, called = (t.witnessesCalled[seat] ||= []);
      const wd = sim.seatDef(w); if (!wd || !['witness', 'suspect', 'detective', 'forensic'].includes(wd.role) || called.includes(w)) fail('That person cannot be called.');
      if (w === st.defendant && seat !== 'defense') fail('The prosecution cannot call the defendant.');
      if (called.length >= P.maxWitnessesPerSide) fail('Witness limit reached.');
      called.push(w); if (st.chars[w]) st.chars[w].sworn = true;
      sub.exam = { witness: w, by: seat, stage: 'direct', asked: 0, questions: [] };
      say(sim, seat, 'call', `${seat === 'prosecutor' ? 'The prosecution' : 'The defense'} calls ${sim.nameOf(w)}.`, { target: w });
      sim.scene('courtroom', trialRoom(sim, w));
      sim.emit('stand', { target: w, text: `${sim.nameOf(w)} takes the stand and is sworn.`, data: { seat: w }, aud: ['trial', w], ms: 3000 });
      break;
    }
    case 'exhibit_response': {
      const e = d.evidenceId;
      if (a.type === 'no_objection') { admit(sim, e, true); say(sim, seat, 'statement', 'No objection.'); break; }
      if (!OBJ.includes(a.ground)) fail(`ground must be one of: ${OBJ.join(', ')}`);
      say(sim, seat, 'objection', clean(a.text || `Objection — ${GROUND_LABEL[a.ground]}.`), { data: { ground: a.ground }, highlight: 'objection' });
      st.queue.unshift({ seat: 'judge', purpose: 'rule_objection', data: { kind: 'exhibit', evidenceId: e, ground: a.ground, by: seat } });
      break;
    }
    case 'examine': {
      const x = sub.exam, w = x.witness, isChar = !!sim.seatDef(w).characterId;
      if (a.type === 'no_further_questions') { x.done = true; say(sim, seat, 'statement', 'No further questions.'); break; }
      const text = clean(a.text), ex = typeof a.exhibitId === 'string' && a.exhibitId ? a.exhibitId : null;
      if (ex && sim.ev[ex]?.status !== 'admitted') fail(`Exhibit ${ex} is not in evidence. Offer it first (in your own case) or ask without it.`);
      const cues = detectObjections(text, { stage: x.stage, witnessKind: isChar ? 'lay' : sim.role(w) === 'forensic' ? 'expert' : 'officer', prior: x.questions });
      x.questions.push(text); x.asked++;
      say(sim, seat, 'question', text, { target: w, data: { exhibit: ex, stage: x.stage } });
      if (ex) {
        sim.emit('present', { seat, target: w, data: { id: ex, title: sim.b.evidence[ex].title, visual: sim.b.evidence[ex].visual }, aud: aud(sim), ms: 2400 });
        if (GROUNDS.includes(a.challengeGround)) challenge(sim, seat, ex, a.challengeGround);
        if (isChar) { if (!st.chars[w].shown.includes(ex)) st.chars[w].shown.push(ex); const hits = confront(sim, seat, w, ex); if (hits && x.stage === 'cross') sim.score(seat, 'persuasion', 2, `Impeached ${sim.nameOf(w)} before the jury`); }
      }
      const next: Turn = isChar ? { seat: w, purpose: 'answer', data: { question: text, byName, by: seat, present: ex, presentLabel: ex ? sim.b.evidence[ex].title : null, topic: a.topic } } : { seat: w, purpose: 'testify', data: { question: text, byName, by: seat, present: ex } };
      if (cues.length || sim.rand() < 0.1) st.queue.unshift({ seat: sim.other(seat), purpose: 'objection_window', data: { question: text, byName, by: seat, cues, next, witnessKind: isChar ? 'lay' : 'expert' } });
      else st.queue.unshift(next);
      break;
    }
    case 'objection_window': {
      if (a.type === 'no_objection') { st.queue.unshift(d.next); break; }
      if (!OBJ.includes(a.ground)) fail(`ground must be one of: ${OBJ.join(', ')}`);
      say(sim, seat, 'objection', clean(a.text || `Objection — ${GROUND_LABEL[a.ground]}.`), { data: { ground: a.ground }, highlight: 'objection' });
      st.queue.unshift({ seat: 'judge', purpose: 'rule_objection', data: { kind: 'question', question: d.question, ground: a.ground, by: seat, asker: d.by, cues: d.cues, next: d.next, witnessKind: d.witnessKind } });
      break;
    }
    case 'rule_objection': {
      const sustained = a.ruling === 'sustained';
      let should: boolean;
      if (d.kind === 'exhibit') {
        const s = sim.ev[d.evidenceId];
        should = (d.ground === 'unlawful_search' && !!s.warrantless);
        say(sim, seat, 'ruling', clean(a.reasoning || (sustained ? 'Sustained. The exhibit is excluded.' : 'Overruled. The exhibit is admitted.')), { data: { sustained, ...d }, highlight: sustained ? 'sustained' : 'overruled' });
        if (sustained) { s.status = 'excluded'; sim.emit('evidence_status', { text: `${sim.b.evidence[d.evidenceId].title} is EXCLUDED.`, data: { id: d.evidenceId, status: 'excluded' }, highlight: 'suppressed', aud: ['trial'], ms: 3600 }); sim.score(s.offeredBy!, 'procedure', -3, `Offered ${sim.b.evidence[d.evidenceId].title}, which was excluded`); }
        else admit(sim, d.evidenceId, false);
      } else {
        should = (d.cues || []).includes(d.ground);
        say(sim, seat, 'ruling', clean(a.reasoning || (sustained ? 'Sustained.' : 'Overruled.')), { data: { sustained, ground: d.ground }, highlight: sustained ? 'sustained' : 'overruled' });
        if (sustained) { narrate(sim, 'The question is struck. The witness does not answer.'); sim.score(d.asker, 'procedure', -2, `Asked an objectionable question (${GROUND_LABEL[d.ground] || d.ground})`); }
        else st.queue.unshift(d.next);
      }
      if (sustained) sim.score(d.by, 'procedure', should ? 4 : 2, `Objection sustained (${GROUND_LABEL[d.ground] || d.ground})`);
      else if (!should) sim.score(d.by, 'procedure', -1, 'Raised an objection without merit');
      sim.score(seat, 'procedure', sustained === should ? 2 : -3, sustained === should ? 'Ruled correctly on an objection' : sustained ? 'Sustained an objection that had no basis' : 'Overruled a well-founded objection');
      break;
    }
    case 'closing': {
      const adm = sim.admitted(), cites = ids(a.cites), bad = cites.filter((c) => !adm.includes(c) && sim.b.evidence[c]), good = cites.filter((c) => adm.includes(c));
      say(sim, seat, 'closing', clean(a.text, 1800), { data: { cites: good }, highlight: 'closing' });
      for (const b of bad) { narrate(sim, `The court strikes counsel's reference to ${sim.b.evidence[b].title}: it is not in evidence, and the jury will disregard it.`); sim.score(seat, 'procedure', -3, `Argued from ${sim.b.evidence[b].title}, which is not in evidence`); }
      if (good.length) sim.score(seat, 'evidence', Math.min(4, good.length), `Grounded the closing argument in ${good.length} admitted exhibit(s)`);
      const ch: string[] = [];
      for (const c of Array.isArray(a.challenges) ? a.challenges.slice(0, 6) : []) if (c && adm.includes(c.evidenceId) && GROUNDS.includes(c.ground)) { challenge(sim, seat, c.evidenceId, c.ground); ch.push(c.evidenceId); }
      const alt = seat === 'defense' && sim.b.characters[a.alternativeSuspect] && a.alternativeSuspect !== st.defendant ? a.alternativeSuspect : null;
      t.argued[seat] = { cites: good, challenges: ch, alt };
      t.closingDone.push(seat);
      break;
    }
    case 'instruct': say(sim, seat, 'instructions', clean(a.text, 1200)); t.closingDone.push('judge'); break;
    case 'deliberate': {
      const vote = a.vote === 'guilty' ? 'guilty' : a.vote === 'not_guilty' ? 'not_guilty' : fail('vote must be guilty or not_guilty.');
      const adm = sim.admitted(), key = ids(a.keyEvidence), prev = t.votes[seat];
      say(sim, seat, 'deliberation', clean(a.text, 1200), { data: { vote, key: key.filter((k) => adm.includes(k)) } });
      if (key.some((k) => sim.b.evidence[k] && !adm.includes(k))) sim.score(seat, 'procedure', -3, 'Relied on material that was not admitted');
      else if (key.length) sim.score(seat, 'reasoning', 2, 'Reasoned from the admitted record');
      if (prev && prev !== vote) { sim.score(seat, 'honesty', 2, 'Changed position during deliberation'); sim.emit('vote_change', { seat, text: `${byName} changes their vote to ${vote.replace('_', ' ')}.`, aud: ['jury'], ms: 2200, highlight: 'theory' }); }
      t.votes[seat] = vote; sub.spoke.push(seat);
      break;
    }
    case 'judgment': say(sim, seat, 'judgment', clean(a.text), { highlight: 'ruling' }); sub.stage = 'done'; break;
    case 'sentence': say(sim, seat, 'sentence', clean(a.text), { highlight: 'sentence' }); sub.sentenced = true; break;
    default: throw new Error(`no handler for ${turn.purpose}`);
  }
}

function admit(sim: Sim, e: string, unopposed: boolean) {
  const s = sim.ev[e]; s.status = 'admitted';
  s.custody.push({ t: new Date().toISOString(), by: 'Clerk of the court', action: 'admitted into evidence' });
  sim.emit('evidence_status', { text: `${sim.b.evidence[e].title} is admitted as an exhibit.`, data: { id: e, status: 'admitted' }, aud: ['trial'], ms: 2400 });
  sim.score(s.offeredBy!, 'evidence', 1, `${sim.b.evidence[e].title} admitted`);
  if (unopposed && s.warrantless) sim.score(sim.other(s.offeredBy!), 'procedure', -3, 'Let in an exhibit obtained without a warrant, unchallenged');
}

function investigate(sim: Sim, seat: string, a: any) {
  const st = sim.st, byName = sim.nameOf(seat);
  switch (a.type) {
    case 'wait': if (!st.jobs.length) fail('Nothing is pending at the laboratory.'); st.passes++; narrate(sim, `${byName} waits on the laboratory.`, { ms: 1500 }); for (const j of st.jobs) j.dueTurn = Math.min(j.dueTurn, st.turn + 1); break;
    case 'pursue_lead': {
      const id = a.leadId, L = sim.b.leads[id];
      if (!L || !leadAvailable(sim, id)) fail('That lead is not available.');
      if (L.hours > st.hoursLeft) fail('Not enough investigative hours left.');
      const warrantless = !!L.requiresWarrant && st.warrants[id] !== 'granted';
      st.hoursLeft -= L.hours; st.leadsDone.push(id);
      sim.scene(L.scene, L.kind === 'scene' || L.scene === 'lab' ? ['detective', 'forensic'] : ['detective']);
      sim.emit('action', { seat, text: L.narration, data: { leadId: id, label: L.label, kind: L.kind, warrantless }, aud: ['inv'], ms: 3600 });
      if (L.requiresWarrant) sim.score(seat, 'procedure', warrantless ? -6 : 2, warrantless ? `Searched a private space without a warrant (${L.label})` : `Searched under a warrant (${L.label})`);
      for (const e of L.yields.evidence || []) discover(sim, e, seat, id, warrantless);
      for (const f of L.yields.facts || []) learnFact(sim, f, L.label);
      announceLeads(sim);
      break;
    }
    case 'request_warrant': {
      const L = sim.b.leads[a.leadId];
      if (!L?.requiresWarrant || !leadAvailable(sim, a.leadId) || st.warrants[a.leadId]) fail('No warrant application is possible for that lead.');
      st.sub.warrantBasis = (L.warrantBasis || []).filter((b) => sim.holds(b));
      say(sim, seat, 'warrant_request', clean(a.justification), { target: 'judge', data: { leadId: a.leadId } });
      sim.score(seat, 'procedure', 1, 'Sought judicial authority before a search');
      st.queue.unshift({ seat: 'judge', purpose: 'warrant', data: { leadId: a.leadId, justification: clean(a.justification) } });
      break;
    }
    case 'request_analysis': {
      const an = sim.b.analyses[a.analysisId];
      if (!an || !sim.ev[an.evidenceId].discovered || sim.ev[an.evidenceId].analyses[an.id]) fail('That analysis is not available.');
      if (st.jobs.length >= 3) fail('The laboratory is at capacity (3 jobs).');
      sim.ev[an.evidenceId].analyses[an.id] = { status: 'pending' };
      sim.ev[an.evidenceId].custody.push({ t: new Date().toISOString(), by: byName, action: 'sent to laboratory', note: an.label });
      st.jobs.push({ id: `J${st.turn}`, evidenceId: an.evidenceId, analysisId: an.id, dueTurn: st.turn + an.turns, requestedBy: seat });
      sim.emit('lab', { seat, text: `${byName} sends ${sim.b.evidence[an.evidenceId].title} to the laboratory: ${an.label}.`, data: { evidenceId: an.evidenceId, analysisId: an.id }, aud: ['inv'], ms: 2600 });
      break;
    }
    case 'interview': {
      const c = sim.b.characters[a.characterId]; if (!c) fail('Unknown person.');
      if (st.hoursLeft < 2) fail('Not enough hours for an interview.');
      st.hoursLeft -= 2; st.chars[c.id].interviews++;
      st.sub.interview = { char: c.id, exchanges: 0, questions: [] };
      sim.scene(c.kind === 'suspect' ? 'interrogation' : 'witness_room', ['detective', c.id]);
      narrate(sim, c.kind === 'suspect' ? `${c.name} is shown into the interrogation room and cautioned.` : `${c.name} takes a seat in the interview room.`);
      break;
    }
    case 'confer': {
      if (!['forensic', 'prosecutor'].includes(a.to)) fail('You can confer with the forensic examiner or the prosecutor.');
      const text = clean(a.text); st.trial.confer++;
      say(sim, seat, 'question', text, { target: a.to });
      st.queue.unshift({ seat: a.to, purpose: 'confer_reply', data: { question: text, byName } });
      break;
    }
    case 'submit_report': {
      if (st.leadsDone.length < 3 && st.hoursLeft > 4 && Object.keys(sim.b.leads).some((l) => leadAvailable(sim, l) && sim.b.leads[l].hours <= st.hoursLeft)) fail('It is far too early to close the investigation: follow more leads first.');
      const rec = sim.b.characters[a.recommended]?.kind === 'suspect' ? a.recommended : null;
      st.report = { recommended: rec, summary: clean(a.summary, 1200) };
      sim.scene('office', ['detective', 'prosecutor']);
      say(sim, seat, 'report', st.report.summary, { target: 'prosecutor', data: { recommended: rec }, highlight: 'report' });
      const ap = apparent(sim, sim.discovered(), st.investigatorFacts), rank = Object.entries(ap).map(([k, v]) => [k, supportOf(v)] as const).sort((x, y) => y[1] - x[1]);
      const mine = rec ? supportOf(ap[rec]) : 0, top = rank[0]?.[1] || 0;
      if (rec && mine >= top - 0.01 && mine >= 6) sim.score(seat, 'reasoning', 6, 'Recommendation follows the weight of the evidence gathered');
      else if (rec && mine < top - 2) sim.score(seat, 'reasoning', -4, 'Recommended a suspect against the weight of the evidence in hand');
      else if (!rec && top >= 9) sim.score(seat, 'reasoning', -3, 'Declined to recommend anyone despite a substantial case');
      const total = Object.keys(sim.b.evidence).length;
      sim.score(seat, 'discovery', Math.round((sim.discovered().length / total) * 6), `Recovered ${sim.discovered().length} of the available exhibits`);
      sim.score(seat, 'accuracy', rec === sim.b.truth.culprit ? 10 : -5, rec === sim.b.truth.culprit ? 'Identified the person actually responsible' : 'Did not identify the person actually responsible', true);
      st.jobs = [];
      enterPhase(sim, 'charging');
      break;
    }
  }
}

function answer(sim: Sim, seat: string, a: any, d: any) {
  const st = sim.st, ch = seat, rtc = st.chars[ch], inCourt = !!st.sub.exam;
  const known = (f: string) => !!sim.b.facts[f]?.knownBy[ch];
  const reveals = ids(a.reveals).filter(known), denies = ids(a.denies).filter((f) => known(f) && !reveals.includes(f));
  say(sim, seat, 'answer', clean(a.text), { target: d.by, data: { underOath: inCourt } });
  for (const f of reveals) {
    const k = sim.b.facts[f].knownBy[ch], first = !rtc.revealed.includes(f);
    if (first) rtc.revealed.push(f);
    if (rtc.denied.includes(f) && first) { sim.score(ch, 'honesty', 2, 'Withdrew an earlier false account'); sim.emit('admission', { seat, text: `${sim.nameOf(seat)} changes their account.`, data: { topic: sim.b.facts[f].topic }, aud: st.sub.exam ? ['trial'] : ['inv', ch], highlight: 'admission', ms: 2600 }); rtc.denied = rtc.denied.filter((x) => x !== f); }
    if (learnFact(sim, f, sim.nameOf(seat)) && d.by) sim.score(d.by, 'discovery', k.stance === 'open' ? 1 : 4, k.stance === 'open' ? `Obtained an account from ${sim.nameOf(seat)}` : `Drew a guarded fact out of ${sim.nameOf(seat)}`);
    if (inCourt && !st.trial.testimony.some((x) => x.fact === f && x.witness === ch)) { st.trial.testimony.push({ fact: f, witness: ch }); sim.emit('testimony', { seat, data: { fact: f, text: sim.b.facts[f].text }, aud: ['trial'], ms: 0 }); }
    for (const s of INV) sim.remember(s, `${sim.nameOf(seat)} stated: ${sim.b.facts[f].text}`);
  }
  for (const f of denies) {
    if (rtc.caught.includes(f)) { sim.score(ch, 'credibility', -3, 'Persisted in an account already contradicted by the evidence'); rtc.credibility = Math.max(0, rtc.credibility - 6); continue; }
    if (!rtc.denied.includes(f)) rtc.denied.push(f);
    // If the contradicting material is already in front of them, the lie is exposed on the spot.
    const shown = (sim.b.facts[f].contradictedBy || []).find((c) => rtc.shown.includes(c) || (sim.b.analyses[c] && rtc.shown.includes(sim.b.analyses[c].evidenceId) && sim.holds(c)));
    if (shown) exposeLie(sim, null, ch, f, shown);
  }
  if (reveals.length && !denies.length && rtc.credibility < 100) rtc.credibility = Math.min(100, rtc.credibility + 2);
  announceLeads(sim);
}

/** A procedurally safe default for when an agent cannot produce a valid action. Never content-bearing. */
export function safeDefault(sim: Sim, turn: Turn): AgentDecision | null {
  const o = describe(sim, turn).options.map((x) => x.type);
  for (const t of ['no_objection', 'no_motions', 'no_further_questions', 'end_interview', 'wait', 'rest']) if (o.includes(t)) return { thought: '(no valid action produced; procedural default)', action: { type: t } };
  const spec = describe(sim, turn), lead = spec.options.find((x) => x.type === 'pursue_lead')?.choices?.leadId?.[0];
  if (lead) return { thought: '(no valid action produced; procedural default)', action: { type: 'pursue_lead', leadId: lead.id } };
  if (o.includes('submit_report')) return { thought: '(procedural default)', action: { type: 'submit_report', recommended: null, summary: 'The investigation is closed without a recommendation.' } };
  return null;
}
