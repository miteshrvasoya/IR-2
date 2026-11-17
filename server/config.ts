import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const config = {
  root,
  port: Number(process.env.PORT || 8787),
  casesDir: path.join(root, 'data', 'cases'),                    // authored, versioned case definitions
  houseAgentsFile: path.join(root, 'data', 'house-agents.json'), // authored house roster
  runtimeDir: process.env.IR_DATA_DIR || path.join(root, 'data', 'runtime'), // everything the app writes
  eventSegment: 100,
  llmTimeoutMs: Number(process.env.IR_LLM_TIMEOUT_MS || 45000),
  llmRetries: 2,
  // Pace of a live case (multiplier applied to each event's on-screen duration). 0 = as fast as possible.
  speed: process.env.IR_SPEED !== undefined ? Number(process.env.IR_SPEED) : 1,
  allowLocalLlm: process.env.IR_ALLOW_LOCAL_LLM === '1',
  // Optional platform key: lets house agents think with a real LLM instead of the local reasoner.
  houseAnthropicKey: process.env.ANTHROPIC_API_KEY || '',
  houseModel: process.env.IR_HOUSE_MODEL || 'claude-opus-5-5',
  maxTurnsPerPhase: 140,
  maxTotalTurns: 900,
};
