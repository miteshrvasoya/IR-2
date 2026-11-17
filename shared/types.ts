// Shared domain types for Interrogation Room (server + web).

export type RoleKind = 'detective' | 'forensic' | 'prosecutor' | 'defense' | 'judge' | 'suspect' | 'witness' | 'juror';

export type Phase =
  | 'lobby' | 'briefing' | 'investigation' | 'charging' | 'pretrial' | 'opening'
  | 'prosecution_case' | 'defense_case' | 'closing' | 'deliberation' | 'verdict'
  | 'sentencing' | 'reveal' | 'closed';

export const PHASES: Phase[] = ['lobby', 'briefing', 'investigation', 'charging', 'pretrial', 'opening',
  'prosecution_case', 'defense_case', 'closing', 'deliberation', 'verdict', 'sentencing', 'reveal', 'closed'];

export const PHASE_LABEL: Record<Phase, string> = {
  lobby: 'Lobby', briefing: 'Briefing', investigation: 'Investigation', charging: 'Charging Decision',
  pretrial: 'Pre-Trial', opening: 'Opening Statements', prosecution_case: 'Prosecution Case',
  defense_case: 'Defense Case', closing: 'Closing Arguments', deliberation: 'Jury Deliberation',
  verdict: 'Verdict', sentencing: 'Sentencing', reveal: 'The Truth', closed: 'Case Closed',
};

export type SceneId = 'office' | 'interrogation' | 'crime_scene' | 'evidence_room' | 'briefing' | 'witness_room'
  | 'courtroom' | 'jury_room' | 'lab' | 'archive';

export const SCENE_LABEL: Record<SceneId, string> = {
  office: 'Investigation Office', interrogation: 'Interrogation Room', crime_scene: 'Crime Scene',
  evidence_room: 'Evidence Room', briefing: 'Briefing Room', witness_room: 'Witness Interview Room',
  courtroom: 'Courtroom', jury_room: 'Jury Room', lab: 'Forensic Laboratory', archive: 'Case Archive',
};

export type Element = 'motive' | 'opportunity' | 'means' | 'identity';
export type ChallengeGround = 'reliability' | 'chain_of_custody' | 'relevance' | 'alternative_explanation' | 'unlawful_search' | 'bias';
export type ObjectionGround = 'leading' | 'hearsay' | 'speculation' | 'relevance' | 'asked_and_answered' | 'facts_not_in_evidence' | 'argumentative' | 'foundation' | 'unlawful_search' | 'chain_of_custody';

// ---------- Case definition (authored, static) ----------
export interface SeatDef { id: string; role: RoleKind; title: string; characterId?: string; required: boolean; blurb: string }

export interface CaseDef {
  id: string; version: number; title: string; tagline: string; type: string; difficulty: number;
  setting: string; briefing: string; victim: { name: string; description: string };
  charges: { id: string; label: string; elements: Element[] }[];
  seats: SeatDef[];
  procedure: { investigationHours: number; interviewExchanges: number; maxWitnessesPerSide: number; maxQuestionsDirect: number; maxQuestionsCross: number; juryRounds: number; standard: string };
  crimeScene: { kind: string; label: string };
  estimatedMinutes: number; topicLabels?: Record<string, string>;
}

export interface CharacterDef {
  id: string; name: string; age: number; occupation: string; kind: 'suspect' | 'witness';
  publicProfile: string;          // visible to everybody
  persona: string;                // private brief given to whoever plays this character
  goals: string;                  // private
  look: { skin: string; hair: string; hairStyle: string; outfit: string; accent: string; build?: number };
}

export interface FactDef {
  id: string; topic: string; text: string;                     // text = the true proposition
  knownBy: Record<string, { stance: 'open' | 'guarded' | 'deny'; cover?: string; say?: string; yieldsTo?: string[]; firmness?: number }>;
  contradictedBy?: string[];                                    // evidence that exposes a denial of this fact
  unlocks?: string[];                                           // lead ids opened once investigators learn it
  points?: Inference[];                                         // apparent significance once on the record
}

