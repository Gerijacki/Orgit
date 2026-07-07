import { promises as fs } from "node:fs";
import path from "node:path";
import { buildContext } from "../engine/context.js";
import { Engine } from "../engine/engine.js";
import { summariseModel } from "../analysis/model.js";
import { computeHealth } from "../analysis/health.js";
import { renderAudit, renderPlan, renderResults, writeReport } from "../report/report.js";
import { appendHistory, loadHistory, renderTrend } from "../report/history.js";
import { writeArchitectureDoc } from "../docs/document.js";
import {
  buildChangeDoc,
  writeChangeDocs,
  type ChangeDocEntry,
  type ActiveDocsLevel,
} from "../docs/codedoc.js";
import { createInteractiveApprover } from "../util/prompt.js";
import { ReviewerAgent } from "../agents/reviewer.js";
import { TesterAgent } from "../agents/tester.js";
import { startMission, runMission } from "../mission/runner.js";
import { loadMission, saveMission, addLog, renderMission } from "../mission/mission.js";
import { execa } from "execa";
import { Retriever } from "../memory/retriever.js";
import { loadDecisions } from "../memory/decisions.js";
import { startServer } from "../server/server.js";
import { detectBackends } from "../providers/detect.js";
import { resolveModel } from "../providers/models.js";
import { workspaceExists, resolveWorkspace } from "../config/workspace.js";
import { loadConfig, type DocsLevel } from "../config/config.js";
import { log } from "../util/log.js";

export interface GlobalOpts {
  cwd: string;
}

/** Default number of tasks a plain `orgit evolve` applies per run (small & incremental). */
const DEFAULT_EVOLVE_MAX = 5;

/** `orgit analyze` — Understand + Analyze: build the mental model and index memory. */
export async function analyzeCmd(g: GlobalOpts): Promise<void> {
  const ctx = await buildContext(g.cwd, { withoutProvider: true });
  const engine = new Engine(ctx);
  const { model, index } = await engine.understand();
  log.heading("Repository");
  log.info(summariseModel(model));
  log.heading("Memory index");
  log.info(
    `+${index.added} added · ~${index.changed} changed · -${index.removed} removed · =${index.unchanged} unchanged · ${index.chunks} chunks embedded`,
  );
  log.success(`Memory ready at ${log.dim(ctx.workspace.memoryDir)}`);
}

/** `orgit audit` — analyst mode: report opportunities and a health score, change nothing. */
export async function auditCmd(g: GlobalOpts): Promise<void> {
  const ctx = await buildContext(g.cwd);
  const engine = new Engine(ctx);
  const { model } = await engine.understand();
  const scored = await engine.audit(model);

  const health = computeHealth(model, scored);
  const history = await appendHistory(ctx.workspace, {
    timestamp: new Date().toISOString(),
    score: health.score,
    grade: health.grade,
    files: model.totals.files,
    lines: model.totals.lines,
    opportunities: scored.length,
  });
  const trend = renderTrend(history, health.score);

  const md = renderAudit(model, scored, health, trend);
  const { md: file } = await writeReport(ctx.workspace, "audit", md, { scored, health });
  log.heading("Audit");
  log.info(md);
  log.success(`Health: ${health.score}/100 (grade ${health.grade}) — ${trend}`);
  log.success(`Report written to ${log.dim(file)}`);
}

/** `orgit plan` — planning mode: produce a task plan, change nothing. */
export async function planCmd(g: GlobalOpts): Promise<void> {
  const ctx = await buildContext(g.cwd);
  const engine = new Engine(ctx);
  const { model } = await engine.understand();
  const scored = await engine.audit(model);
  const plan = engine.plan(model, scored);
  const md = renderPlan(plan);
  const { md: file } = await writeReport(ctx.workspace, "plan", md, plan);
  log.heading("Plan");
  log.info(md);
  log.success(`Plan written to ${log.dim(file)}`);
}

