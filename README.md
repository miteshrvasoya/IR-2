# Interrogation Room

Autonomous AI agents investigate, interrogate and try fictional crimes in a cinematic 3D world. Open the site and a recorded case is already playing. You can predict the outcome with virtual points, then run a case of your own with your own agents.

**There is no backend.** The whole product is a static website plus JSON files. Case definitions, the house agent roster and the sample proceedings are JSON files shipped with the site. The simulation engine runs in your browser. Anything you create — agents, proceedings, points, API keys — is saved as JSON in your browser's storage, and you can download and import it as files.

## Quick start

```bash
npm install
```

```bash
npm run dev            # http://localhost:5173
```

```bash
npm run build          # static site in dist/ — host it anywhere (GitHub Pages, S3, Netlify, any file server)
```

```bash
npm run preview        # serve the built dist/ locally
```

Other commands:

```bash
npm run record         # re-record the sample proceedings into web/public/data/runs/
```

```bash
npm run validate       # check every case file and the agent roster
```

```bash
npm test               # 12 end-to-end and invariant tests
```

## What a visitor can do

- **Watch** (`#/channel`): the sample proceedings play back to back. Every event is staged in 3D, with subtitles, banners and sound. A scrubber lets you move through the case, with markers at key moments, and you can share a link to an exact moment.
- **Predict** while watching: who did it, who gets charged, who gets caught lying, how it ends, and who the Referee will score highest. Calls made before the charging decision pay 1.5×. Calls are settled the moment you see the reveal, and betting on that run then closes.
- **Run a case yourself** (`#/new/<case>`): put your own agents or house agents in any of the 13 seats and press Begin. The case runs live in the tab, saves itself after every step, and resumes if you reload.
- **Build agents** (`#/agents`): personality, temperament, look and private instructions. An agent uses either the built-in house reasoner or your own Anthropic or OpenAI-compatible model with your own key. Agents build a record (rating, history, achievements) from the cases they play.
- **Back up and move** (`#/profile`): download everything as one JSON file, import it on another device, or import a single proceeding file to replay it.

## The JSON files

```
web/public/data/
  agents.json                     the house agents (the platform's default cast)
  cases/index.json                manifest of case files (generated)
  cases/<case>/case.json          identity, briefing, seats, charges, procedure, crime scene, vocabulary
  cases/<case>/characters.json    suspects and witnesses: public profile, private persona, goals, look
  cases/<case>/facts.json         who privately knows what, how willing they are to say it, what would corner them
  cases/<case>/evidence.json      exhibits: source, collection, apparent significance, limitations, lab analyses
  cases/<case>/leads.json         lines of inquiry: hours, prerequisites, warrants, what they recover
  cases/<case>/truth.json         the hidden ground truth (used only by the reveal and the Referee's sealed scoring)
  runs/index.json                 manifest of sample recordings + house agent careers (generated)
  runs/<id>.json                  one complete recorded proceeding: full event log, final state, evidence, scores
```

A proceeding is one JSON document (`interrogation-room/session@1`). It holds the state snapshot, the evidence states, the Referee's score entries, each agent's memory, the prediction markets, and the append-only event log. The same format is used for a sample recording, a case running in your browser, and a downloaded file.

**To add a case:** create a new folder under `cases/` with the six files, then run `npm run validate` and `npm run record` (and add a line-up to `scripts/record.ts` to include it in the samples). Validation checks referential integrity: every evidence id, lead, character and analysis must resolve, and every exhibit must be reachable.

## Sample proceedings

Six recordings are shipped across two cases. Each uses a different line-up of house professionals, and the agents reasoned their way to different verdicts:

| Recording | Case | Line-up (detective · prosecutor · defense) | Ending |
|---|---|---|---|
| `meridian-01` ★ | Death at the Meridian Observatory | Reyes · Harlan · Achebe | hung jury |
| `meridian-02` | Death at the Meridian Observatory | Marlowe · Calloway · Finch | acquittal of the guilty |
| `meridian-03` | Death at the Meridian Observatory | Reyes · Calloway · Finch | conviction |
| `nightingale-01` ★ | The Nightingale Vanishes | Reyes · Calloway · Achebe | conviction |
| `nightingale-02` | The Nightingale Vanishes | Marlowe · Harlan · Finch | conviction |
| `nightingale-03` | The Nightingale Vanishes | Marlowe · Calloway · Finch | conviction |

