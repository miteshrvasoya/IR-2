// The Local Reasoner: an offline, non-LLM mind for house agents and the failover when a provider is down.
//
// It receives exactly the same AgentView an LLM would (nothing more), reasons over it — weighing the
// apparent significance of evidence, tracking each interviewee's denials against the exhibits in hand,
// planning which leads / witnesses / exhibits serve its role's objective — and proposes one action.
// Language is composed from the material in the view through the agent's personality. There is no
// per-case dialogue here and no access to the sealed truth: a reasoner that follows weak evidence
// reaches the wrong conclusion, and does.
import type { AgentView } from '../views.ts';
import type { AgentDecision, EvidenceView } from '../../shared/types.ts';
import { detectObjections, GROUND_LABEL } from '../legal.ts';

type Rng = () => number;
function rngFor(v: AgentView): Rng {
  let h = 2166136261;
  for (const c of `${v.sessionId}|${v.me.seat}|${v.turn}|${v.purpose}`) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return () => { h = Math.imul(h ^ (h >>> 15), h | 1); h ^= h + Math.imul(h ^ (h >>> 7), h | 61); return ((h ^ (h >>> 14)) >>> 0) / 4294967296; };
}
const pick = <T>(r: Rng, a: T[]): T => a[Math.floor(r() * a.length)];
const W: Record<string, number> = { weak: 1, moderate: 2, strong: 3 };
const short = (s: string, n = 150) => (s.length > n ? s.slice(0, n).replace(/[,;:]?\s+\S*$/, '') + '…' : s);
const lc = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);
const strip = (s: string) => s.replace(/[.\s]+$/, '');
const surname = (n: string) => n.replace(/^(Dr\.|Mr\.|Ms\.|Det\.|Hon\.)\s+/, '');

interface Tally { id: string; name: string; motive: number; opportunity: number; identity: number; exculp: number; total: number; notes: Record<string, { note: string; w: number; src: string }[]> }

/** How strongly does the material in this view APPEAR to implicate each suspect? */
function weigh(v: AgentView, evidence: EvidenceView[], facts: AgentView['facts'], skeptic = 0): Tally[] {
  const out: Record<string, Tally> = {};
  for (const s of v.suspects) out[s.id] = { id: s.id, name: s.name, motive: 0, opportunity: 0, identity: 0, exculp: 0, total: 0, notes: {} };
  const add = (p: any, mult: number, src: string) => {
    const t = out[p.suspect]; if (!t) return;
    const w = W[p.strength] * mult, el = p.exculpatory ? 'exculp' : p.element === 'means' ? 'identity' : p.element;
    (t as any)[el] += w; (t.notes[el] ||= []).push({ note: p.note, w, src });
  };
  for (const e of evidence) {
    if (e.status === 'suppressed' || e.status === 'excluded') continue;
    const mult = e.limitations.length ? 1 - skeptic * 0.45 : 1;
    for (const p of e.points) add(p, p.exculpatory ? 1 : mult, e.id);
  }
  for (const f of facts) for (const p of f.points) add(p, 1, f.id);
  for (const t of Object.values(out)) { t.total = Math.min(6, t.motive) + Math.min(6, t.opportunity) + Math.min(6, t.identity) - 1.5 * t.exculp; for (const k of Object.keys(t.notes)) t.notes[k].sort((a, b) => b.w - a.w); }
  return Object.values(out).sort((a, b) => b.total - a.total);
}
const best = (t: Tally, el: string) => t.notes[el]?.[0];
const missing = (t: Tally) => ['motive', 'opportunity', 'identity'].filter((e) => (t as any)[e] < 2).map((e) => (e === 'identity' ? 'a physical link' : e));

function topicLabel(v: AgentView, topic: string) {
  const l = (v as any).topicLabels?.[topic]; if (l) return l;
  const [a, b] = topic.split('.'); const p = v.people.find((x) => x.id === a);
  return p ? `${p.name}'s ${b}` : `the ${a} ${b}`;
}

