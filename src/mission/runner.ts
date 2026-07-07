import type { Plan, Task, TaskResult } from "../core/types.js";
import type { RunContext } from "../engine/context.js";
import type { Engine } from "../engine/engine.js";
import type { Approver } from "../util/prompt.js";
import { loadConventions, renderConventions } from "../memory/conventions.js";
import { ReviewerAgent } from "../agents/reviewer.js";
import { TesterAgent } from "../agents/tester.js";
import { executeInWorktrees, partitionIndependent } from "../executor/worktree.js";
import { log } from "../util/log.js";
import { PlannerAgent } from "./planner.js";
import {
  createMission,
  loadMission,
  saveMission,
  addLog,
  runnableSteps,
  stepById,
  refreshStatus,
  progressOf,
  type Mission,
  type MissionStep,
} from "./mission.js";

/**
 * The coordinator agent. It owns the persistent mission and drives it forward across
 * runs: on each invocation it loads the mission from disk, figures out which steps are
 * runnable now (dependencies satisfied), dispatches them to worker agents (parallel
 * generation + sequential, validated apply), and records each step's outcome back to
 * disk immediately. Because state lives in `.orgit/mission.json`, the goal and the
 * exact next step survive any number of iterations — the user asks once, and Orgit
 * keeps its word until the mission is complete.
 */

export interface MissionRunOptions {
  /** Max steps to attempt this run (omit = all currently-runnable). */
  max?: number;
  concurrency?: number;
  approve?: Approver;
  /** Reset previously-blocked steps back to pending so they are retried this run. */
  retryBlocked?: boolean;
  /** Verify each step's edit against its intent before committing (default: true). */
  review?: boolean;
  /** Run independent steps genuinely concurrently in isolated git worktrees. */
  parallel?: boolean;
  /** Add a Test phase: write & run tests for each step's changed code. */
  test?: boolean;
}

export interface MissionRunResult {
  mission: Mission;
  attempted: number;
  completed: number;
  blocked: number;
}

/** Start a new mission: understand the repo, decompose the goal, and persist the plan. */
export async function startMission(
  ctx: RunContext,
  engine: Engine,
  goal: string,
): Promise<Mission> {
  const existing = await loadMission(ctx.workspace);
  if (existing && existing.status === "active") {
    throw new Error(
      `A mission is already active: "${existing.goal}". Finish it, or run \`orgit mission abandon\` first.`,
    );
  }

  const { model } = await engine.understand();
  const conventions = renderConventions(await loadConventions(ctx.workspace));

  log.step("Planner agent — decomposing the goal into steps");
  const planner = new PlannerAgent(ctx.provider, ctx.retriever);
  const steps = await planner.decompose(model, goal, conventions);

  const mission = createMission(goal, steps);
  await saveMission(ctx.workspace, mission);
  return mission;
}

