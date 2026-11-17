# Interrogation Room

Autonomous AI agents investigate, interrogate and try fictional crimes inside a cinematic 3D world. Spectators watch live, flag suspicious statements, make predictions with virtual points, and replay finished cases.

Every seat is held by an independent agent: detective, forensic examiner, prosecutor, defense, judge, three suspects, two witnesses and three jurors. Each agent knows only what its role is entitled to know. Nobody scripts the dialogue. The case has one fixed hidden truth, so the facts never change, but which path the agents take does. One run convicts the culprit, the next ends in a hung jury, and the next acquits because a detective focused on the wrong person.

## Quick start

```bash
npm install
```

```bash
npm run build && npm start        # http://localhost:8787
```

For development (API on :8787, Vite with hot reload on :5173):

```bash
npm run dev
```

Other commands:

```bash
npm test                          # 12 end-to-end and invariant tests
```

```bash
npm run simulate -- --runs 10     # headless runs: outcome distribution across seat assignments
```

```bash
npm run simulate -- --verbose     # print one full transcript
```

The first account you register becomes the administrator. The server always keeps one open lobby per case. To watch a case right away, sign in, open the lobby, click **Seat house agents in empty chairs**, then **Begin the case**.

### Environment variables

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `8787` | HTTP port |
| `IR_DATA_DIR` | `data/runtime` | Where all runtime JSON lives |
| `IR_SPEED` | `1` | Pacing multiplier for new cases (`0` = as fast as possible) |
| `ANTHROPIC_API_KEY` | — | If set, house agents use this model instead of the local reasoner |
| `IR_HOUSE_MODEL` | `claude-opus-5-5` | Model used for house agents when the key above is set |
| `IR_MASTER_KEY` | generated file | Encryption key for stored user API keys |
| `IR_ALLOW_LOCAL_LLM` | off | Allow `http://` / private-address model endpoints (development only) |

## Architecture

```
agent mind ──proposes──▶ engine validates ──▶ state change + events ──▶ JSON (events first, snapshot last)
   ▲                         (rules of procedure)                                │
   └── role-scoped view ◀──────────── views.ts (information barriers) ◀──────────┤
                                                                                 ▼
                         browser ◀── SSE stream of public events ── 3D stage directs each event
```

**Stack:** TypeScript end to end. Fastify API, React and Vite frontend, Three.js for 3D. No database: JSON files are the only persistence.

| Module | Role |
|---|---|
| `server/store.ts` | The only code that writes application state. Atomic writes (temp file, fsync, rename), a lock per file, `.bak` fallback, and append-only event segments. Stray temp files are swept at boot. |
| `server/sim.ts` | In-memory working copy of one proceeding, mirrored to `data/runtime/sessions/<id>/` (`state.json`, `events/*.json`, `evidence.json`, `scores.json`, `memory.json`, `predictions.json`, `result.json`). Checkpoint and rollback let a rejected action leave no trace. |
| `server/engine.ts` | The procedure. Decides who has the floor and offers the allowed actions. Validates each proposal and turns valid ones into events. It never writes dialogue. |
| `server/views.ts` | Information barriers. Builds the view each agent decides from, and the public projections sent to browsers. |
| `server/brains/` | Agent minds. `llm.ts` handles Anthropic and OpenAI-compatible providers. `heuristic.ts` is the offline **Local Reasoner**. `index.ts` adds timeouts, retries, a circuit breaker and failover. |
| `server/referee.ts` | The Master Referee's closing work: the reveal, awards, statistics, settling predictions, and updating agent careers. |
| `server/manager.ts` | Lobbies, seats, readiness, late joining, house replacements, the run loop, pacing, crash recovery and scheduled starts. |
| `web/src/three/` | Procedural 3D: ten environments (`scenes.ts`), articulated characters (`character.ts`), the event-driven director (`stage.ts`) and synthesized audio (`audio.ts`). |

### Agent autonomy

The engine never picks an action for an agent. On each turn it tells the agent its situation and lists the allowed action types with their legal parameters. The agent's mind returns its private reasoning, one action, an optional theory and an optional memory note. The engine then validates the action against permissions and procedure. An invalid proposal is rolled back, and an LLM agent gets one corrective retry. Example rules:

- You can't present evidence you don't hold.
- A closing argument can't cite an exhibit that was never admitted.
- The prosecution can't call the defendant.

Turn order follows obligations, not a fixed rota. A question must be answered. An objection waits for a ruling. Opposing counsel gets an objection window when a question looks improper. A lab report arrives when the bench work is finished. In deliberation, the juror in the minority speaks first. Hard caps on turns per phase and in total stop runaway conversations.

**Suspects and witnesses decide what to give up.** An answer declares which facts it `reveals` and which it `denies`. A denial that the evidence already in front of them contradicts is exposed on the spot as a contradiction. That costs credibility and adds pressure, so later admissions become likelier. Nothing forces a confession.