export function heuristicDecide(v: AgentView): AgentDecision {
  const r = rngFor(v), T = v.me.traits, role = v.me.role;
  const has = (t: string) => v.options.some((o) => o.type === t);
  const choices = (t: string, p: string) => v.options.find((o) => o.type === t)?.choices?.[p] || [];
  const victim = surname(v.victim.name);
  const ranks = weigh(v, v.evidence, v.facts, T.skepticism);
  const top = ranks[0], second = ranks[1];
  const theory = top && top.total > 1 ? { suspect: top.id, confidence: Math.max(0.1, Math.min(0.95, (top.total - (second?.total || 0)) / 10 + top.total / 24)), summary: `${top.name}: ${Object.values(top.notes).flat().slice(0, 3).map((n) => n.note).join(' ')}` } : { suspect: null, confidence: 0.1, summary: 'Nothing yet points firmly at anyone.' };
  const done = (action: any, thought: string, th: any = ['detective', 'prosecutor'].includes(role) ? theory : undefined): AgentDecision => ({ thought, action, theory: th });
  const say = (text: string, thought = '') => done({ type: 'speak', text }, thought);
  const quip = (s: string) => (T.humor > 0.6 && r() < 0.3 ? ' ' + s : '');
  const names = v.suspects.map((s) => s.name);

  switch (v.purpose) {
    // ------------------------------------------------------------------ briefing
    case 'brief': {
      if (role === 'detective') return say(T.rigor > 0.6
        ? `${v.victim.name} left the hall alive and was found dead a little over an hour later. I want that hour accounted for by records before I listen to anyone's version of it: doors, cameras, the scene itself. ${names.join(', ')} — three people with a quarrel is three stories to test, not three suspects. Nobody is the answer yet.`
        : `Somebody in that building wanted ${victim} gone, and I've got three names: ${names.join(', ')}. I'll walk the scene, then I want them in a room one at a time while their stories are still warm. People crack before paperwork does.`, 'Set out how I intend to run this.');
      if (role === 'forensic') return say(T.drama > 0.5
        ? `Before anyone says "fall", let me read the floor. A stumble and a shove write completely different geometry — where he landed, how far out, what he was holding. Get me the scene untouched, his clothes, his hands, and anything electronic. The body will tell us which story is true.`
        : `I'll say this once: "he fell" is a conclusion, not an observation. I need the body position documented, the post-mortem ordered, and every exhibit sealed with continuity. Send me what you find and I'll tell you what it shows — and what it doesn't.`, 'Flag the accident assumption.');
      return say(T.rigor > 0.6
        ? `For a charge I need three things pointing at one person: a motive, the opportunity, and something physical that ties them to that gantry. A quarrel is not a case. And if you go into anyone's private space, you bring me a warrant first — I will not lose an exhibit to a suppression motion.`
        : `Bring me a story a jury can feel: who wanted ${victim} dead, who was close enough to do it, and one exhibit I can hold up in closing. Get me that and I'll do the rest.`, 'Tell the team what a charge needs.');
    }

    // ------------------------------------------------------------------ investigation
    case 'investigate': {
      const leads = choices('pursue_lead', 'leadId'), an = choices('request_analysis', 'analysisId'), people = choices('interview', 'characterId');
      const inv = v.investigation!, fixated = T.rigor < 0.6 && top && top.total >= 4 && top.total - (second?.total || 0) >= 1.5;
      const cands: { u: number; act: any; why: string }[] = [];
      for (const a of an) cands.push({ u: 9 + r(), act: { type: 'request_analysis', analysisId: a.id }, why: `The lab can work on "${a.label}" while I carry on.` });
      for (const l of leads) {
        const priv = /PRIVATE SPACE/.test(l.label), status = /warrant: (\w+)/.exec(l.label)?.[1];
        let u = 6 + r() * 2.5 + (/scene|Examine|Recover|post-mortem/i.test(l.label) && inv.leadsDone.length < 3 ? 2.5 : 0);
        if (fixated && new RegExp(surname(top.name).split(' ').pop()!, 'i').test(l.label)) u += 3;
        if (priv && status === 'not') {
          if (has('request_warrant') && (T.rigor > 0.5 || r() < 0.4)) { cands.push({ u: u + 0.5, act: { type: 'request_warrant', leadId: l.id, justification: warrantGrounds(v, top) }, why: 'A private space: I want judicial authority before I go in.' }); continue; }
          u -= 1; // going in without one
        }
        if (priv && status === 'denied') u = T.rigor > 0.6 ? 0 : 3.5;
        cands.push({ u, act: { type: 'pursue_lead', leadId: l.id }, why: `Next: ${short(l.label, 80)}` });
      }
      for (const p of people) {
        const st = inv.interviews[p.id], person = v.people.find((x) => x.id === p.id)!;
        const fresh = v.evidence.filter((e) => e.relevantTo.includes(p.id) || e.topics.some((t) => st.denied.includes(t))).length;
        let u = st.count === 0 ? 5.5 + T.aggression * 2.5 + (person.kind === 'witness' ? 1 : 0) + (inv.leadsDone.length >= 2 ? 1 : -2) : (st.denied.length > st.caught.length && fresh >= 2 ? 5 + T.aggression : 0);
        if (st.count >= 2) u = 0;
        if (fixated && p.id === top.id) u += 2.5; if (fixated && person.kind === 'suspect' && p.id !== top.id && st.count) u = 0;
        if (u > 0) cands.push({ u: u + r() * 2, act: { type: 'interview', characterId: p.id }, why: `Time to hear from ${person.name}.` });
      }
      if (has('confer') && inv.leadsDone.length >= 5 && !v.transcript.some((x) => x.kind === 'reply') && r() < 0.5) cands.push({ u: 6.5, act: { type: 'confer', to: 'prosecutor', text: top && top.total > 3 ? `If I brought you ${top.name} today, what would you still be missing?` : `Nothing points cleanly at anyone yet. What would you need to see before you would charge at all?` }, why: 'Check what the prosecutor needs before I spend the remaining hours.' });
      cands.sort((a, b) => b.u - a.u);
      const enough = top && top.total >= 6 + T.rigor * 7 && missing(top).length === 0;
      const b = cands[0];
      if (b && b.u >= 3 && !(enough && !an.length && inv.pendingLab.length === 0 && T.rigor < 0.7)) return done(b.act, b.why);
      if (has('wait') && inv.pendingLab.length) return done({ type: 'wait' }, 'Nothing more I can usefully do until the lab reports.');
      return done({ type: 'submit_report', recommended: top && top.total >= 5 ? top.id : null, summary: reportText(v, ranks) }, 'I have what the hours allow. Time to put it in front of the prosecutor.');
    }
    case 'interview_ask': {
      const c = v.context, subj = c.subject, n = c.askedSoFar.length, st = v.investigation!.interviews[subj.id];
      const held: EvidenceView[] = v.evidence.filter((e) => !c.alreadyShown.includes(e.id));
      const deniedTopics: string[] = c.theirDenialsSoFar.map((d: any) => d.topic);
      // 1. A denial I can test against something in my hands — the core move.
      const hit = held.find((e) => e.topics.some((t) => deniedTopics.includes(t) && !c.caughtOutOn.includes(t)));
      if (hit) {
        const d = c.theirDenialsSoFar.find((x: any) => hit.topics.includes(x.topic));
        return done({ type: 'ask', present: hit.id, topic: d.topic, text: pick(r, [`You told me: "${short(d.said, 110)}" This is the ${lc(hit.title)}. ${short(hit.description, 160)} Which of the two is wrong?`, `Let's go back to something. "${short(d.said, 100)}" — your words. Now look at the ${lc(hit.title)}. Take your time, and then explain it to me.`]) }, `Their account on ${d.topic} doesn't sit with ${hit.id}. Put it to them.`);
      }
      const witnessFact = v.facts.find((f) => deniedTopics.includes(f.topic) && !c.caughtOutOn.includes(f.topic) && !st.revealed.includes(f.id) && !c.askedSoFar.some((q: string) => q.includes(short(f.text, 40))));
      if (witnessFact && n >= 1) return done({ type: 'ask', present: witnessFact.id, topic: witnessFact.topic, text: `Someone else has told me this: ${short(witnessFact.text, 170)} That is not what you told me. Would you like to try again?` }, 'A witness account contradicts them.');
      if (n === 0 && st.count <= 1) return done({ type: 'ask', topic: `${subj.id}.whereabouts`, text: pick(r, [`Take me through your evening from the moment ${victim} left the hall until the alarm was raised. Where were you, and who can confirm it?`, `Start with the simple part. Between half past ten and midnight — where were you, exactly?`]) }, 'Open account first; pin them to a version.');
      // 2. Exhibits that bear on this person and have not been put to them yet.
      const rel = held.find((e) => e.relevantTo.includes(subj.id) && e.points.some((p) => p.suspect === subj.id && !p.exculpatory));
      if (rel && n >= 1 && (T.aggression > 0.35 || n >= 2)) return done({ type: 'ask', present: rel.id, topic: rel.topics[0], text: `I want to show you something: the ${lc(rel.title)}. ${short(rel.points.find((p) => p.suspect === subj.id)!.note, 140)} What do you say to that?` }, `Test them with ${rel.id}.`);
      const probes = [
        { k: 'relationship', q: `How were things between you and ${victim} — that day in particular?` },
        { k: 'observations', q: `Who else did you see or hear near the dome that night? Anything at all, however small.` },
        { k: 'observations2', q: subj.kind === 'witness' ? `You know that building. Who could get into the dome after hours, and how?` : `If it wasn't you, help me: who had a reason, and who had the means to get in there?` },
      ].filter((p) => !c.askedSoFar.some((q: string) => q.startsWith(p.q.slice(0, 22))));
      if (c.caughtOutOn.length && !c.askedSoFar.some((q: string) => /really happened/.test(q))) return done({ type: 'ask', topic: c.caughtOutOn[0], text: `The records have already caught you out once. So I'll ask plainly, and I suggest you think before you answer: what really happened?` }, 'They have been caught lying; press now.');
      if (probes.length && n < 4) return done({ type: 'ask', topic: probes[0].k.replace('2', ''), text: probes[0].q }, 'Widen the picture.');
      return done({ type: 'end_interview' }, 'Nothing more to gain from this sitting.');
    }

    // ------------------------------------------------------------------ being questioned
    case 'answer': return answer(v, r);
    case 'testify': {
      const c = v.context, ex = v.evidence.find((e) => e.id === c.exhibit) || v.evidence.find((e) => c.question.toLowerCase().includes(e.title.toLowerCase().slice(0, 14)));
      const cross = /isn't|correct\?|right\?|cannot|could|possible|agree/i.test(c.question);
      if (role === 'forensic') {
        if (ex) {
          const rep = ex.analyses.filter((a) => a.status === 'done').map((a) => a.report).join(' ');
          if (cross && ex.limitations.length) return say(`${T.rigor > 0.6 ? 'That is a fair point and I accept it.' : 'I would put it less strongly, but yes.'} ${ex.limitations.map((l) => l.text).join(' ')} ${rep ? 'My finding stands as far as it goes; it goes no further than that.' : ''}`, 'Concede the real limitation.');
          return say(rep ? `I examined the ${lc(ex.title)} myself. ${rep}${ex.limitations.length && T.rigor > 0.7 ? ` I should add the limits: ${lc(ex.limitations[0].text)}` : ''}` : `The ${lc(ex.title)}: ${ex.description} No laboratory analysis was requested on it, so I can speak only to what it is, not to what it means.`, 'Report the finding as found.');
        }
        const doneAn = v.evidence.flatMap((e) => e.analyses.filter((a) => a.status === 'done').map((a) => `${e.title}: ${a.report}`));
        return say(doneAn.length ? `In summary of the laboratory work: ${short(doneAn.slice(0, 2).join(' '), 420)}` : 'I was not asked to analyse anything bearing on that, so I cannot help the court.', 'Summarise the lab work.');
      }
      const inv = v.investigation!, caught = Object.entries(inv.interviews).filter(([, s]) => s.caught.length);
      if (ex) return say(`I recovered the ${lc(ex.title)}. ${ex.collection} ${cross && ex.limitations.length ? `And yes — ${lc(ex.limitations[0].text)}` : short(ex.description, 200)}`, 'Speak to how it was collected.');
      return say(caught.length ? `I interviewed everyone concerned. ${caught.map(([id, s]) => `${v.people.find((p) => p.id === id)!.name} gave me an account about ${s.caught.map((t) => topicLabel(v, t)).join(' and ')} that the records then contradicted`).join('; ')}. I followed the evidence where it went.` : `I interviewed those concerned and collected ${v.evidence.length} exhibits. I can only tell the court what the records show; I drew my conclusions from those.`, 'Give the investigator\'s account.');
    }
    case 'lab_report': {
      const c = v.context, ex = v.evidence.find((e) => c.exhibit.startsWith(e.id));
      const lead = T.drama > 0.5 ? pick(r, ['This one is worth sitting down for.', 'You will want to hear this.', 'The sample had a story in it.']) : pick(r, ['Result is back.', 'Report as follows.', 'My findings.']);
      const caveat = ex?.limitations.length ? ` The limit of it: ${lc(ex.limitations[ex.limitations.length - 1].text)}` : T.rigor > 0.7 ? ' That is what the material shows; it does not, on its own, tell you who.' : '';
      return done({ type: 'file_report', text: `${lead} ${c.benchFindings}${caveat}` }, 'Report what the bench work shows and where it stops.');
    }
    case 'confer_reply': {
      if (role === 'forensic') { const d = v.evidence.flatMap((e) => e.analyses.filter((a) => a.status === 'done').map(() => e)); return say(d.length ? `From what is back, the strongest physical material is the ${lc(d[d.length - 1].title)}. ${v.investigation!.pendingLab.length ? `Still on the bench: ${v.investigation!.pendingLab.join(', ')}.` : 'Nothing else is pending.'} Send me anything he touched or was touched by.` : `I have nothing analysed yet. Send me exhibits — the phone, the body, anything fibrous — and I can start giving you answers instead of opinions.`); }
      if (!top || top.total < 3) return say(`Right now I could not charge a parking offence. I need one person with motive, opportunity and a physical link — and I need it to survive cross-examination.`);
      const miss = missing(top);
      return say(miss.length ? `On ${top.name} I am still missing ${miss.join(' and ')}. ${second && second.total > top.total - 2 ? `And ${second.name} is not far behind, which a defense lawyer will enjoy.` : ''} Close that gap, lawfully, and I will file.` : `On ${top.name} the elements are there. What worries me is the other side's best point: ${top.notes.exculp?.[0]?.note || v.evidence.find((e) => e.limitations.length && e.points.some((p) => p.suspect === top.id))?.limitations[0].text || 'nothing obvious, which worries me more'}. Shore that up if you have hours left.`);
    }
    case 'warrant': {
      const mat: string[] = v.context.materialInSupport, need = T.rigor > 0.6 ? 2 : 1, ok = mat.length >= need && !(T.rigor < 0.6 && r() < 0.12);
      return done({ type: 'rule_warrant', granted: ok, reasoning: ok ? `Granted. ${mat.slice(0, 2).map((m) => short(m, 60)).join(' and ')} together give probable cause to believe evidence will be found there. The search is limited to that purpose.` : `Refused. ${mat.length ? `A single item — ${short(mat[0], 60)} — is suspicion, not probable cause.` : 'Nothing has been put before me beyond the officer\'s belief.'} Come back with more.` }, ok ? 'The application is supported.' : 'Not enough for a private space.');
    }

    // ------------------------------------------------------------------ charging & pre-trial
    case 'charge_decision': {
      const rec = v.context.report?.recommended, recT = ranks.find((x) => x.id === rec);
      let target = top;
      if (T.rigor < 0.6 && recT && recT.total >= 4) target = recT;                       // trusts the detective
      const miss = target ? missing(target) : ['everything'], bar = 5 + T.rigor * 4;
      if (!target || target.total < bar || (T.rigor > 0.7 && miss.length)) {
        if (has('request_more') && target && target.total >= 3) return done({ type: 'request_more', text: `I am not filing on this. Against ${target.name} I still lack ${miss.join(' and ') || 'enough weight'}. Use the hours you have left and bring it back.` }, 'Not provable yet; send it back.');
        if (!target || target.total < 4.5) return done({ type: 'decline', reason: `On this file I cannot prove a case against anyone beyond reasonable doubt${target ? `: the best of it points at ${target.name}, and it is missing ${miss.join(' and ') || 'weight'}` : ''}. I will not charge on suspicion.` }, 'Declining is the honest call.');
      }
      const murder = target!.motive >= 2;
      const el = (k: string, fallback: string) => strip(best(target!, k)?.note || fallback);
      return done({ type: 'charge', suspectId: target!.id, chargeId: murder ? 'murder' : 'manslaughter', theory: `I am charging ${target!.name}. ${murder ? `Motive: ${lc(el('motive', ''))}. ` : ''}Opportunity: ${lc(el('opportunity', 'present in the building at the time'))}. And the link to the act itself: ${lc(el('identity', 'the surrounding circumstances'))}.${rec && rec !== target!.id ? ` I note the detective recommended otherwise; the evidence, weighed as a jury will weigh it, does not.` : ''}` }, `The file supports ${target!.name}.`, { suspect: target!.id, confidence: 0.7, summary: theory.summary });
    }
    case 'arraign': return say(`This court is in session. ${v.record!.defendantName}, you are charged with ${lc(v.record!.charge || 'an offence')} in connection with the death of ${v.victim.name}. Counsel, how does the defendant plead?`);
    case 'plea': return done({ type: 'plea', plea: 'not_guilty', text: pick(r, ['Not guilty, Your Honour.', `My client pleads not guilty, Your Honour, and looks forward to hearing what the prosecution thinks it can prove.`]) }, 'Put them to proof.');
    case 'motions': {
      const can = choices('motion_suppress', 'evidenceId').map((c) => v.evidence.find((e) => e.id === c.id)!).filter(Boolean);
      const bad = can.find((e) => e.warrantless);
      if (bad) return done({ type: 'motion_suppress', evidenceId: bad.id, ground: 'unlawful_search', text: `Your Honour, the defense moves to suppress the ${lc(bad.title)}. The collection record says in terms that it was taken from a private space without a warrant. No exception has been suggested. It is the fruit of an unlawful search and the jury should never see it.` }, 'A warrantless search of a private space: this should go.');
      const hurt = can.filter((e) => e.limitations.length && e.points.some((p) => p.suspect === (v as any).client?.id && !p.exculpatory && p.strength !== 'weak'));
      if (hurt.length && T.aggression > 0.75 && r() < 0.45 && has('motion_suppress')) { const e = hurt[0]; return done({ type: 'motion_suppress', evidenceId: e.id, ground: e.limitations[0].ground === 'alternative_explanation' ? 'reliability' : e.limitations[0].ground, text: `The defense moves to exclude the ${lc(e.title)}. ${e.limitations[0].text} It is more prejudicial than probative.` }, 'Long shot, but worth making them defend it.'); }
      return done({ type: 'no_motions' }, 'Nothing here I can keep out lawfully.');
    }
    case 'motion_response': {
      const m = v.context.motion, e = v.evidence.find((x) => x.id === m.evidenceId)!;
      return say(e.warrantless ? (T.rigor > 0.7 ? `Your Honour, I cannot defend the manner of that search and I will not try. The prosecution's case does not depend on it.` : `Your Honour, the officers acted in good faith in an unfolding homicide inquiry, and the item would inevitably have been discovered. Suppression is a windfall the defendant has not earned.`) : `Your Honour, that complaint goes to weight, not admissibility. The exhibit was lawfully obtained and its continuity is documented. My friend may cross-examine on it to her heart's content.`);
    }
    case 'motion_ruling': {
      const m = v.context.motion, e = v.context.exhibit, should = !!e.warrantless && m.ground === 'unlawful_search', err = r() < (1 - T.rigor) * 0.25, g = err ? !should : should;
      return done({ type: 'rule', ruling: g ? 'granted' : 'denied', reasoning: g ? `The motion is granted. ${e.warrantless ? 'This was a private space and no warrant was sought. Good faith is not an exception to the requirement.' : 'I am not satisfied the exhibit is reliable enough to go before a jury.'} The ${lc(e.title)} is suppressed.` : `The motion is denied. ${e.warrantless ? 'In the circumstances of a homicide inquiry I find the search reasonable.' : 'Nothing in the manner of collection is unlawful; the point raised goes to weight, which is for the jury.'}` }, 'Rule on how the exhibit was actually obtained.');
    }

    // ------------------------------------------------------------------ trial
    case 'opening': {
      const d = v.record!, mine = ranks.find((x) => x.id === d.defendant)!;
      const usable = v.evidence.filter((e) => !['suppressed', 'excluded'].includes(e.status));
      if (role === 'prosecutor') {
        const ex = usable.filter((e) => e.points.some((p) => p.suspect === d.defendant && !p.exculpatory)).slice(0, 3).map((e) => `the ${lc(e.title)}`);
        return done({ type: 'statement', text: `Members of the jury, ${v.victim.name} did not simply fall. ${T.drama > 0.6 ? `Someone stood on that gantry with him, close enough to touch, and when it was over walked back to the party.` : `The evidence will show that another person was on that gantry with him.`} The prosecution says that person was ${d.defendantName}. ${best(mine, 'motive') ? `You will hear why: ${lc(strip(best(mine, 'motive')!.note))}. ` : ''}You will see ${ex.join(', ') || 'the exhibits'}. ${T.rigor > 0.6 ? 'I ask only that you follow the evidence, exhibit by exhibit, and hold me to my burden.' : 'And when you have seen it all, you will not be in any doubt.'}` }, 'Tell them what I will prove.');
      }
      const weak = usable.filter((e) => e.limitations.length && e.points.some((p) => p.suspect === d.defendant && !p.exculpatory))[0];
      const alt = ranks.find((x) => x.id !== d.defendant && x.total >= 3);
      return done({ type: 'statement', text: `Members of the jury, ${d.defendantName} sits there presumed innocent, and the prosecution's opening has not changed that by a hair. ${weak ? `Listen carefully when they show you the ${lc(weak.title)}, and ask what it actually proves: ${lc(weak.limitations[0].text)} ` : ''}${missing(mine).length ? `Notice what they never show you: ${missing(mine).join(', ')}. ` : ''}${alt ? `And ask yourselves why so little attention was paid to ${alt.name}. ` : ''}A suspicion, however confidently delivered, is not proof.${quip('Confidence is free; evidence costs extra.')}` }, 'Frame the doubt early.');
    }
    case 'case_in_chief': return caseInChief(v, r, ranks);
    case 'exhibit_response': {
      const e = v.context.exhibit;
      if (e.warrantless) return done({ type: 'object', ground: 'unlawful_search', text: `Objection, Your Honour. That exhibit came out of a private space with no warrant. It should not be before this jury.` }, 'Warrantless: object.');
      if (T.aggression > 0.8 && r() < 0.2) return done({ type: 'object', ground: 'foundation', text: `Objection — no foundation has been laid for this exhibit.` }, 'Make them work for it.');
      return done({ type: 'no_objection' }, 'No lawful ground to keep it out.');
    }
    case 'examine': return examine(v, r, ranks);
    case 'objection_window': {
      const c = v.context, cues = detectObjections(c.question, { stage: c.stage, witnessKind: /Dr\.|Inspector|Det\./.test(c.witness) ? 'expert' : 'lay', prior: c.earlierQuestions });
      if (cues.length && r() < 0.5 + 0.45 * T.rigor) return done({ type: 'object', ground: cues[0], text: pick(r, [`Objection, Your Honour — ${GROUND_LABEL[cues[0]]}.`, `Objection. ${GROUND_LABEL[cues[0]].replace(/^./, (x) => x.toUpperCase())}.`]) }, `That question is objectionable: ${cues[0]}.`);
      if (r() < T.aggression * 0.14) return done({ type: 'object', ground: 'relevance', text: `Objection — relevance. Where is this going?` }, 'Break their rhythm.');
      return done({ type: 'no_objection' }, 'The question is proper.');
    }
    case 'rule_objection': {
      const c = v.context, o = c.objection;
      const should = o.kind === 'exhibit' ? !!c.exhibit?.warrantless && o.ground === 'unlawful_search' : detectObjections(c.question, { stage: c.stage, witnessKind: c.witnessKind === 'lay' ? 'lay' : 'expert', prior: c.earlierQuestions }).includes(o.ground);
      const s = r() < (1 - T.rigor) * 0.25 ? !should : should;
      const why = o.kind === 'exhibit' ? (s ? 'No warrant was obtained for a private space. The exhibit is excluded.' : 'The exhibit was properly obtained. It is admitted.') : s ? pick(r, [`Sustained. Counsel, rephrase.`, `Sustained — that is ${GROUND_LABEL[o.ground]}. Move on.`]) : pick(r, [`Overruled. The witness may answer.`, `Overruled. I see nothing improper in the question.`]);
      return done({ type: 'rule', ruling: s ? 'sustained' : 'overruled', reasoning: why + (T.humor > 0.6 && !s && r() < 0.3 ? ' And counsel may wish to save objections for questions that deserve them.' : '') }, 'Apply the rule to the question as asked.');
    }
    case 'closing': {
      const d = v.record!, adm = d.exhibits.filter((e) => e.status === 'admitted'), mine = weigh(v, adm, d.testimony as any, 0).find((x) => x.id === d.defendant)!;
      if (role === 'prosecutor') {
        const cites = adm.filter((e) => e.points.some((p) => p.suspect === d.defendant && !p.exculpatory));
        const line = (k: string, label: string) => best(mine, k) ? `${label}: ${lc(strip(best(mine, k)!.note))}. ` : '';
        const attack = adm.filter((e) => e.points.some((p) => p.suspect === d.defendant && p.exculpatory) && e.limitations.length).map((e) => ({ evidenceId: e.id, ground: e.limitations[0].ground }));
        return done({ type: 'argue', cites: cites.map((e) => e.id), challenges: attack, text: `Members of the jury, set the speeches aside and count what is in evidence. ${line('motive', 'Motive')}${line('opportunity', 'Opportunity')}${line('identity', 'And the act itself')}${cites.length ? `That is ${cites.length} exhibit${cites.length > 1 ? 's' : ''}, each pointing the same way. ` : ''}${d.testimony.length ? `You heard it from the witness box as well. ` : ''}${T.drama > 0.6 ? `The defense offers you coincidence upon coincidence. ${victim} deserves better than coincidence.` : `Each piece has an innocent explanation if you take it alone. Taken together, there is only one.`} ${missing(mine).length ? '' : 'Every element is proved. '}I ask you to return a verdict of guilty.` }, 'Tie each element to the record.');
      }
      const weakE = adm.filter((e) => e.limitations.length && e.points.some((p) => p.suspect === d.defendant && !p.exculpatory)).slice(0, 4);
      const all = weigh(v, adm, d.testimony as any, 0), alt = all.find((x) => x.id !== d.defendant && x.total >= 3);
      const helpful = adm.filter((e) => e.points.some((p) => p.suspect === d.defendant && p.exculpatory));
      return done({ type: 'argue', cites: helpful.map((e) => e.id), challenges: weakE.map((e) => ({ evidenceId: e.id, ground: e.limitations[0].ground })), alternativeSuspect: alt?.id, text: `Members of the jury, the question is not whether ${d.defendantName} could have done this. It is whether the prosecution has made you sure. ${weakE.map((e) => `The ${lc(e.title)}: ${lc(e.limitations[0].text)}`).join(' ')} ${helpful.length ? `Against all that stands the ${lc(helpful[0].title)}: ${lc(strip(helpful[0].points.find((p) => p.exculpatory)!.note))}. ` : ''}${missing(mine).length ? `And where, in all of it, is ${missing(mine).join(' or ')}? ` : ''}${alt ? `Meanwhile the evidence about ${alt.name} — ${lc(strip(Object.values(alt.notes).flat()[0].note))} — was never answered. ` : ''}${T.drama > 0.6 ? 'If you have to squint to see guilt, that squint is reasonable doubt.' : 'Each of those gaps is a reasonable doubt, and the law says what you do with a reasonable doubt.'} Not guilty.` }, 'Name every doubt the record supports.');
    }
    case 'instruct': return say(`Members of the jury. The defendant is presumed innocent. The burden is on the prosecution and never moves. ${v.standard} What counsel said is not evidence. You will now retire.`);
    case 'deliberate': return deliberate(v, r);
    case 'judgment': { const k = v.context.outcome; return say(k === 'convicted' ? `The verdict of the jury is recorded. ${v.record!.defendantName}, you stand convicted. I thank the jury for their care.` : k === 'acquitted' ? `The verdict is recorded. ${v.record!.defendantName}, you are acquitted and free to go. The jury has my thanks.` : `The jury being unable to agree, I declare a mistrial. ${v.record!.defendantName} is released. Whether to try this case again is a matter for the prosecution.${quip('I would suggest they bring more evidence next time.')}`); }
    case 'sentence': return say(`${v.record!.defendantName}, a man is dead and a jury has found that you are responsible. ${v.record!.charge === 'Murder' ? 'For murder the sentence is life imprisonment; I set the minimum term at eighteen years.' : 'For manslaughter I sentence you to nine years\' imprisonment.'} The breach of trust involved, and the steps taken afterwards to conceal it, are aggravating features. Take the defendant down.`);
  }
  // Unknown purpose: do nothing harmful.
  return done({ type: v.options[0]?.type || 'speak', text: '…' }, 'No plan for this situation.');

  function warrantGrounds(v: AgentView, t?: Tally) {
    const ev = v.evidence.filter((e) => e.points.some((p) => !t || p.suspect === t.id)).slice(0, 3);
    return ev.length ? `I hold ${ev.map((e) => `the ${lc(e.title)} (${lc(strip(e.points[0].note))})`).join(', and ')}. On that I believe further evidence is in that space, and I ask for authority to search it.` : `I believe evidence relevant to the death is held there and ask for authority to search.`;
  }
}