**Death at the Meridian Observatory** (suspicious death). A director falls from a telescope gantry during a donor gala. Three suspects each have a motive and a lie. One suspect has the fingerprints, the public quarrel and a proven lie, but also an unbreakable alibi.

**The Nightingale Vanishes** (art theft). A jewelled clockwork bird turns out to be a fake on appraisal night. The vault opening that looks like the theft is a red herring; the real switch happened two days earlier, in plain sight.

Each case has its own crime-scene set: the observatory dome, or the gallery vault.

## Architecture

```
core/            the simulation, pure TypeScript that runs in the browser and in Node
  engine.ts      procedure: who has the floor, which actions are legal, validation, state changes, events
  views.ts       information barriers: what each agent may know, what spectators may see
  brains/        heuristic.ts (offline house reasoner) · llm.ts (Anthropic / OpenAI-compatible prompt + parsing)
  referee.ts     Master Referee closing work, prediction markets, career and prediction settlement
  runner.ts      sessions, seating, the turn loop, model failover and circuit breaker
  sim.ts         one proceeding as an in-memory working copy of its JSON document
  caselib.ts     assembles and validates a case from its JSON files
web/src/         the static site: React pages, the 3D stage (three/), the theater, local storage, the live runner
scripts/         record.ts (writes the sample recordings) · validate.ts
```

**Agent autonomy.** The engine never chooses an action for an agent. Each turn, it describes the situation and lists the actions procedure allows. The agent's mind (an LLM, or the offline reasoner, which sees exactly the same view) returns its reasoning and one action. The engine then validates it. An illegal proposal is rolled back and never takes effect. Turn order follows obligations: a question must be answered, an objection gets a ruling, a lab report arrives when the work is done.

**Procedure.** The case moves through these phases: briefing → investigation → charging → pre-trial → opening statements → prosecution case → defense case → closing arguments → deliberation → verdict → sentencing → reveal. Along the way:

- leads cost investigative hours
- searching a private space needs a warrant, and evidence taken without one can be suppressed
- objections and rulings have real effects
- jurors weigh only the admitted record

**Master Referee.** Scores are kept on eight separate dimensions: reasoning, evidence, procedure, discovery, persuasion, credibility, honesty and accuracy. Every entry carries a plain-language reason. Truth-dependent scores stay sealed until the reveal.

**House agents** use the built-in offline reasoner. It reasons over the same role-scoped view an LLM would get, has no per-case dialogue and no access to the truth, and so sometimes gets things wrong. Your own agents can use your own model. Your API key is sent straight from your browser to the provider, using the Anthropic SDK's browser mode or a `fetch` to an OpenAI-compatible endpoint. If a provider fails, the case falls back to the house reasoner for that turn, and after three failures it holds the seat until you reconnect.

## Trade-offs of having no backend

- **No shared multiplayer.** Each browser runs its own proceedings. There are no global spectator leaderboards, only your own record. Agents' records come from the sample recordings and the cases you run.
- **The hidden truth protects the agents, not you.** Agents never receive `truth.json` or other characters' secrets, and the tests check this. But the file is part of the static site, so a curious person can read it in their browser's developer tools.
- **API keys live in your browser's storage**, unencrypted and never included in exports. Anyone with access to your browser profile could read them, so use a key with a spending limit. Some OpenAI-compatible providers block browser requests (CORS).
- **Storage is per browser.** It is limited to a few megabytes, so the oldest finished proceeding is dropped if space runs out. Download backups to keep them.

## What was verified

- **Tests (12, all passing):**
  - case and roster validation
  - full runs of both cases that round-trip through their JSON documents
  - different paths over one truth
  - information barriers across 80 turns of every case
  - prompt-injection containment
  - illegal actions rolled back without a trace
  - recovery of a document whose log ran ahead of its snapshot
  - career and prediction settlement
  - the shipped recordings are complete and replayable
  - the LLM path against a fake provider, including garbage output and a dead provider
- **In a browser** (headless Chromium, against the static build):
  - home, docket, auto-playing channel and the vault crime scene
  - creating an agent, seating it, and running a live case
  - reloading mid-case and resuming
  - predicting during a replay and being paid at the reveal (+225 for an early correct call)

Not verified: a live run against a real Anthropic or OpenAI key, because none was available in the build environment.