/** Advance the active mission by executing its runnable steps. Resumes where it left off. */
export async function runMission(
  ctx: RunContext,
  engine: Engine,
  opts: MissionRunOptions = {},
): Promise<MissionRunResult> {
  const mission = await loadMission(ctx.workspace);
  if (!mission) {
    throw new Error('No active mission. Run `orgit mission start "<goal>"` first.');
  }
  if (mission.status === "abandoned") {
    throw new Error("The active mission was abandoned. Start a new one.");
  }
  if (mission.status === "completed") {
    log.success("Mission already completed. Nothing to do.");
    return { mission, attempted: 0, completed: 0, blocked: 0 };
  }

  log.heading(`Mission: ${mission.goal}`);

  // Retry blocked steps if asked — the tree was rolled back when they failed, so it is
  // safe to try them again (e.g. the model produces a valid edit on a second attempt).
  if (opts.retryBlocked) {
    const blocked = mission.steps.filter((s) => s.status === "blocked");
    for (const s of blocked) {
      s.status = "pending";
      s.note = undefined;
      addLog(mission, `Retrying ${s.id}: ${s.title}`);
    }
    if (blocked.length) await saveMission(ctx.workspace, mission);
  }

  const { model } = await engine.understand();

  let runnable = runnableSteps(mission);
  if (opts.max) runnable = runnable.slice(0, opts.max);

  if (runnable.length === 0) {
    const p = progressOf(mission);
    if (p.done === p.total) {
      mission.status = "completed";
      addLog(mission, "All steps complete — mission finished.");
      await saveMission(ctx.workspace, mission);
      log.success("Mission complete — every step is done. 🎉");
    } else {
      log.warn(
        `No runnable steps right now (${p.blocked} blocked, ${p.pending} pending on dependencies). Resolve blocked steps and run again.`,
      );
    }
    return { mission, attempted: 0, completed: 0, blocked: p.blocked };
  }

  log.step(`Dispatching ${runnable.length} step(s) to worker agents`);
  for (const s of runnable) {
    s.status = "in-progress";
    addLog(mission, `Started ${s.id}: ${s.title}`);
  }
  await saveMission(ctx.workspace, mission);

  // A reviewer agent gates each step against its intent before commit (meticulous by
  // default). Progress is persisted after EVERY step so an interruption never loses it.
  const reviewer = opts.review === false ? undefined : new ReviewerAgent(ctx.provider).asReviewer();
  const conventions = renderConventions(await loadConventions(ctx.workspace));
  const tester = opts.test
    ? new TesterAgent(ctx.provider, model, ctx.git, conventions).asTester()
    : undefined;
  const persistResult = async (r: TaskResult): Promise<void> => {
    const step = stepById(mission, r.taskId);
    if (!step) return;
    if (r.committed) {
      step.status = "done";
      if (r.commit) step.commits.push(r.commit);
      step.note = r.explanation;
      addLog(mission, `Completed ${step.id}: ${step.title}`);
    } else if (r.error === "skipped by user") {
      step.status = "pending";
      addLog(mission, `Skipped ${step.id} (user) — will retry next run`);
    } else {
      step.status = "blocked";
      step.note = r.error;
      addLog(mission, `Blocked ${step.id}: ${r.error ?? "no change"}`);
    }
    refreshStatus(mission);
    await saveMission(ctx.workspace, mission);
  };

  const tasks = runnable.map(stepToTask);

  if (opts.parallel) {
    // Genuine concurrency: independent (disjoint-file) steps run fully in parallel in
    // isolated worktrees; any remaining overlapping steps run sequentially afterward.
    if (!(await ctx.git.isRepo())) throw new Error("Not a git repository.");
    if (!(await ctx.git.isClean())) {
      throw new Error("Working tree is not clean — commit or stash before a parallel mission run.");
    }
    const { independent, rest } = partitionIndependent(tasks);
    await executeInWorktrees(model, independent, ctx.provider, ctx.git, {
      concurrency: opts.concurrency,
      conventions,
      reviewer,
      tester,
      onResult: persistResult,
    });
    if (rest.length > 0) {
      await engine.execute(
        model,
        { generatedAt: new Date().toISOString(), root: ctx.root, tasks: rest },
        {
          dryRun: false,
          concurrency: opts.concurrency,
          approve: opts.approve,
          reviewer,
          tester,
          onResult: persistResult,
        },
      );
    }
  } else {
    const plan: Plan = { generatedAt: new Date().toISOString(), root: ctx.root, tasks };
    await engine.execute(model, plan, {
      dryRun: false,
      concurrency: opts.concurrency,
      approve: opts.approve,
      reviewer,
      tester,
      onResult: persistResult,
    });
  }

  refreshStatus(mission);
  await saveMission(ctx.workspace, mission);

  const p = progressOf(mission);
  const completedThisRun = runnable.filter(
    (s) => stepById(mission, s.id)?.status === "done",
  ).length;
  const blockedThisRun = runnable.filter(
    (s) => stepById(mission, s.id)?.status === "blocked",
  ).length;

  if (p.done === p.total) {
    log.success("Mission complete — every step is done. 🎉");
  } else {
    log.success(
      `Progress: ${p.done}/${p.total} steps done (${p.percent}%). Run \`orgit mission run\` again to continue.`,
    );
  }
  return {
    mission,
    attempted: runnable.length,
    completed: completedThisRun,
    blocked: blockedThisRun,
  };
}

/** Convert a mission step into an executable task for the worker/executor. */
function stepToTask(step: MissionStep): Task {
  return {
    id: step.id,
    title: step.title,
    files: step.files,
    opportunityId: step.id,
    rationale: {
      why: step.description,
      improves: `mission step ${step.id}`,
      problem: step.description,
      impact: "Part of a larger mission; small, independent, and revertible on its own.",
    },
    benefit: 3,
    risk: 2,
    score: 1.5,
  };
}