function reportText(v: AgentView, ranks: Tally[]): string {
  const t = ranks[0], rest = ranks.slice(1);
  if (!t || t.total < 5) return `I cannot recommend a charge. ${t ? `The most that can be said is that ${t.name} has questions to answer (${Object.values(t.notes).flat().slice(0, 2).map((n) => lc(strip(n.note))).join('; ')}), but I am missing ${missing(t).join(' and ') || 'weight'}.` : 'Nothing recovered points at anyone.'} ${v.investigation!.hoursLeft <= 1 ? 'I ran out of hours.' : ''}`;
  const el = (k: string, label: string) => best(t, k) ? `${label}: ${lc(strip(best(t, k)!.note))} [${best(t, k)!.src}]. ` : `${label}: not established. `;
  const others = rest.map((o) => o.notes.exculp?.length ? `${o.name} is answered by ${o.notes.exculp[0].src} (${lc(strip(o.notes.exculp[0].note))})` : o.total >= 3 ? `${o.name} is not eliminated` : `nothing of weight against ${o.name}`).join('; ');
  const weak = v.evidence.find((e) => e.limitations.length && e.points.some((p) => p.suspect === t.id && !p.exculpatory));
  return `I recommend charging ${t.name}. ${el('motive', 'Motive')}${el('opportunity', 'Opportunity')}${el('identity', 'Link to the act')}As to the others: ${others}. ${weak ? `The defense will say of the ${lc(weak.title)}: ${lc(weak.limitations[0].text)}` : ''}`;
}

