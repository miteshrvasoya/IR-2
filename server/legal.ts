// A small body of courtroom "law" shared by the engine (to decide when opposing counsel deserves an
// interrupt window and to grade the judge) and by the local reasoner (so house lawyers and judges can
// recognise an objectionable question). It works on the public text of a question only.
import type { ObjectionGround } from '../shared/types.ts';

export interface QuestionCtx { stage: 'direct' | 'cross'; witnessKind: 'lay' | 'expert' | 'officer'; prior: string[]; exhibitAdmitted?: boolean | null }

const words = (s: string) => new Set(s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter((w) => w.length > 3));
export function similarity(a: string, b: string): number {
  const A = words(a), B = words(b);
  if (!A.size || !B.size) return 0;
  let n = 0; for (const w of A) if (B.has(w)) n++;
  return n / (A.size + B.size - n);
}

export function detectObjections(q: string, c: QuestionCtx): ObjectionGround[] {
  const out: ObjectionGround[] = [];
  const t = q.trim();
  if (c.stage === 'direct' && (/^(isn'?t it|is it not|wouldn'?t you|didn'?t you|weren'?t you|you would agree)/i.test(t) || /,\s*(correct|right|isn'?t that (so|right)|didn'?t (you|he|she)|wasn'?t (it|he|she)|weren'?t you)\?*$/i.test(t))) out.push('leading');
  if (c.witnessKind === 'lay' && /(do you think|what do you suppose|why would (he|she|they)|in your opinion|could (he|she|it|they) have|take a guess|speculat|what was (he|she) thinking)/i.test(t)) out.push('speculation');
  if (/(what did .{0,40}(tell|say to) you|did (anyone|someone|anybody) (tell|say)|what had you heard)/i.test(t)) out.push('hearsay');
  if (/(you expect (us|this court|the jury)|you'?re lying|you are lying|come on|isn'?t that convenient|do you seriously|how stupid)/i.test(t)) out.push('argumentative');
  if (c.prior.some((p) => similarity(p, t) > 0.72)) out.push('asked_and_answered');
  if (c.exhibitAdmitted === false) out.push('facts_not_in_evidence');
  return out;
}

export const GROUND_LABEL: Record<string, string> = {
  leading: 'leading the witness', hearsay: 'hearsay', speculation: 'calls for speculation', relevance: 'relevance',
  asked_and_answered: 'asked and answered', facts_not_in_evidence: 'assumes facts not in evidence', argumentative: 'argumentative',
  foundation: 'lack of foundation', unlawful_search: 'fruit of an unlawful search', chain_of_custody: 'broken chain of custody',
  reliability: 'unreliable', alternative_explanation: 'an innocent explanation', bias: 'bias',
};
