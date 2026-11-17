// Chooses the mind behind a seat and shields the case from its failures: timeouts, retries with backoff,
// a circuit breaker, and failover to the Local Reasoner so one broken provider never stalls a trial.
import type { Sim } from '../sim.ts';
import type { AgentView } from '../views.ts';
import type { AgentDecision } from '../../shared/types.ts';
import { heuristicDecide } from './heuristic.ts';
import { llmDecide, type LlmTarget } from './llm.ts';
import { credentialSecret } from '../accounts.ts';
import { config } from '../config.ts';
import { redact } from '../crypto.ts';

export type Source = 'llm' | 'local' | 'failover';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const callBudget = new Map<string, number>();          // per-session LLM call counter (resource limit)
const MAX_LLM_CALLS = 700;

async function target(sim: Sim, seat: string): Promise<LlmTarget | null> {
  const a = sim.agents[seat], s = sim.st.seats[seat];
  if (s.failures >= 3) return null;                                  // circuit open: local reasoner takes over
  if (a.model.provider === 'house') return config.houseAnthropicKey ? { provider: 'anthropic', model: config.houseModel, apiKey: config.houseAnthropicKey, platformKey: true } : null;
  const key = await credentialSecret(a.ownerId, a.model.credentialId);
  if (!key) return null;
  return { provider: a.model.provider, model: a.model.model || (a.model.provider === 'anthropic' ? 'claude-opus-5-5' : 'gpt-4o'), apiKey: key, baseUrl: a.model.baseUrl };
}

export async function decide(sim: Sim, seat: string, view: AgentView, feedback?: string): Promise<{ decision: AgentDecision; source: Source; error?: string }> {
  const t = await target(sim, seat);
  if (!t) return { decision: heuristicDecide(view), source: sim.agents[seat].model.provider === 'house' && !config.houseAnthropicKey ? 'local' : 'failover' };
  const used = callBudget.get(sim.id) || 0;
  if (used >= MAX_LLM_CALLS) return { decision: heuristicDecide(view), source: 'failover', error: 'session LLM budget exhausted' };
  let err = '';
  for (let attempt = 0; attempt <= config.llmRetries; attempt++) {
    callBudget.set(sim.id, (callBudget.get(sim.id) || 0) + 1);
    try {
      const decision = await Promise.race([llmDecide(t, view, feedback), sleep(config.llmTimeoutMs + 2000).then(() => { throw new Error('timed out'); })]) as AgentDecision;
      sim.st.seats[seat].failures = 0;
      return { decision, source: 'llm' };
    } catch (e: any) {
      err = redact(e?.message || String(e));
      if (e?.status === 401 || e?.status === 403) break;               // bad key: retrying will not help
      await sleep(400 * 2 ** attempt);
    }
  }
  sim.st.seats[seat].failures++;
  return { decision: heuristicDecide(view), source: 'failover', error: err };
}
export { heuristicDecide };