// ---------- a character under questioning ----------
function answer(v: AgentView, r: Rng): AgentDecision {
  const ch = v.character!, c = v.context, T = v.me.traits, q: string = c.question.toLowerCase();
  const me = ch.id, presented = c.presented ? v.evidence.find((e) => e.id === c.presented.id) : null;
  const selfish = (k: typeof ch.knowledge[0]) => k.topic.startsWith(me + '.') || k.text.includes(surname(ch.name));
  const rel = (k: typeof ch.knowledge[0]) => {
    let s = 0;
    if (c.topic && (k.topic === c.topic || (c.topic === 'whereabouts' && k.topic.endsWith('.whereabouts') && k.topic.startsWith(me)))) s += 4;
    if (c.topic === 'observations' && !selfish(k)) s += 3;
    if (c.topic === 'relationship' && selfish(k) && !k.topic.endsWith('whereabouts')) s += 3;
    if (presented?.topics.includes(k.topic)) s += 4;
    if (c.presented && !presented && c.presented.label.includes(k.text.slice(0, 30))) s += 2;
    const words = k.text.toLowerCase().replace(/[^a-z0-9: ]/g, ' ').split(/\s+/).filter((w) => w.length > 4);
    s += Math.min(3, words.filter((w) => q.includes(w)).length);
    if (/really happened|truth/.test(q) && k.caught) s += 5;
    if (/where were you|your evening|movements|whereabouts/.test(q) && k.topic === `${me}.whereabouts`) s += 4;
    if (/see or hear|saw|heard|anyone else|who else|notice/.test(q) && !selfish(k)) s += 3;
    if (/between you and|relationship|get on|quarrel|argu|terms/.test(q) && selfish(k) && !k.topic.endsWith('whereabouts')) s += 3;
    return s;
  };
  const cand = ch.knowledge.map((k) => ({ k, s: rel(k) })).filter((x) => x.s >= 3).sort((a, b) => b.s - a.s).slice(0, 2);
  const reveals: string[] = [], denies: string[] = [], parts: string[] = [];
  const firm = (k: any) => k.firmness ?? 2;
  const leadIn = (k: any) => v.me.style === 'nervous' ? pick(r, ['Okay. Okay — look.', 'All right, fine, I should have said.', 'I — yes. Sorry.']) : T.aggression > 0.6 ? pick(r, ['Fine. If it gets me out of this room.', 'Very well, since you insist.']) : k.stance === 'open' ? pick(r, ['Yes.', 'I can tell you that.', 'Certainly.', '']) : pick(r, ['All right. I will tell you.', 'Very well.', 'I had hoped not to get into this.']);
  for (const { k } of cand) {
    const shownYield = !!presented && k.yieldsTo.some((y) => y === presented.title || presented.analyses.some((a) => a.label === y && a.status === 'done'));
    let give: boolean;
    if (k.revealed) give = true;
    else if (k.stance === 'open') give = true;
    else if (k.stance === 'guarded') give = ch.pressure >= firm(k) * 1.2 || shownYield || k.caught || (ch.sworn && T.rigor > 0.5);
    else give = (k.caught && ch.pressure >= firm(k) * 2.4) || (shownYield && ch.pressure >= firm(k) * 2);
    if (give) { reveals.push(k.factId); parts.push(`${k.revealed ? '' : leadIn(k)} ${k.say || k.text}`.trim()); }
    else { denies.push(k.factId); parts.push(k.caught ? pick(r, [`I have told you what I know. ${k.cover}`, `You can show me whatever you like. ${k.cover}`, `I am not going to change my answer because a printout disagrees with me. ${k.cover}`]) : k.cover!); }
  }
  let text = parts.join(' ');
  if (!cand.length) text = presented ? pick(r, [`I don't know what you expect me to say about that. It has nothing to do with me.`, `I have never seen that before, and I cannot tell you anything about it.`]) : v.me.style === 'chatty' ? `Honestly? I couldn't tell you. I'd love to help — I would — but that's not something I saw.` : pick(r, [`I can't help you with that.`, `I don't know anything about that.`, `That is not something I have any knowledge of.`]);
  else if (denies.length && !reveals.length && ch.pressure > 4 && T.aggression > 0.5 && r() < 0.5) text += pick(r, [' Are we finished?', ' I would like to know why you are asking me and not the people who actually quarrelled with him.', ' If you are going to accuse me, do it properly.']);
  else if (v.me.style === 'nervous' && denies.length && r() < 0.5) text += ' That is — that is the truth.';
  return { thought: denies.length ? `Hold the line on ${denies.join(', ')}; pressure is ${ch.pressure}.` : reveals.length ? `Nothing to gain by hiding ${reveals.join(', ')}.` : 'This does not touch what I know.', action: { type: 'answer', text, reveals, denies } };
}

