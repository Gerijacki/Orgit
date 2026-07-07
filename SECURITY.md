# Security Policy

## Reporting a vulnerability

Please **do not** open a public issue for security vulnerabilities.

Instead, report privately via [GitHub Security Advisories](https://github.com/Gerijacki/Orgit/security/advisories/new)
(preferred), or by opening a minimal issue asking a maintainer to contact you if advisories are unavailable.

We aim to acknowledge reports within 7 days.

## What to know before running Orgit

Orgit is an automation tool that operates on a target repository. Be aware of what it does:

- **It executes the target repository's own scripts.** During validation, Orgit runs the
  project's `build` / `test` / `lint` commands (from `package.json`) via a shell. Only run
  Orgit on repositories whose build scripts you trust — the same trust you already extend by
  running `npm test` in that project yourself.
- **It sends code to Claude.** The `audit`, `plan`, `evolve`, `improve`, and `explain` commands
  send retrieved code snippets to Claude — either through your local `claude` CLI (your Claude
  Code subscription) or the Anthropic API, depending on configuration. Nothing is sent by
  `analyze`, `docs`, `status`, or `doctor`.
- **Embeddings are computed locally** (via `fastembed`); no code leaves your machine for indexing.
- **It only writes as git commits, on a clean tree.** `evolve` refuses to run unless the target is
  a git repository with a clean working tree, and any change that fails validation is rolled back.
  Review commits before pushing.

## Supported versions

Orgit is pre-1.0; security fixes land on `main`. Pin a commit if you need stability.
