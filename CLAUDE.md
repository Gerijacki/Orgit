# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

**Orgit** — "The Autonomous Repository Evolution Engine for Claude Code." A TypeScript/Node CLI
that ingests an existing repository and returns it cleaner, better organized, and with less
technical debt, behaving like a senior maintenance engineer. It is _not_ a scaffolder for new
apps. The public name is **Orgit**; the working name is _Claude Refactor Engine_.

Design specs (Spanish): [docs/spec/INSTRUCTIONS.md](docs/spec/INSTRUCTIONS.md) (product + mandatory
workflow) and [docs/spec/GITHUB-INSTRUCTIONS.md](docs/spec/GITHUB-INSTRUCTIONS.md) (branding/SEO).
Architecture: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Commands

```bash
pnpm install        # installs deps; native builds (onnxruntime-node, lancedb) are auto-approved
pnpm build          # bundle with tsup → dist/
pnpm typecheck      # tsc --noEmit
pnpm lint           # eslint
pnpm test           # vitest run (all)
pnpm test -- src/memory/chunker.test.ts   # run a single test file
pnpm orgit -- <cmd>  # run the CLI in dev without building (tsx)
```

The CLI itself (after `pnpm build` + `npm link`, or via `pnpm orgit --`):

```
orgit doctor|status|analyze|audit|plan|evolve|improve|docs|explain|ui
orgit mission start "<goal>" | run [--continuous] [--retry] [--parallel] [--no-review] | status | abandon
orgit evolve --review          # reviewer agent gates each edit before commit
orgit -C <dir> ...        # target a different repo (default: cwd)
orgit -p cli|api|auto ... # force a Claude backend (also ORGIT_PROVIDER env)
orgit -m opus|sonnet|haiku|fable|<id> ...  # choose the model (also ORGIT_MODEL env)
orgit evolve --dry-run --max N [--continuous [--max-iterations N]] [--branch]
orgit evolve --concurrency N   # generate task edits in parallel
orgit evolve --interactive     # ask apply/skip/quit before each task
orgit evolve --docs [--docs-level none|minimal|standard|detailed] [--docs-commit]
orgit ui [--port N] [--open]   # local web dashboard: monitor + launch runs (127.0.0.1)
```

`analyze`, `docs`, `status`, `doctor`, `ui` need **no** Claude backend. `audit`, `plan`, `evolve`,
`improve`, `explain` call Claude and need either the `claude` CLI on PATH (subscription, default)
or `ANTHROPIC_API_KEY`.

## Non-negotiable operating principle

Every meaningful change is preceded by understanding. The engine (`src/engine/engine.ts`) enforces
this fixed cycle and never modifies before understanding:

```
Understand → Analyze → Detect → Prioritize → Plan → Execute → Validate / Review → Test → Document → Continue
```

Constraints baked into the design — preserve them when editing:

- **Small, independent, reversible changes.** Each executed task is its own git commit; `evolve`
  refuses to run unless the repo is a git repo with a clean working tree.
- **Validate after every change; never hide errors.** The executor runs the target project's own
  build/test/lint (`src/validation/validate.ts`) and hard-resets the tree on failure.
- **Explain every change.** Each task carries a four-part justification (why / improves / problem /
  impact); commits and reports include it.
- **Static-first, LLM for judgement.** Deterministic detectors (`src/analysis/static.ts`) run for
  free; the model is reserved for what a scanner can't decide. Keep it that way to save tokens.

## Architecture (big picture)