// ---------- counsel presenting a case ----------
function caseInChief(v: AgentView, r: Rng, ranks: Tally[]): AgentDecision {
  const d = v.record!, T = v.me.traits, pros = v.me.role === 'prosecutor', def = d.defendant!;
  const offer = (v.options.find((o) => o.type === 'offer_exhibit')?.choices?.evidenceId || []).map((c) => v.evidence.find((e) => e.id === c.id)!).filter(Boolean);
  const callable = v.options.find((o) => o.type === 'call_witness')?.choices?.seatId || [];
  const called = d.witnessesCalled[v.me.seat] || [], admitted = d.exhibits.filter((e) => e.status === 'admitted');
  const alt = ranks.find((x) => x.id !== def && x.total >= 3);
  const value = (e: EvidenceView) => e.points.reduce((n, p) => n + (pros ? (p.suspect === def && !p.exculpatory ? W[p.strength] : 0) : (p.suspect === def && p.exculpatory ? W[p.strength] * 1.5 : 0) + (alt && p.suspect === alt.id && !p.exculpatory ? W[p.strength] * 0.8 : 0)), 0);
  const worth = offer.map((e) => ({ e, u: value(e) + (pros && !e.points.length && admitted.length < 2 ? 1.2 : 0) - (e.warrantless && T.rigor > 0.7 ? 9 : 0) })).filter((x) => x.u > 0.9).sort((a, b) => b.u - a.u);
  const mineCount = admitted.filter((e) => value(e) > 0 || !e.points.length).length;
  const say = (act: any, th: string): AgentDecision => ({ thought: th, action: act });
  if (worth.length && (mineCount < 3 || (called.length >= 1 && mineCount < 7))) {
    const e = worth[0].e, p = e.points.find((x) => (pros ? x.suspect === def && !x.exculpatory : x.exculpatory || (alt && x.suspect === alt.id)));
    return say({ type: 'offer_exhibit', evidenceId: e.id, purpose: p ? `It goes to ${p.exculpatory ? 'the defendant\'s account' : p.element}: ${lc(strip(p.note))}.` : 'It establishes how the deceased came by his death.' }, `Get ${e.id} in front of the jury.`);
  }
  // Witnesses: whoever has told investigators something that helps my side; the experts for my exhibits.
  const helps = (f: AgentView['facts'][0]) => f.points.some((p) => (pros ? p.suspect === def && !p.exculpatory : (p.suspect === def && p.exculpatory) || (alt && p.suspect === alt.id && !p.exculpatory)));
  const scoreW = (seat: string) => {
    const person = v.people.find((p) => p.id === seat);
    if (person) {
      const told: string[] = (v as any).told?.[seat] || [];
      const n = v.facts.filter((f) => told.includes(f.id) && helps(f)).length;
      if (seat === def) return !pros && T.empathy > 0.45 && r() < 0.4 ? 1.5 : 0;
      return n * 3;
    }
    if (seat === 'forensic') return admitted.some((e) => e.analyses.some((a) => a.status === 'done') && value(e) > 0) ? 2.5 : 0;
    if (seat === 'detective') return pros ? 1.2 : 0;
    return 0;
  };
  const w = callable.map((c) => ({ id: c.id, u: scoreW(c.id) })).filter((x) => x.u > 1).sort((a, b) => b.u - a.u)[0];
  if (w) return say({ type: 'call_witness', seatId: w.id }, `${w.id} can help my case from the witness box.`);
  if (worth.length && mineCount < 7) return say({ type: 'offer_exhibit', evidenceId: worth[0].e.id, purpose: 'It is relevant to the issues the jury must decide.' }, 'One more exhibit before I close.');
  return say({ type: 'rest' }, 'I have put in what helps; anything more only gives them targets.');
}