export interface EvolveOpts extends GlobalOpts {
  dryRun: boolean;
  max?: number;
  /** Continuous mode: keep running cycles until no worthwhile improvement remains. */
  continuous?: boolean;
  /** Safety cap on continuous cycles. */
  maxIterations?: number;
  /** Apply changes on a fresh `orgit/evolve-<timestamp>` branch instead of the current one. */
  branch?: boolean;
  /** Generate task edits in parallel (overrides config). */
  concurrency?: number;
  /** Ask before applying each task ("va preguntant"). */
  interactive?: boolean;
  /** Generate documentation for the changed code after committing. */
  docs?: boolean;
  /** Documentation verbosity (overrides config.docsLevel). `none` disables docs. */
  docsLevel?: "none" | "minimal" | "standard" | "detailed";
  /** With --docs, write docs into the repo and commit them (default: into .orgit only). */
  docsCommit?: boolean;
  /** Verify each edit against its task with the reviewer agent before committing. */
  review?: boolean;
  /** Add a Test phase: write & run tests for the changed code. */
  test?: boolean;
}

/**
 * `orgit evolve` — execution / auto / continuous mode: run the full cycle and apply
 * changes. In continuous mode it repeats the cycle (re-understanding the repo after
 * each round, so memory picks up the committed changes) until a round produces no
 * further committed improvement or the iteration cap is reached (until stability).
 */
export async function evolveCmd(o: EvolveOpts): Promise<void> {
  if (o.max !== undefined && (!Number.isInteger(o.max) || o.max <= 0)) {
    throw new Error("--max must be a positive integer.");
  }
  if (
    o.maxIterations !== undefined &&
    (!Number.isInteger(o.maxIterations) || o.maxIterations <= 0)
  ) {
    throw new Error("--max-iterations must be a positive integer.");
  }
  if (o.concurrency !== undefined && (!Number.isInteger(o.concurrency) || o.concurrency <= 0)) {
    throw new Error("--concurrency must be a positive integer.");
  }

  const ctx = await buildContext(o.cwd);
  const engine = new Engine(ctx);
  const maxIterations = o.continuous ? (o.maxIterations ?? 5) : 1;
  const concurrency = o.concurrency ?? ctx.config.concurrency;
  // Bound a plain run: generating every task's edit up front is token-heavy and yields no
  // commit until it finishes. Default to a small batch (the tool's "small, incremental"
  // ethos) — raise it with --max N, or use --continuous to work through more over cycles.
  const max = o.max ?? DEFAULT_EVOLVE_MAX;
  const approver = o.interactive && !o.dryRun ? createInteractiveApprover() : undefined;

  // Branch isolation: apply changes on a fresh branch so the base branch stays pristine
  // and the run is ready to open as a pull request.
  if (o.branch && !o.dryRun) {
    if (!(await ctx.git.isRepo())) throw new Error("Not a git repository.");
    if (!(await ctx.git.isClean())) {
      throw new Error("Working tree is not clean. Commit or stash before using --branch.");
    }
    const branchName = `orgit/evolve-${new Date().toISOString().replace(/[:.]/g, "-")}`;
    await ctx.git.createBranch(branchName);
    log.success(`Working on new branch ${log.dim(branchName)}`);
  }

  const allResults: Awaited<ReturnType<Engine["execute"]>> = [];
  const taskTitles: Record<string, string> = {};
  let lastModel: Awaited<ReturnType<Engine["understand"]>>["model"] | undefined;

  try {
    for (let iteration = 1; iteration <= maxIterations; iteration++) {
      if (o.continuous) log.heading(`Cycle ${iteration}/${maxIterations}`);
      const { model } = await engine.understand();
      lastModel = model;
      const scored = await engine.audit(model);
      const plan = engine.plan(model, scored);
      for (const t of plan.tasks) taskTitles[t.id] = t.title;

      if (plan.tasks.length === 0) {
        log.success(
          iteration === 1
            ? "No worthwhile improvements found. Nothing to evolve."
            : "Reached a stable point — no further improvements found.",
        );
        break;
      }

      const count = Math.min(max, plan.tasks.length);
      if (!o.max && plan.tasks.length > max) {
        log.info(
          log.dim(
            `Plan has ${plan.tasks.length} tasks; applying the top ${max} this run (raise with --max N, or use --continuous).`,
          ),
        );
      }
      log.heading(`Executing ${count} task(s)`);
      const results = await engine.execute(model, plan, {
        dryRun: o.dryRun,
        max,
        concurrency,
        approve: approver?.approve,
        reviewer: o.review ? new ReviewerAgent(ctx.provider).asReviewer() : undefined,
        tester: o.test ? new TesterAgent(ctx.provider, model, ctx.git).asTester() : undefined,
      });
      allResults.push(...results);

      const committed = results.filter((r) => r.committed).length;
      if (o.dryRun || committed === 0) {
        if (o.continuous && committed === 0)
          log.success("Reached a stable point — no change committed this cycle.");
        break;
      }
    }
  } finally {
    approver?.close();
  }

  const md = renderResults(allResults);
  const { md: file } = await writeReport(ctx.workspace, "evolve", md, allResults);

  // Document: refresh the architecture overview, and — if requested — document the
  // changed code itself.
  if (!o.dryRun && lastModel && allResults.some((r) => r.committed)) {
    const { model } = await engine.understand();
    await writeArchitectureDoc(ctx.workspace, model, false);

    // Effective doc level: explicit --docs-level wins; else --docs uses the configured
    // level (default "standard"); else docs are off. `none` disables generation.
    const level: DocsLevel = o.docsLevel ?? (o.docs ? ctx.config.docsLevel : "none");
    if (level !== "none") {
      await generateDocsForChanges(ctx, allResults, taskTitles, Boolean(o.docsCommit), level);
    }
  }

  log.heading("Results");
  log.info(md);
  log.success(`Results written to ${log.dim(file)}`);
  if (o.dryRun) log.warn("Dry run — no files were modified.");
  if (o.branch && !o.dryRun && allResults.some((r) => r.committed)) {
    const branch = await ctx.git.currentBranch();
    log.success(
      `Changes are on branch ${log.dim(branch)} — push it and open a pull request to review.`,
    );
  }
}

