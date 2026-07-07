# Orgit Architecture

Orgit is a TypeScript/Node CLI that turns Claude Code into an autonomous repository
maintenance engineer. It is organized around three ideas: a **provider abstraction**
that hides which Claude backend is in use, a **token-saving memory layer**, and a
**reversible, git-native execution cycle**.

## The cycle

Every run walks the same mandatory state machine (`src/engine/engine.ts`), and never
modifies anything before it understands the project:

```
Understand → Analyze → Detect → Prioritize → Plan → Execute → Validate / Review → Test → Document → Continue
```

Commands enter the cycle at the depth their mode needs:

| Command               | Enters at                          | Writes to repo?  |
| --------------------- | ---------------------------------- | ---------------- |
| `analyze`             | Understand + index                 | No               |
| `audit`               | + Detect + Prioritize              | No               |
| `plan`                | + Plan                             | No               |
| `evolve` / `improve`  | + Execute + Validate (+ Document)  | Yes (as commits) |
| `evolve --continuous` | loops the whole cycle until stable | Yes (as commits) |

## Modules

```
src/
  cli/         commander entry + command handlers
  config/      config loader (zod) + .orgit/ workspace resolver
  providers/   ClaudeProvider interface, CliProvider, ApiProvider, factory, detection
  memory/      embeddings (fastembed), chunker, LanceDB store, incremental indexer, retriever
  analysis/    repo walk, mental-model builder, static analyzers, health score
  detectors/   opportunity detection (static + embedding-based duplication + LLM judgement)
  planner/     benefit/risk prioritizer + plan builder
  executor/    per-task apply loop (one git commit each)
  validation/  runs the project's own build/test/lint
  docs/        architecture doc generation
  report/      Markdown + JSON reports
  engine/      run context assembly + cycle state machine
  util/        git, filesystem walk, logging
```

## Provider abstraction (`src/providers`)

`ClaudeProvider` is the single seam to Claude. Two implementations satisfy it:

- **`CliProvider`** (default) shells out to the host `claude` CLI in print mode
  (`claude -p … --output-format json`). This runs under the user's Claude Code
  subscription — **no per-token API billing**.
- **`ApiProvider`** uses `@anthropic-ai/sdk` with `ANTHROPIC_API_KEY`, adaptive thinking,
  and prompt caching.

`createProvider()` chooses based on `ORGIT_PROVIDER` / config: in `auto` mode it prefers
the CLI and falls back to the API only if a key is present. `orgit doctor` reports the
live backend and model. `completeJson()` wraps either backend to return schema-validated
JSON (extracted and validated with zod).

**Model selection.** `models.ts` is the single source of the default model id and a small
alias table (`opus`/`sonnet`/`haiku`/`fable`). `resolveModel()` applies it to the value from
`--model` / `ORGIT_MODEL` (per run) or `config.model`, so any model id works without a code
change.

**Token discipline in the seam.** `CompleteOptions.cacheableContext` holds the large,
run-stable prefix — the repository summary, learned conventions, and cross-run decision
memory — which are **identical across the many calls a cycle makes**. `ApiProvider` emits it
as a separate `cache_control: ephemeral` system block so it is billed once and reused;
`CliProvider` folds it into the system prompt. And `completeJson()`'s retry is a short
**repair** reprompt (the invalid output + the parse error), not a re-send of the whole
original prompt — so a malformed response costs a fraction of a full call.

## Memory layer (`src/memory`) — why refactoring stays cheap

The memory layer is what keeps Orgit from re-sending whole files to Claude on every
iteration:

- **Embeddings** are computed locally with `fastembed` (ONNX, `bge-small-en-v1.5`).
  No API key, no network at inference time, no per-token cost — so memory works even
  in subscription-only mode.
- **Storage** is LanceDB under `.orgit/memory/` — embedded, file-based, no server.
- **Chunking** splits files into overlapping line windows (`chunker.ts`).
- **Incremental indexing** (`indexer.ts`) compares each file's content hash to what is
  stored and re-embeds only the files that changed; deleted files are purged. Re-running
  analysis after editing one file costs one file's worth of work.