export interface Inference { suspect: string; element: Element; strength: 1 | 2 | 3; note: string; exculpatory?: boolean }
export interface Limitation { id: string; ground: ChallengeGround; text: string; strength: number }
export interface AnalysisDef { id: string; label: string; kind: 'forensic' | 'digital' | 'financial' | 'medical'; hours: number; turns: number; findings: string; addsPoints?: Inference[]; addsLimitations?: Limitation[]; yieldsEvidence?: string[]; yieldsFacts?: string[] }

export interface EvidenceDef {
  id: string; title: string; type: string; description: string; source: string; collection: string;
  location: SceneId; topics: string[]; relevantTo: string[]; relatedTo: string[];
  points: Inference[]; limitations: Limitation[]; analyses: AnalysisDef[];
  visual: { kind: string; color?: string };
}

export interface LeadDef {
  id: string; label: string; kind: 'scene' | 'collect' | 'records' | 'search' | 'canvass';
  scene: SceneId; description: string; hours: number;
  requires?: { all?: string[]; any?: string[] };
  yields: { evidence?: string[]; facts?: string[] };
  requiresWarrant?: boolean; warrantBasis?: string[];           // evidence/fact ids that amount to probable cause
  narration: string;
}

export interface TruthDef {
  culprit: string; summary: string; motive: string; method: string;
  timeline: { time: string; what: string }[];
  misleading: { what: string; why: string }[];
  unreliable: { who: string; why: string }[];
  twist: string;
}

// ---------- Agents & users ----------
export interface AgentProfile {
  id: string; ownerId: string | null; house: boolean; name: string; tagline: string;
  preferredRoles: RoleKind[]; personality: string; background: string; style: string;
  traits: { rigor: number; aggression: number; skepticism: number; drama: number; empathy: number; humor: number };
  instructions: string;
  model: { provider: 'house' | 'anthropic' | 'openai-compatible'; model?: string; baseUrl?: string; credentialId?: string };
  look: { skin: string; hair: string; hairStyle: string; accent: string; build?: number };
  listed: boolean; createdAt: string;
  stats: AgentStats;
}
export interface AgentStats {
  cases: number; xp: number; rating: number; wins: number; losses: number;
  byRole: Record<string, { cases: number; avgScore: number }>;
  dims: Record<string, number>; objectionsWon: number; contradictions: number; evidenceFound: number;
  achievements: { id: string; label: string; at: string; sessionId?: string }[];
  history: { sessionId: string; caseTitle: string; role: RoleKind; score: number; outcome: string; at: string; awards: string[] }[];
}

export interface PublicUser { id: string; handle: string; admin: boolean; points: number; streak: number; bestStreak: number; correct: number; total: number; achievements: { id: string; label: string; at: string }[] }

// ---------- Runtime ----------
export type Vis = 'public' | 'sealed' | string;   // 'private:<seatId>' also allowed

export interface SimEvent {
  seq: number; t: string; type: string; phase: Phase; scene: SceneId;
  actor?: { seatId: string; name: string; role: RoleKind };
  target?: string; text?: string; kind?: string; data?: any;
  aud: string[]; vis: Vis; ms?: number; highlight?: string;
}

export interface SeatState { seatId: string; agentId: string | null; ownerId: string | null; ready: boolean; house: boolean; connected: boolean; joinedAt?: string; failures: number }

export interface Turn { seat: string; purpose: string; data?: any }