function examine(v: AgentView, r: Rng, ranks: Tally[]): AgentDecision {
  const c = v.context, d = v.record!, T = v.me.traits, pros = v.me.role === 'prosecutor', def = d.defendant!, w = c.witness, n = c.askedSoFar.length;
  const adm = d.exhibits.filter((e) => e.status === 'admitted');
  const out = (act: any, th: string): AgentDecision => ({ thought: th, action: act });
  const asked = (frag: string) => c.askedSoFar.some((q: string) => q.includes(frag));
  const alt = ranks.find((x) => x.id !== def && x.total >= 3);
  const helps = (p: any) => (pros ? p.suspect === def && !p.exculpatory : (p.suspect === def && p.exculpatory) || (alt && p.suspect === alt.id && !p.exculpatory));
  const hurts = (p: any) => (pros ? p.suspect === def && p.exculpatory : p.suspect === def && !p.exculpatory);
  const person = v.people.find((p) => p.id === w.seat);
  if (c.stage === 'direct') {
    if (person) {
      const told: string[] = c.witnessSaidBefore?.toldInvestigators || [];
      const useful = v.facts.filter((f) => told.includes(f.id) && f.points.some(helps) && !d.testimony.some((t) => t.id === f.id && t.witnessId === w.seat) && !asked(topicLabel(v, f.topic)));
      if (useful.length) {
        const f = useful[0], lab = topicLabel(v, f.topic);
        if (T.aggression > 0.7 && r() < 0.3) return out({ type: 'ask', topic: f.topic, text: `You know all about ${lab}, and you told the police exactly that, didn't you?` }, 'Hurry them to the point.');
        return out({ type: 'ask', topic: f.topic, text: pick(r, [`Please tell the jury, in your own words, what you know about ${lab}.`, `I want to ask you about ${lab}. What did you yourself see or hear?`]) }, `Bring out ${f.id} through this witness.`);
      }
      if (w.seat === def && n === 0) return out({ type: 'ask', topic: `${def}.whereabouts`, text: `Tell the jury, plainly, where you were when ${surname(v.victim.name)} died.` }, 'Let my client give their account.');
      if (n === 0) return out({ type: 'ask', topic: 'observations', text: `What did you see or hear that night that you think this jury should know?` }, 'Open question; see what they give.');
      return out({ type: 'no_further_questions' }, 'I have what I called them for.');
    }
    const ex = adm.filter((e) => e.points.some(helps) && !asked(e.title) && (w.seat === 'detective' || e.analyses.some((a) => a.status === 'done')))[0];
    if (ex) return out({ type: 'ask', exhibitId: ex.id, text: w.seat === 'forensic' ? `Doctor, you examined the ${lc(ex.title)}. What did your examination show?` : `Detective, how did you come by the ${lc(ex.title)}, and what did it tell you?` }, `Have the witness explain ${ex.id}.`);
    if (n === 0) return out({ type: 'ask', text: w.seat === 'forensic' ? `Would you summarise for the jury the laboratory work you carried out in this case?` : `Detective, would you summarise the course of your investigation for the jury?` }, 'Foundation.');
    return out({ type: 'no_further_questions' }, 'Enough.');
  }
  // ----- cross-examination -----
  if (person) {
    const den = c.witnessSaidBefore?.denied || [], caught: string[] = c.witnessSaidBefore?.caught || [];
    const imp = adm.find((e) => den.some((x: any) => e.topics.includes(x.topic) && !caught.includes(x.topic)) && !asked(e.title));
    if (imp) { const x = den.find((y: any) => imp.topics.includes(y.topic)); return out({ type: 'ask', exhibitId: imp.id, topic: x.topic, text: `You have said: "${short(x.said, 100)}" I am showing you the ${lc(imp.title)}, which is in evidence. Your account cannot be right, can it?` }, 'Impeach with an admitted exhibit.'); }
    const hurtful = d.testimony.filter((t) => t.witnessId === w.seat && t.points.some(hurts));
    if (hurtful.length && caught.length && !asked('changed your account')) return out({ type: 'ask', text: `This is not the first version of events you have given, is it? You changed your account once the records were put to you.` }, 'Attack credibility.');
    if (hurtful.length && !asked('certain')) return out({ type: 'ask', topic: hurtful[0].topic, text: T.aggression > 0.7 && r() < 0.35 ? `Come on — you expect this jury to believe you remember that to the minute?` : `How certain are you of the time, and of who it was that you saw? It was late, and you had been working all evening.` }, 'Shake the detail that hurts.');
    const givesMine = v.facts.find((f) => (c.witnessSaidBefore?.toldInvestigators || []).includes(f.id) && f.points.some(helps) && !d.testimony.some((t) => t.id === f.id) && !asked(topicLabel(v, f.topic)));
    if (givesMine) return out({ type: 'ask', topic: givesMine.topic, text: `You told the police something about ${topicLabel(v, givesMine.topic)} as well, did you not? Tell the jury.` }, 'This witness knows something that helps me.');
    return out({ type: 'no_further_questions' }, 'Nothing to gain; sit down.');
  }
  const target = adm.find((e) => e.points.some(hurts) && e.limitations.some((l) => !e.challenges.some((ch) => ch.by === v.me.seat && ch.ground === l.ground)) && !asked(e.title));
  if (target) { const l = target.limitations.find((x) => !target.challenges.some((ch) => ch.by === v.me.seat && ch.ground === x.ground))!; return out({ type: 'ask', exhibitId: target.id, challengeGround: l.ground, text: `${w.seat === 'forensic' ? 'Doctor' : 'Detective'}, the ${lc(target.title)}. ${l.text} That is right, is it not?` }, `Expose the weakness in ${target.id}: ${l.ground}.`); }
  return out({ type: 'no_further_questions' }, 'No further ground to make.');
}