- **Retrieval** (`retriever.ts`) embeds a query and returns the most relevant chunks,
  which the detection and `explain` flows use as a focused context instead of dumping
  entire files.

Detection is **static-first**: deterministic analyzers (`analysis/static.ts`) find
large files and long functions for free; the LLM is reserved for judgement it can't
get from a scanner.

The memory does **double duty as a detector**. `detectors/semantic.ts` reads the
vectors already in the store (`MemoryStore.scanVectors()`) and flags near-duplicate
code across different files by cosine similarity — catching copy-paste and parallel
implementations a textual scanner misses, with **zero additional Claude tokens**.

## Missions & multi-agent orchestration

For large refactors that span many runs, Orgit remembers the goal and works toward it
meticulously — the "memory of large refactoring processes" pillar.

- **Persistent mission** (`mission/mission.ts`) — the user's goal, an ordered list of
  steps (each with status, files, dependencies, and the commits that advanced it), and
  an append-only progress log, all persisted to `.orgit/mission.json`. Because state
  lives on disk and is reloaded on every run, the goal and the exact next step survive
  any number of iterations, crashes, or days.
- **Planner agent** (`mission/planner.ts`) — decomposes the goal into small, independent,
  reversible steps, grounded in the repo via memory retrieval, with explicit ordering
  (`dependsOn`) and the files each step touches (existing or new).
- **Coordinator** (`mission/runner.ts`) — on each `mission run` it loads the mission,
  computes which steps are runnable now (dependencies satisfied), dispatches them to
  **worker agents** (the executor's parallel `generateEdit` + sequential `applyEdit`),
  and writes each step's outcome back to disk **immediately** via the engine's per-step
  `onResult` hook — so an interruption never loses progress. Steps that fail validation
  are rolled back and marked blocked (retryable with `--retry`); when every step is done
  the mission is `completed`.

- **Reviewer agent** (`agents/reviewer.ts`) — before a change is committed, it independently
  checks that the proposed edit accomplishes its task (no scope creep, no unrelated edits, no
  obvious bugs). It runs as a gate in `engine.execute` _before_ the edit touches the tree, so a
  rejected step is never applied. Pairing this intent check with the executor's behavioural
  validation (build/test/lint) is what makes a mission meticulous. On by default for missions
  (`mission run --no-review` to skip); opt-in for `evolve --review`. It fails open, so a transient
  reviewer error never stalls progress — behavioural validation still guards correctness.

- **Tester agent** (`agents/tester.ts`) — the **Test** phase. After a change is applied,
  validated, and reviewed, the tester writes new tests that exercise the changed code and
  runs them (`runTestsOnly`). Passing tests are committed on their own (increasing coverage
  and confirming the refactor); failing tests are discarded with a warning, so the repository
  always stays green while the concern is surfaced. It only ever creates new `*.test.*` files —
  never overwrites source or existing tests. Opt-in via `--test` on `evolve` and `mission run`.

The agent roles are explicit (`agents/agents.ts`: coordinator / planner / worker /
reviewer / tester), which keeps the orchestration genuinely multi-agent and easy to extend.

### Genuinely-concurrent independent steps (`mission run --parallel`)

Parallel _generation_ speeds up the LLM calls; `--parallel` also parallelizes the expensive
_validation_. `executor/worktree.ts` partitions the runnable steps into a mutually-disjoint-file
set (safe to run together) and the rest. Each independent step is executed in its own **git
worktree** — a separate working tree and index sharing the object database — so its edit is
applied, the project's test suite runs, and it commits, all concurrently and fully isolated. The
resulting commits are then cherry-picked onto the base branch in order; disjoint files mean the
picks apply cleanly. Any overlapping steps run sequentially afterward. If the project has a
`node_modules`, it is junction-linked into each worktree so validation has its dependencies.

## Learning & health

- **Conventions** (`memory/conventions.ts`) — Orgit derives the project's house style
  (indentation, quotes, semicolons, test framework) from the code, persists it to
  `.orgit/conventions.json`, refines it every run, and injects it into the detection and
  execution prompts so its edits match your style. This is the "learning the project"
  pillar made concrete.
- **Health score** (`analysis/health.ts`) — a deterministic 0–100 score from the mental
  model and detected opportunities. Each `audit`/`evolve` appends it to
  `.orgit/history.json` (`report/history.ts`), so `audit` and `status` show the trend
  across runs.
- **Decision memory** (`memory/decisions.ts`) — every committed task is recorded to
  `.orgit/decisions.json` (bounded, most-recent-kept). A deterministic, token-free render of
  the recent decisions is fed back into the detection/planning prompts (through the cached
  prefix), so across **any** number of runs Orgit remembers what it already did and does not
  re-propose it. This complements missions, which remember one large goal; decision memory
  remembers the trail of every change.

The embedding model is cached once in a shared user-level directory
(`~/.orgit-cache/`, overridable via `ORGIT_CACHE_DIR`) so it downloads a single time
across every repository Orgit runs on.

## Execution & safety (`src/executor`, `src/validation`, `src/util/git.ts`)

Orgit is git-native and reversible:

1. `evolve` requires a git repo and a **clean working tree** — a known-good baseline.
2. Each task is applied on its own, then the project's **own** build/test/lint runs.
3. If validation passes, the change is committed with a four-part justification
   (why / improves / problem / impact). If it fails, the tree is hard-reset to the
   pre-task commit and the task is marked rolled back. Errors are never hidden.

Because each task touches only its declared files and is an independent commit, any
single improvement can be reverted without affecting the others.

### Parallel generation, sequential apply

The executor is split into two phases (`executor/execute.ts`): **`generateEdit`**
(Analyze + Modify) reads a task's files and asks Claude for an edit — pure, no writes —
so many tasks' edits are generated **concurrently** (`util/concurrency.ts`, bounded by
`--concurrency`). **`applyEdit`** (Review + Verify + Finalize) then applies them one at a
time on the shared working tree. Each generated edit records a content hash of its
sources; if an earlier applied task changed one of those files, the edit is flagged
stale and regenerated against fresh content before it is applied — parallel speed
without losing correctness.

