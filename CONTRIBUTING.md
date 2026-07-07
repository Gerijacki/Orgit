# Contributing to Orgit

Thanks for your interest in improving Orgit! This project follows the same philosophy
it applies to other repos: small, well-justified, reversible changes.

## Development setup

```bash
pnpm install        # installs deps; approves native builds (onnxruntime, lancedb)
pnpm build          # bundle with tsup
pnpm test           # run the vitest suite (unit + offline e2e)
pnpm test:e2e       # also run the gated memory e2e (downloads the embedding model)
pnpm typecheck      # tsc --noEmit
pnpm lint           # eslint
pnpm format:check   # prettier --check .
```

### Test tiers

- **Unit tests** (`src/**/*.test.ts`) — pure/deterministic logic; fast, offline.
- **Offline e2e** (`test/e2e/{engine,cli}.e2e.test.ts`) — the engine runs a real
  audit → plan → execute → validate → commit/rollback cycle against a temp git repo
  with a fake Claude backend, and the CLI is driven as a real subprocess. No network.
- **Gated memory e2e** (`test/e2e/memory.e2e.test.ts`) — the real fastembed + LanceDB
  pipeline. Skipped unless `ORGIT_E2E=1` (it downloads the embedding model on first run).
  Run it with `pnpm test:e2e`.

Run the CLI in dev without building:

```bash
pnpm orgit doctor
pnpm orgit -- analyze -C ../some-project
```

## Requirements

- Node.js ≥ 20
- One Claude backend for the LLM-driven commands (`audit`, `plan`, `evolve`, `explain`):
  - the `claude` CLI on your PATH (subscription — the default), **or**
  - `ANTHROPIC_API_KEY` set (API).
- `analyze`, `docs`, `status`, and `doctor` run without any Claude backend.

## Where to start

- **New static detectors** in `src/analysis/static.ts` — deterministic checks are the
  cheapest wins and keep token usage down.
- **Language support** in `src/memory/chunker.ts` and `src/util/fsutil.ts`.
- **Report formats** in `src/report/report.ts`.

## Commit messages — Conventional Commits (required)

Releases are automated with [release-please](https://github.com/googleapis/release-please),
which derives the next version and the changelog **from your commit messages**. Please use
[Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add a Python chunker
fix: skip binary files in the repo walk
docs: clarify the mission workflow
chore: bump dependencies
```

- `feat:` → minor bump · `fix:` → patch bump · `feat!:` / a `BREAKING CHANGE:` footer → major.
- `docs:`, `chore:`, `refactor:`, `test:`, `ci:` don't trigger a release but keep history tidy.

PR titles should follow the same convention (squash-merge uses the title as the commit).

## Guidelines

- Keep functions small and single-purpose; match the surrounding style.
- Add a vitest test for new pure logic (`*.test.ts` next to the source). New code should keep
  coverage above the thresholds in `vitest.config.ts` — run `pnpm test:coverage` to check.
- Every PR should explain **why**, **what it improves**, and **the impact** — the same
  four-part justification Orgit itself writes for each task.
- `pnpm test`, `pnpm typecheck`, and `pnpm lint` must pass.