/** Generate documentation for the code changed by committed tasks (opt-in `--docs`). */
async function generateDocsForChanges(
  ctx: Awaited<ReturnType<typeof buildContext>>,
  results: Awaited<ReturnType<Engine["execute"]>>,
  taskTitles: Record<string, string>,
  commitDocs: boolean,
  level: ActiveDocsLevel,
): Promise<void> {
  const committed = results.filter((r) => r.committed && r.changedFiles?.length);
  if (committed.length === 0) return;

  log.step(`Document (${level}) — generating docs for ${committed.length} changed task(s)`);
  const entries: ChangeDocEntry[] = [];
  for (const r of committed) {
    const entry = await buildChangeDoc(
      ctx.provider,
      ctx.root,
      r.taskId,
      taskTitles[r.taskId] ?? r.taskId,
      r.changedFiles!,
      level,
    );
    if (entry) entries.push(entry);
  }
  if (entries.length === 0) return;

  const { baseDir } = await writeChangeDocs(ctx.root, ctx.workspace, entries, {
    toRepo: commitDocs,
    dir: ctx.config.docsDir,
  });

  if (commitDocs) {
    await ctx.git.stageAll();
    await ctx.git.commit(
      `orgit: document changed code\n\nGenerated documentation for ${entries.length} task(s).\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`,
    );
    log.success(`Documentation committed under ${log.dim(ctx.config.docsDir)}`);
  } else {
    log.success(`Documentation written to ${log.dim(baseDir)}`);
  }
}

/** `orgit improve` — friendly one-shot: apply the single highest-value improvement. */
export async function improveCmd(g: GlobalOpts): Promise<void> {
  await evolveCmd({ ...g, dryRun: false, max: 1 });
}

/** `orgit docs` — generate an architecture overview from the mental model. */
export async function docsCmd(g: GlobalOpts, toRepo: boolean): Promise<void> {
  const ctx = await buildContext(g.cwd, { withoutProvider: true });
  const engine = new Engine(ctx);
  const { model } = await engine.understand();
  const file = await writeArchitectureDoc(ctx.workspace, model, toRepo);
  log.success(`Architecture doc written to ${log.dim(file)}`);
}

