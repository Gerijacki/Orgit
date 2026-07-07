# Web UI

`orgit ui` starts a small local dashboard to **monitor** a repository and **launch runs** without
leaving the browser. It has **zero extra dependencies** — Node's built-in HTTP server plus a single
self-contained HTML page (inline CSS/JS, no framework, no build step, no external requests).

```bash
orgit ui                 # http://127.0.0.1:4319
orgit ui --port 8080     # choose a port
orgit ui --open          # also open it in your browser
orgit -C ../my-app ui    # target another repo
```

The server binds to `127.0.0.1` only and runs until you press `Ctrl+C`.

## What it shows

Everything is read live from the repo and the `.orgit/` workspace (the same sources as
`orgit status`), plus a fresh, token-free static/semantic analysis:

- **Health** — the 0–100 score, letter grade, trend vs. the last run, and key metrics.
- **Analysis** — file/line totals, languages, top modules, indexed memory chunks.
- **Opportunities** — counts by kind from the deterministic detectors.
- **Mission** — the remembered goal, a progress bar, and the step-by-step checklist.
- **Decision memory** — what Orgit has already done across runs.
- **Conventions** — the learned house style.
- **Reports** — click a report to read it inline.

## Launching runs

The control bar posts to a small JSON API and streams progress back over **Server-Sent Events**, so
the live log mirrors exactly what the CLI prints. You can run `analyze`, `audit`, `plan`, `evolve`,
and `mission run`, with a few options exposed (dry-run, `--max`, doc level, model).

- **Safety.** `evolve` defaults to a **dry run** from the UI — applying changes to your repo must be
  chosen explicitly. As on the CLI, a real run still requires a clean git working tree and rolls back
  any change that fails the project's own build/test/lint.
- **One at a time.** Only a single run executes at once; launching another while one is in progress
  returns a conflict.
- **Model.** The model box maps to the same `--model` selection the CLI uses (aliases like `sonnet`
  work).

## API (for scripting)

The dashboard is just a client of a tiny local API you can call yourself:

| Route                        | Method | Purpose                                                       |
| ---------------------------- | ------ | ------------------------------------------------------------- |
| `/api/state`                 | GET    | JSON snapshot (analysis, health, mission, decisions, reports) |
| `/api/report?name=<file>.md` | GET    | A report's Markdown (from `.orgit/reports/`)                  |
| `/api/run`                   | POST   | `{ "command": "evolve", "options": { "dryRun": true } }`      |
| `/api/events`                | GET    | Server-Sent Events: `log`, `run-start`, `run-done`            |

The same functions are exported from the package (`startServer`, `buildStateSnapshot`) for embedding
in your own tooling.