export interface SessionState {
  id: string; caseId: string; title: string; status: 'lobby' | 'live' | 'paused' | 'finished' | 'aborted';
  phase: Phase; scene: SceneId; seed: number; rng: number; seq: number; turn: number;
  hostId: string | null; createdAt: string; scheduledFor?: string; startedAt?: string; finishedAt?: string;
  seats: Record<string, SeatState>;
  queue: Turn[];
  hoursLeft: number; phaseTurns: number; passes: number;
  leadsDone: string[]; warrants: Record<string, 'granted' | 'denied'>;
  jobs: { id: string; evidenceId: string; analysisId: string; dueTurn: number; requestedBy: string }[];
  investigatorFacts: string[];
  chars: Record<string, CharRuntime>;
  sub: any;                                   // interview / examination sub-state
  defendant: string | null; charge: string | null; plea: string | null;
  report: { recommended: string | null; summary: string } | null;
  trial: { witnessesCalled: Record<string, string[]>; motions: number; rested: Record<string, boolean>; openingDone: string[]; closingDone: string[]; round: number; votes: Record<string, string>; voteHistory: Record<string, string>[]; argued: Record<string, { cites: string[]; challenges: string[]; alt?: string | null }>; sentRequestMore?: boolean; testimony: { fact: string; witness: string; struck?: boolean }[]; confer: number };
  outcome: null | { kind: 'convicted' | 'acquitted' | 'hung' | 'no_charges' | 'plea'; defendant: string | null; correct: boolean | null; text: string };
  speed: number; error?: string;
}

export interface CharRuntime { revealed: string[]; denied: string[]; caught: string[]; pressure: number; credibility: number; interviews: number; shown: string[]; sworn?: boolean }

export interface EvidenceState {
  id: string; discovered: boolean; discoveredAt?: string; discoveredBy?: string; viaLead?: string;
  custody: { t: string; by: string; action: string; note?: string }[];
  analyses: Record<string, { status: 'pending' | 'done'; by?: string; at?: string; report?: string }>;
  disclosedToDefense: boolean;
  status: 'undiscovered' | 'collected' | 'offered' | 'admitted' | 'excluded' | 'suppressed';
  warrantless?: boolean; offeredBy?: string;
  challenges: { by: string; ground: string; effective: boolean; limitationId?: string; phase: Phase; seq: number }[];
}

// What agents / spectators are allowed to see about an evidence item.
export interface EvidenceView {
  id: string; title: string; type: string; description: string; source: string; collection: string;
  location: SceneId; discoveredAt?: string; status: EvidenceState['status']; warrantless?: boolean;
  custody: EvidenceState['custody']; relevantTo: string[]; relatedTo: string[]; topics: string[];
  points: (Omit<Inference, 'strength'> & { strength: 'weak' | 'moderate' | 'strong'; via?: string })[];
  limitations: { id: string; ground: string; text: string; via?: string }[];
  analyses: { id: string; label: string; kind: string; status: 'available' | 'pending' | 'done'; report?: string; hours: number }[];
  challenges: { by: string; ground: string; phase: Phase }[];
  disclosedToDefense: boolean; visual: EvidenceDef['visual'];
}

export interface ScoreEntry { seq: number; seatId: string; dim: string; delta: number; reason: string; sealed?: boolean }
export const SCORE_DIMS = ['reasoning', 'evidence', 'procedure', 'discovery', 'persuasion', 'credibility', 'honesty', 'accuracy'] as const;
export const DIM_LABEL: Record<string, string> = { reasoning: 'Logical reasoning', evidence: 'Evidence usage', procedure: 'Procedural compliance', discovery: 'Investigative discovery', persuasion: 'Persuasion', credibility: 'Credibility & consistency', honesty: 'Intellectual honesty', accuracy: 'Factual accuracy' };

export interface Market { id: string; question: string; options: { id: string; label: string }[]; closesAtPhase: Phase; points: number; answer?: string | null; status: 'open' | 'closed' | 'settled' | 'void' }
export interface PredictionEntry { userId: string; handle: string; marketId: string; choice: string; at: string; phase: Phase; won?: boolean; awarded?: number }

export interface AgentDecision { thought: string; action: { type: string; [k: string]: any }; theory?: { suspect: string | null; confidence: number; summary: string }; note?: string }

export interface ActionOption { type: string; description: string; params?: Record<string, string>; choices?: Record<string, { id: string; label: string }[]> }
