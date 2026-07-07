# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Web dashboard** (`orgit ui`): a zero-dependency local web UI (Node's built-in server + a single
  self-contained page) to monitor live analysis, health/grade + trend, opportunities, mission
  progress, decision memory, and reports — and to **launch runs** (analyze/audit/plan/evolve/mission)
  from the browser and watch progress stream live over SSE. Binds to `127.0.0.1` only; `--port`,
  `--open`.
- **Model selection** (`-m, --model`): choose the Claude model per run (or via `orgit.config.json`
  `model`), with friendly aliases (`opus`, `sonnet`, `haiku`, `fable`). Shown by `orgit doctor`.
- **Doc-level selector** (`evolve --docs-level none|minimal|standard|detailed`, config `docsLevel`):
  control how much documentation a refactor generates and its token cost (minimal ≈ one paragraph,
  detailed ≈ API + usage examples + rationale).
- **Cross-run decision memory** (`.orgit/decisions.json`): every committed task is remembered across
  any number of runs and fed back into detection/planning prompts (via the cached prefix), so Orgit
  doesn't re-propose work it already did. Surfaced in `status` and the dashboard.

### Changed

- **Fewer tokens.** The large, run-stable context (repository summary + learned conventions +
  decision memory) is now sent as a **cached prompt prefix** (API prompt caching) instead of being
  re-billed on every call; JSON retries are now a short **repair reprompt** (the bad output + the
  error) instead of re-sending the whole original prompt; and retrieval packing no longer discards
  all remaining chunks when one early chunk is oversized (skip-and-continue + overlap de-duplication).

- **Missions** (`orgit mission start/run/status/abandon`): state a large refactoring goal
  once and Orgit remembers it across any number of runs. A planner agent decomposes the
  goal into an ordered, dependency-aware step plan persisted to `.orgit/mission.json`; a
  coordinator dispatches runnable steps to worker agents (parallel generation + sequential,
  validated apply) and records each step's outcome to disk immediately, so it resumes
  exactly where it left off. `--continuous` runs to completion; `--retry` re-attempts
  blocked steps. Explicit agent roles in `src/agents/`.
- **Reviewer agent**: verifies each edit accomplishes its task (no scope creep / unrelated
  edits) as a gate before commit — on by default for missions (`mission run --no-review` to
  skip), opt-in for `evolve --review`. Pairs with build/test/lint validation.
- **Genuinely-concurrent independent steps** (`mission run --parallel`): disjoint-file steps run
  fully isolated in their own git worktrees — parallel apply _and_ validation — then are
  cherry-picked back onto the base branch.
- **Tester agent** and a **Test phase** (`evolve --test`, `mission run --test`): after a change is
  validated and reviewed, the tester writes tests for the changed code and runs them — committing
  them if they pass, discarding them with a warning if they fail so the repo stays green. The
  cycle is now Understand → … → Execute → Validate / Review → Test → Document → Continue.
- Executor now supports steps that **create new files** (including new directories).
- Initial implementation of Orgit, the autonomous repository evolution engine.
- Cycle engine enforcing Understand → Analyze → Detect → Prioritize → Plan →
  Execute → Validate → Document → Continue.
- Dual Claude backend behind a `ClaudeProvider` seam: host `claude` CLI (subscription,
  default) and Anthropic API (`claude-opus-4-8`).
- Token-saving vector memory: LanceDB + local `fastembed` embeddings, incremental
  content-hash indexing, and focused retrieval.
- Static-first opportunity detection with an LLM judgement pass.
- Reversible git-native executor: one commit per task, validation via the target
  project's own build/test/lint, automatic rollback on failure.
- CLI commands: `analyze`, `audit`, `plan`, `evolve` (with `--dry-run`, `--max`,
  `--continuous`, `--max-iterations`, `--branch`), `improve`, `docs`, `explain`,
  `doctor`, `status`.
- Embedding-based semantic duplication detector — finds near-duplicate code across
  files by reusing the vectors already in memory, with zero additional Claude tokens.
- Learned project conventions persisted to `.orgit/conventions.json`, refined each run
  and fed into detection/execution prompts so changes match the project's house style.
- Repository health score (0–100) with a trend across runs, persisted to
  `.orgit/history.json` and surfaced in `audit` and `status`.
- `evolve --branch` applies changes on a fresh `orgit/evolve-*` branch (PR-ready).
- Repository automation (see [docs/AUTOMATION.md](docs/AUTOMATION.md)): Dependabot auto-merge for
  minor/patch updates (majors stay manual), an automated release + npm publish pipeline
  (release-please), and a welcome comment for external contributors' pull requests, plus a
  `CODEOWNERS` file for review routing.
- Test coverage reporting and thresholds (`pnpm test:coverage`, enforced in CI) so quality can
  only ratchet up; new unit tests for opportunity de-duplication, provider selection, and the
  hardened file reader.
- Robustness: the repo walk now skips oversized (>1.5 MB) and binary files (NUL-byte sniff) and
  a wider set of generated/media/archive extensions, so pointing Orgit at real-world repos with
  large data blobs or vendored binaries no longer wastes memory or embeddings.
- Programmatic API: the package now ships a typed public entry point (`main`/`types`/`exports`
  with generated `.d.ts`), so Orgit can be imported as a library, not only used as a CLI.

### Fixed

- Long-function detector no longer miscounts braces that appear inside strings or comments
  (`const s = "}"`, `/* } */`), which previously closed a function early and reported a wrong
  length (or missed long functions entirely).
- Parallel task-edit generation (`evolve --concurrency N`, default 4): the executor is
  split into a parallelizable generate phase and a sequential apply phase, with staleness
  detection that regenerates any edit whose source changed mid-run.
- Interactive mode (`evolve --interactive`): approve apply / skip / quit before each task,
  alongside the default hands-off automode.
- Documentation during refactor (`evolve --docs`, `--docs-commit`): generate developer docs
  for the changed code into `.orgit/` or, optionally, committed into the repo.
- Shared embedding-model cache (`~/.orgit-cache/`, override with `ORGIT_CACHE_DIR`) so
  the model downloads once across all repositories.
- Architecture documentation generation and Markdown + JSON reports.

[Unreleased]: https://github.com/Gerijacki/Orgit/commits/main