/** `orgit explain <query>` — answer a question about the repo using memory + Claude. */
export async function explainCmd(g: GlobalOpts, query: string): Promise<void> {
  const ctx = await buildContext(g.cwd);
  const engine = new Engine(ctx);
  await engine.understand();
  const hits = await ctx.retriever.retrieve(query, 10);
  if (hits.length === 0) {
    log.warn("Memory is empty. Run `orgit analyze` first.");
    return;
  }
  const context = Retriever.renderContext(hits);
  const answer = await ctx.provider.complete({
    system:
      "You explain code precisely and concisely, citing file:line where relevant. Base your answer only on the provided context.",
    prompt: `Question: ${query}\n\nRelevant code:\n${context}`,
    maxTokens: 2000,
  });
  log.heading("Explanation");
  log.info(answer);
}

/** `orgit doctor` — environment and backend diagnostics. */
export async function doctorCmd(g: GlobalOpts): Promise<void> {
  log.heading("Orgit doctor");
  log.info(`Node: ${process.version}`);

  const config = await loadConfig(g.cwd);
  const backends = await detectBackends();
  log.info(
    `Claude CLI: ${backends.cli.available ? `available (${backends.cli.version})` : "not found"}`,
  );
  log.info(
    `Anthropic API key: ${backends.api.available ? `set (${backends.api.source})` : "not set"}`,
  );

  const requested = (process.env.ORGIT_PROVIDER as string) ?? config.provider;
  const model = resolveModel(process.env.ORGIT_MODEL ?? config.model);
  const chosen =
    (requested === "cli" || requested === "auto") && backends.cli.available
      ? `CLI (subscription)`
      : (requested === "api" || requested === "auto") && backends.api.available
        ? `API`
        : "NONE — no backend available";
  log.info(`Selected provider: ${chosen}`);
  if (!chosen.startsWith("NONE")) log.info(`Model: ${model}`);
  log.info(`Embedding model: ${config.embeddingModel} (local, downloads on first use)`);

  const ws = resolveWorkspace(g.cwd);
  log.info(
    `Workspace: ${(await workspaceExists(g.cwd)) ? ws.dir : "not initialised (created on first run)"}`,
  );

  if (chosen.startsWith("NONE")) {
    log.error("No Claude backend available. Install the `claude` CLI or set ANTHROPIC_API_KEY.");
    // Signal not-ready so scripts and CI can gate on `orgit doctor`.
    process.exitCode = 1;
  } else {
    log.success("Ready.");
  }
}

/** `orgit status` — workspace / memory state. */
export async function statusCmd(g: GlobalOpts): Promise<void> {
  log.heading("Orgit status");
  if (!(await workspaceExists(g.cwd))) {
    log.warn("No .orgit workspace yet. Run `orgit analyze` to initialise memory.");
    return;
  }
  const ctx = await buildContext(g.cwd, { withoutProvider: true });
  const rows = await ctx.store.countRows();
  log.info(`Root: ${ctx.root}`);
  log.info(`Indexed chunks in memory: ${rows}`);

  const history = await loadHistory(ctx.workspace);
  const latestHealth = history.at(-1);
  if (latestHealth) {
    log.info(
      `Health: ${latestHealth.score}/100 (grade ${latestHealth.grade}) — ${renderTrend(history, latestHealth.score)}`,
    );
  }

  try {
    const reports = (await fs.readdir(ctx.workspace.reportsDir)).filter((f) => f.endsWith(".md"));
    log.info(`Reports: ${reports.length}`);
    const latest = reports.filter((f) => f.endsWith("-latest.md"));
    for (const r of latest) log.info(`  ${path.join(ctx.workspace.reportsDir, r)}`);
  } catch {
    log.info("Reports: 0");
  }

  const decisions = await loadDecisions(ctx.workspace);
  if (decisions.length > 0) {
    log.info(`Decision memory: ${decisions.length} recorded change(s) across runs`);
  }

  const mission = await loadMission(ctx.workspace);
  if (mission) {
    log.info(`Active mission: "${mission.goal}" (${mission.status})`);
  }
}

export interface UiOpts extends GlobalOpts {
  port?: number;
  open?: boolean;
}

/** `orgit ui` — start the local web dashboard (monitor + launch runs). Runs until Ctrl+C. */
export async function uiCmd(o: UiOpts): Promise<void> {
  const handle = await startServer(o.cwd, { port: o.port });
  log.heading("Orgit web UI");
  log.success(`Dashboard running at ${handle.url}`);
  log.info("Monitor analysis & health, launch runs, and watch progress live.");
  log.info("Press Ctrl+C to stop.");
  if (o.open) await openBrowser(handle.url);
  // Keep the process alive until interrupted.
  await new Promise<void>((resolve) => {
    process.on("SIGINT", () => {
      void handle.close().then(resolve);
    });
  });
}