// ---------- a juror weighing the admitted record ----------
function deliberate(v: AgentView, r: Rng): AgentDecision {
  const d = v.record!, T = v.me.traits, def = d.defendant!, me = v.me.seat, c = v.context;
  const G: Record<string, number> = { alternative_explanation: 0.6, reliability: 0.55, relevance: 0.3, chain_of_custody: 0.7, unlawful_search: 0.9, bias: 0.4 };
  const el = { motive: 0, opportunity: 0, identity: 0, exculp: 0 } as Record<string, number>;
  const notes: { text: string; w: number; id?: string }[] = [], doubts: string[] = [], key: string[] = [];
  for (const e of d.exhibits) {
    const lim = Math.max(0, ...e.limitations.map((l) => G[l.ground] || 0.4)) * (0.55 + 0.6 * T.skepticism);
    for (const p of e.points) if (p.suspect === def) {
      const w = W[p.strength] * (p.exculpatory ? 1 : 1 - Math.min(0.85, lim));
      el[p.exculpatory ? 'exculp' : p.element === 'means' ? 'identity' : p.element] += w;
      notes.push({ text: `the ${lc(e.title)} (${lc(strip(p.note))})`, w: p.exculpatory ? -w : w, id: e.id });
      if (!key.includes(e.id)) key.push(e.id);
    }
    if (e.limitations.length && e.points.some((p) => p.suspect === def && !p.exculpatory)) doubts.push(`the ${lc(e.title)} — ${lc(e.limitations[0].text)}`);
  }
  for (const t of d.testimony) for (const p of t.points) if (p.suspect === def) {
    const w = W[p.strength] * (t.witnessImpeached ? 0.5 : 1) * (0.8 + 0.4 * T.empathy);
    el[p.exculpatory ? 'exculp' : p.element === 'means' ? 'identity' : p.element] += w;
    notes.push({ text: `${t.witness}'s evidence (${lc(strip(p.note))})`, w: p.exculpatory ? -w : w });
    if (t.witnessImpeached) doubts.push(`${t.witness} was caught out on their own account`);
  }
  const alt = d.argued?.defense?.alt, needMotive = d.charge === 'Murder';
  const score = Math.min(6, el.motive) + Math.min(6, el.opportunity) + Math.min(6, el.identity) - 1.5 * el.exculp;
  const bar = 8 + 4.2 * T.skepticism + (alt ? 1.2 : 0);
  const gaps = [needMotive && el.motive < 2 ? 'motive' : '', el.opportunity < 2 ? 'opportunity' : '', el.identity < 2 ? 'anything tying the defendant to the act itself' : ''].filter(Boolean);
  let vote = score >= bar && !gaps.length ? 'guilty' : 'not_guilty';
  const prev = c.votesSoFar?.[me], others = Object.entries(c.votesSoFar || {}).filter(([k]) => k !== me).map(([, x]) => x as string);
  let moved = false;
  if (c.round > 1 && others.length && others.every((o) => o !== vote) && Math.abs(score - bar) < 1.2 + 1.6 * T.empathy && !(vote === 'not_guilty' && gaps.length && T.rigor > 0.8)) { vote = others[0]; moved = prev !== vote; }
  notes.sort((a, b) => b.w - a.w);
  const strong = notes.filter((n) => n.w > 0).slice(0, 2).map((n) => n.text), helpD = notes.filter((n) => n.w < 0).slice(0, 1).map((n) => n.text);
  const opener = c.round === 1 ? pick(r, ['Here is where I am.', 'I will say my piece.', 'Let me go through it the way I see it.']) : moved ? pick(r, ['I have listened, and I have changed my mind.', 'All right. You have moved me.']) : pick(r, ['I have heard you, and I am where I was.', 'Nothing said in here has changed the exhibits.']);
  let text: string;
  if (vote === 'guilty') text = `${opener} Guilty. ${strong.length ? `What does it for me is ${strong.join(', and ')}.` : 'The exhibits all run one way.'} ${doubts.length && T.skepticism > 0.5 ? `I took the point about ${doubts[0]}, and it does not undo the rest.` : ''} ${moved ? 'Put together, I cannot find an innocent reading that survives all of it.' : 'I am sure. That is the standard, and I am there.'}`;
  else text = `${opener} Not guilty. ${gaps.length ? `Nobody showed me ${gaps.join(' or ')}, and the judge said every element.` : `It is suspicious — ${strong[0] || 'some of it'} — but suspicious is not sure.`} ${doubts.length ? `And I keep coming back to ${doubts[0]}.` : ''} ${helpD.length ? `Then there is ${helpD[0]}.` : ''} ${alt ? `And nobody dealt with ${v.people.find((p) => p.id === alt)?.name}.` : ''} ${T.humor > 0.5 && r() < 0.4 ? 'If they wanted my vote they should have brought more than a feeling.' : ''}`;
  return { thought: `score ${score.toFixed(1)} vs bar ${bar.toFixed(1)}; gaps: ${gaps.join(',') || 'none'}`, action: { type: 'deliberate', text: text.replace(/\s+/g, ' ').trim(), vote, keyEvidence: key.slice(0, 5) }, theory: { suspect: vote === 'guilty' ? def : null, confidence: Math.min(0.95, Math.abs(score - bar) / 8 + 0.4), summary: `Voted ${vote}.` } };
}