Three load-bearing ideas — read [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for detail:

1. **Provider abstraction** (`src/providers/`) — `ClaudeProvider` is the single seam to Claude.
   `CliProvider` shells out to the host `claude` CLI (subscription, no per-token cost, the default);
   `ApiProvider` uses `@anthropic-ai/sdk` (adaptive thinking, prompt caching). `createProvider()`
   chooses; `completeJson()` returns zod-validated JSON from either backend. The model is resolved by
   `src/providers/models.ts` (`resolveModel`, the `DEFAULT_MODEL`, and short aliases) from `--model` /
   `ORGIT_MODEL` / config. `CompleteOptions.cacheableContext` carries the large, run-stable prefix
   (repo summary + conventions + decision memory) as a **cached** system block so it is billed once;
   `completeJson` retries malformed JSON with a short **repair** reprompt, not the whole prompt.
   **Anthropic has no embeddings endpoint** — never route embeddings through a provider.

2. **Token-saving memory** (`src/memory/`) — LanceDB (embedded, `.orgit/memory/`) + **local**
   embeddings via `fastembed` (ONNX, no key; model cached once in `~/.orgit-cache/`, override with
   `ORGIT_CACHE_DIR`). `Indexer.sync()` is incremental by content hash, so re-analysis only
   re-embeds changed files. Retrieval (`retriever.ts renderContext`) feeds the LLM focused chunks,
   not whole files, packing to a budget (skip-and-continue, overlap-deduped). The same vectors power
   `src/detectors/semantic.ts` (near-duplicate detection across files, **zero extra tokens**);
   `src/memory/conventions.ts` learns house style into `.orgit/conventions.json`; and
   `src/memory/decisions.ts` persists a **cross-run decision memory** (`.orgit/decisions.json`) of
   what Orgit already did, fed back into detection/planning prompts so it never re-proposes done work.

3. **Reversible executor** (`src/executor/`, `src/util/git.ts`) — split into `generateEdit`
   (Analyze+Modify, pure, parallelizable via `src/util/concurrency.ts`) and `applyEdit`
   (Review+Verify+Finalize, sequential, commit-or-rollback). Parallel-generated edits carry a
   source-content hash so a stale one (an earlier task touched its files) is regenerated before
   apply. `Git.rollbackTo()` is the safety primitive (covered by a real-repo test). Interactive mode
   uses an injectable `Approver` (`src/util/prompt.ts`); `--docs` documents changed code via
   `src/docs/codedoc.ts`.

**Missions & multi-agent** (`src/mission/`, `src/agents/`) — a large goal, remembered across
runs. `mission.ts` persists the goal + ordered steps (status/files/`dependsOn`/commits) + a progress
log to `.orgit/mission.json`. The **planner agent** (`planner.ts`) decomposes the goal; the
**coordinator** (`runner.ts`) dispatches runnable steps to **worker agents** (the executor) and
persists each step's outcome via the engine's per-step `onResult` hook, so it resumes exactly where
it left off no matter how many iterations later. A **reviewer agent** (`agents/reviewer.ts`) gates
each edit against its intent before commit (default on for missions); a **tester agent**
(`agents/tester.ts`, the Test phase, `--test`) writes & runs tests for the changed code, committing
them if they pass and discarding them if they fail. `--parallel` runs independent (disjoint-file)
steps concurrently in isolated git worktrees (`executor/worktree.ts`), cherry-picking the results
back. Roles live in `src/agents/agents.ts`.

The `src/engine/context.ts` `buildContext()` assembles config + workspace + provider + memory + git
into a `RunContext` that every command shares. Commands live in `src/cli/commands.ts`; wiring in
`src/cli/index.ts`.

**Web UI** (`src/server/`, `orgit ui`) — a zero-dependency dashboard on Node's built-in `http`, bound
to `127.0.0.1`. `state.ts buildStateSnapshot()` reuses the same readers as `status` (plus a live,
token-free analysis) for a JSON snapshot; `server.ts` serves the self-contained page (`ui.ts`, HTML as
a template-literal string so it bundles), a read-only state/report API, an **SSE** log stream (via the
`subscribeToLog` sink in `src/util/log.ts`), and a single-run-at-a-time `/api/run` that calls the
existing command functions in-process. No new runtime deps — keep it that way.

## Conventions

- ESM throughout; **import with explicit `.js` extensions** (NodeNext resolution). Strict TS with
  `noUncheckedIndexedAccess` — expect `!`/guards on indexed access.
- All Orgit runtime state lives in the target repo's `.orgit/` (git-ignored): memory DB, downloaded
  embedding model, and timestamped Markdown+JSON reports under `.orgit/reports/`.
- Shared domain types are in `src/core/types.ts` — the contract between analysis, detection,
  planning, execution, and validation. Add cross-module types there to avoid import cycles.
- Tests are `*.test.ts` next to their source; prefer testing pure/deterministic logic (the git test
  uses a real temp repo).

## Public repository conventions (from docs/spec/GITHUB-INSTRUCTIONS.md)

If you touch README/releases/topics: the README is a **landing page, not a manual**. Repo
description: _"Autonomous repository evolution engine powered by Claude Code."_ Weave keywords
naturally (ai, llm, claude, claude-code, anthropic, refactoring, technical-debt, agentic, …). Visual
assets and the exact topics list live in [docs/assets/README.md](docs/assets/README.md).