/** Best-effort: open the default browser for the given URL (never throws). */
async function openBrowser(url: string): Promise<void> {
  try {
    if (process.platform === "win32") await execa("cmd", ["/c", "start", "", url]);
    else if (process.platform === "darwin") await execa("open", [url]);
    else await execa("xdg-open", [url]);
  } catch {
    /* opening a browser is a convenience, not a requirement */
  }
}

/** `orgit mission start "<goal>"` — state a large refactoring goal; Orgit decomposes it and remembers it. */
export async function missionStartCmd(g: GlobalOpts, goal: string): Promise<void> {
  if (!goal.trim())
    throw new Error('Provide a goal, e.g. orgit mission start "modularise the auth layer".');
  const ctx = await buildContext(g.cwd);
  const engine = new Engine(ctx);
  const mission = await startMission(ctx, engine, goal.trim());
  log.heading("Mission created");
  log.info(renderMission(mission));
  log.success(
    `Saved to ${log.dim(ctx.workspace.missionFile)} — run \`orgit mission run\` to begin.`,
  );
}

export interface MissionRunOpts extends GlobalOpts {
  max?: number;
  concurrency?: number;
  interactive?: boolean;
  continuous?: boolean;
  maxIterations?: number;
  retry?: boolean;
  review?: boolean;
  parallel?: boolean;
  test?: boolean;
}

/** `orgit mission run` — advance the active mission, resuming from where it left off. */
export async function missionRunCmd(o: MissionRunOpts): Promise<void> {
  if (o.max !== undefined && (!Number.isInteger(o.max) || o.max <= 0)) {
    throw new Error("--max must be a positive integer.");
  }
  const ctx = await buildContext(o.cwd);
  const engine = new Engine(ctx);
  const concurrency = o.concurrency ?? ctx.config.concurrency;
  const approver = o.interactive ? createInteractiveApprover() : undefined;

  const maxCycles = o.continuous ? (o.maxIterations ?? 20) : 1;
  try {
    for (let cycle = 1; cycle <= maxCycles; cycle++) {
      const result = await runMission(ctx, engine, {
        max: o.max,
        concurrency,
        approve: approver?.approve,
        review: o.review,
        parallel: o.parallel,
        test: o.test,
        // Only retry blocked steps on the first cycle, so a genuinely-broken step
        // doesn't loop forever under --continuous.
        retryBlocked: o.retry && cycle === 1,
      });
      // Stop the loop when the mission finished, or a cycle made no progress.
      if (
        result.mission.status === "completed" ||
        result.attempted === 0 ||
        result.completed === 0
      ) {
        break;
      }
    }
  } finally {
    approver?.close();
  }

  const mission = await loadMission(ctx.workspace);
  if (mission) {
    log.heading("Mission status");
    log.info(renderMission(mission));
  }
}

/** `orgit mission status` — show the remembered goal and the step-by-step progress. */
export async function missionStatusCmd(g: GlobalOpts): Promise<void> {
  if (!(await workspaceExists(g.cwd))) {
    log.warn('No .orgit workspace yet. Run `orgit mission start "<goal>"` to begin.');
    return;
  }
  const ctx = await buildContext(g.cwd, { withoutProvider: true });
  const mission = await loadMission(ctx.workspace);
  if (!mission) {
    log.warn('No active mission. Run `orgit mission start "<goal>"` to begin.');
    return;
  }
  log.info(renderMission(mission));
}

/** `orgit mission abandon` — stop tracking the active mission. */
export async function missionAbandonCmd(g: GlobalOpts): Promise<void> {
  const ctx = await buildContext(g.cwd, { withoutProvider: true });
  const mission = await loadMission(ctx.workspace);
  if (!mission || mission.status !== "active") {
    log.warn("No active mission to abandon.");
    return;
  }
  mission.status = "abandoned";
  addLog(mission, "Mission abandoned by user.");
  await saveMission(ctx.workspace, mission);
  log.success("Mission abandoned. Start a new one with `orgit mission start`.");
}