**Automode vs. interactive.** By default `evolve` runs hands-off. With `--interactive`,
an injectable `Approver` (`util/prompt.ts`) is consulted before each task — apply / skip
/ quit — so the engine stays testable (tests pass a stub approver; no TTY needed).

### Documentation during refactor (opt-in)

With `--docs`, after the committed tasks Orgit documents the code it changed
(`docs/codedoc.ts`): for each committed task it reads the changed files' new contents,
asks Claude for developer docs, and writes a page per task plus an index — into
`.orgit/reports/docs/` by default, or into the repo (and committed) with `--docs-commit`.
The **`--docs-level`** flag (config `docsLevel`) selects the verbosity — `minimal`
(one paragraph), `standard`, or `detailed` (API + usage examples + rationale) — via a
`DOC_LEVELS` table that also scales the output token budget, so more docs cost more and
less costs less. `none` disables generation.

## Web dashboard (`src/server`, `orgit ui`)

`orgit ui` starts a local dashboard with **no new dependencies** — Node's built-in `http`
server plus one self-contained HTML page (`ui.ts`, inline CSS/JS stored as a template
string so it bundles). It binds to `127.0.0.1` only.

- `state.ts buildStateSnapshot()` builds the JSON the UI renders, reusing the same readers
  as `orgit status` plus a live, token-free static/semantic analysis — no Claude provider
  needed.
- `server.ts` serves the page, a read-only state/report API, an **SSE** log stream, and a
  single-run-at-a-time `POST /api/run` that invokes the existing command functions
  in-process (mutating `evolve` defaults to a dry run from the browser). The SSE stream is
  fed by a `subscribeToLog` sink added to `util/log.ts`, so the live log mirrors the CLI
  exactly without changing any call site.

## Workspace

All Orgit state lives in `.orgit/` inside the target repo (git-ignored): the LanceDB
memory, the downloaded embedding model, learned conventions, health history, decision
memory (`decisions.json`), the active mission, and timestamped Markdown + JSON reports
under `.orgit/reports/`.