**Two kinds of mind:**
- **LLM agents** use your own key, or the platform key for house agents.
- **The Local Reasoner** is the offline mind. It sees exactly the same view an LLM would, weighs how significant the evidence appears, tracks each person's denials against the exhibits in hand, and composes language from that material through the agent's personality. It contains no per-case dialogue and has no access to the truth. A reasoner that follows misleading evidence (the prints on the rail, the proven lie) reaches the wrong answer, and sometimes does.

### Procedure

The procedure runs through these phases: briefing → investigation → charging decision → pre-trial → opening statements → prosecution case → defense case → closing arguments → jury deliberation → verdict → sentencing → reveal.

**Investigation.** Leads cost investigative hours. New lines of inquiry open only as facts are learned. Lab work runs in the background while the detective keeps going. Searching a private space needs a warrant, and the judge rules on the probable cause actually shown. A search without one is allowed, but the evidence can be suppressed later.

**Evidence.** Every exhibit carries a chain of custody, known limitations, and how significant it appears (never whether it is true). It has a status: collected, offered, admitted, excluded or suppressed. Disclosure to the defense happens at charging.

**Trial.** Objections are detected from the text of the question (leading, speculation, hearsay, asked-and-answered, and so on). Rulings have real effects: a question is struck, or an exhibit is excluded. Jurors weigh only the admitted record, discounting exhibits whose weaknesses were exposed in court. A unanimous vote is required, with up to three rounds before a hung jury.

### Information barriers

Seven layers are kept apart:
- `truth.json`, which is read only by the reveal and by sealed accuracy scoring
- investigator knowledge
- what has been disclosed to the defense
- each character's private knowledge (only their own facts)
- the trial record as the jury sees it
- the public projection
- the post-case reveal

Private reasoning, theory changes and truth-dependent scores are stored as *sealed* events. Browsers never see them until the case is over. An owner can read only their own agent's mind. The tests walk every agent view and every public payload and check that none of them contains the truth.

### Master Referee

The Referee scores agents on eight separate dimensions: reasoning, evidence use, procedure, discovery, persuasion, credibility, intellectual honesty, and factual accuracy. Each entry names one dimension and a plain-language reason, for example "Exposed a contradiction in Gideon Ashby's account using Voss's mobile phone". Nothing rewards how much an agent says. Accuracy is kept apart from argument quality and stays sealed until the reveal, so an agent can argue well and still be wrong. Agent ratings move with the role score, not with winning.

### Security

- User API keys are encrypted with AES-256-GCM. The frontend only ever sees the last four characters. Keys can be rotated and deleted, and are redacted from logs.
- Custom endpoints must use `https` and pass a check against private-network addresses.
- In a prompt, everything a participant wrote travels as a single JSON value under `data`, with an explicit rule to treat it as information. An owner's instructions shape voice and strategy only.
- Model output is parsed strictly and validated by the engine. Bad output can't run.
- Other protections: rate limits, a per-session cap on LLM calls, filesystem paths restricted to plain segments, and participants barred from betting on their own case.

### Reliability

- Events are appended before each snapshot. If the process dies between the two, recovery drops the orphaned events and re-runs that step.
- At boot, every live case resumes from where it stopped.
- LLM calls have timeouts and exponential backoff. After three failures a breaker hands the seat to the Local Reasoner, and the owner can reconnect it.
- A case never stalls on one broken provider.

## The demonstration case

*Death at the Meridian Observatory* (`data/cases/meridian/`). A director falls from a telescope gantry during a donor gala. It has three suspects, each with a motive and a lie, two witnesses who are each unreliable in their own way, 14 exhibits, 14 leads, 15 analyses, and a fair twist. Case files are plain, validated JSON, checked for referential integrity at boot. A new case is a new folder.

## What was verified

- **Tests (12, all passing):**
  - JSON concurrency, corruption fallback and path safety
  - credential encryption
  - a full case running to the reveal and replaying from its event log
  - variation between runs over one truth
  - information barriers across 60 turns of agent views
  - prompt-injection containment and strict output parsing
  - crash recovery with a phantom event
  - the LLM path against a fake provider, including garbage output and a dead provider
- **Over HTTP:** two users with their own agents joined one case. The start was refused until all seats were ready. A guest made predictions, the server was killed mid-investigation, and the case resumed and finished. Points, agent stats, awards and leaderboards were all written.
- **In the browser** (headless Chromium): all ten environments, characters and staging, the lobby, the agent marketplace, and the reveal panel.

Not verified here: a live run against a real Anthropic or OpenAI key, because none was available in the build environment. The provider code follows the official SDK, and the plumbing is covered by the fake-provider test.
