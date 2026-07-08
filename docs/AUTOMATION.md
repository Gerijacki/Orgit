# Automation

Orgit's repository is automated end to end. This page lists the workflows and the
**one-time settings you must apply** (they can't live in the repo).

## Workflows

| Workflow                                                                    | Trigger             | What it does                                                                                                                                          |
| --------------------------------------------------------------------------- | ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`ci.yml`](../.github/workflows/ci.yml)                                     | push / PR to `main` | format · lint · typecheck · test · build on Node 20 & 22                                                                                              |
| [`dependabot-automerge.yml`](../.github/workflows/dependabot-automerge.yml) | Dependabot PRs      | auto-approves & auto-merges **minor/patch** updates once CI passes; **major** updates get a comment and wait for manual review                        |
| [`release.yml`](../.github/workflows/release.yml)                           | push to `main`      | release-please maintains a release PR (version bump + changelog from Conventional Commits); merging it tags a GitHub Release and **publishes to npm** |
| [`pr-welcome.yml`](../.github/workflows/pr-welcome.yml)                     | external PR opened  | posts a thank-you comment to non-maintainer contributors                                                                                              |
| [`dependabot.yml`](../.github/dependabot.yml)                               | weekly              | opens grouped dependency-update PRs (npm + GitHub Actions)                                                                                            |

## One-time setup

### 1. Secrets

- **`NPM_TOKEN`** — an npm **automation** access token, added under
  _Settings → Secrets and variables → Actions_. Required for `release.yml` to publish.
  (The package name `orgit` must be available/owned by you on npm.)
- `GITHUB_TOKEN` is provided automatically — nothing to add.

### 2. Repository settings (Settings → General)

Under **Pull Requests**:

- ✅ **Allow auto-merge** — required for the Dependabot auto-merge workflow.
- ✅ **Allow squash merging** (the automerge uses `--squash`).
- (Optional) Automatically delete head branches.

Under **Actions → General → Workflow permissions**:

- ✅ **Allow GitHub Actions to create and approve pull requests** — **required for
  `release.yml`.** Without it, release-please builds the release but fails on the last step
  with _"GitHub Actions is not permitted to create or approve pull requests."_ The workflow
  already grants `contents: write` + `pull-requests: write`; this repo-level toggle is a
  separate gate that is **off by default**.

Or via the CLI (after `gh auth login`):

```bash
gh api -X PUT repos/Gerijacki/Orgit/actions/permissions/workflow \
  -f default_workflow_permissions=write \
  -F can_approve_pull_request_reviews=true
```

### 3. Branch protection on `main` (enforces "no merge without approval")

Require an approving review before anything merges. In _Settings → Branches → Add rule_
for `main`:

- ✅ Require a pull request before merging → **Require approvals: 1**
- ✅ Require status checks to pass → add **`build-test (node 20)`** and **`build-test (node 22)`**
  (so `--auto` merges only after CI is green)
- ✅ Dismiss stale approvals; ✅ Require conversation resolution (recommended)

Or via the CLI (after `gh auth login`):

```bash
gh api -X PUT repos/Gerijacki/Orgit/branches/main/protection --input - <<'JSON'
{
  "required_status_checks": {
    "strict": true,
    "contexts": ["build-test (node 20)", "build-test (node 22)"]
  },
  "enforce_admins": false,
  "required_pull_request_reviews": { "required_approving_review_count": 1 },
  "restrictions": null
}
JSON
```

> **Contributor approval vs. Dependabot auto-merge — the tradeoff.** "Require approvals: 1"
> lets the Dependabot workflow's own approval satisfy the gate for safe minor/patch bumps,
> while human PRs from non-contributors still wait for a maintainer to review and approve.
> If you want a _hard_ maintainer gate on human PRs, also enable **Require review from Code
> Owners** (a [`CODEOWNERS`](../.github/CODEOWNERS) file is included) — but note that the
> Dependabot bot is not a code owner, so with that setting you'd approve Dependabot PRs
> yourself (or configure a repository **ruleset** that bypasses the requirement for
> `dependabot[bot]`). The default here (1 approval, no code-owner requirement) keeps
> Dependabot fully automated while still blocking un-reviewed human merges.

## Releasing

Commit to `main` using [Conventional Commits](https://www.conventionalcommits.org/)
(`feat:`, `fix:`, `chore:`, …). release-please accumulates them into a release PR;
**merging that PR** cuts the release and publishes to npm automatically. No manual
version bumps or `npm publish` needed.

Versioning is configured in [`release-please-config.json`](../release-please-config.json)
(manifest mode; the current version lives in
[`.release-please-manifest.json`](../.release-please-manifest.json)). While the project is
pre-1.0, `bump-minor-pre-major` + `bump-patch-for-minor-pre-major` keep it in **0.x**: a
breaking change bumps the **minor** (0.1.0 → 0.2.0) and a feature bumps the **patch**, so it
won't jump to 1.0.0 until you're ready. When you want the 1.0.0 release, set the manifest to
`1.0.0` (or remove those two flags).
