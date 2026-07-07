import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { simpleGit } from "simple-git";
import type { MentalModel, Task, TaskResult } from "../core/types.js";
import type { ClaudeProvider } from "../providers/types.js";
import type { Reviewer } from "../agents/reviewer.js";
import type { Tester } from "../agents/tester.js";
import { Git } from "../util/git.js";
import { validate } from "../validation/validate.js";
import { generateEdit, commitMessage, type GeneratedEdit } from "./execute.js";
import { mapWithConcurrency } from "../util/concurrency.js";
import { fileExists } from "../util/fsutil.js";
import { log } from "../util/log.js";

/**
 * Genuinely-parallel execution of independent tasks.
 *
 * Each task runs fully isolated in its own **git worktree** (a separate working tree
 * and index that shares the object database): generate → review → apply → validate →
 * commit, all concurrently. The resulting commits are then cherry-picked onto the base
 * branch in order. Because the tasks are independent (disjoint files), the picks apply
 * cleanly. This parallelizes the expensive part — running the project's test suite per
 * step — not just the LLM generation.
 */

export interface WorktreeOptions {
  concurrency?: number;
  conventions?: string;
  reviewer?: Reviewer;
  /** Test phase: run after a task's commit is cherry-picked onto the base branch. */
  tester?: Tester;
  onResult?: (result: TaskResult) => void | Promise<void>;
}

/** Split tasks into a set with mutually-disjoint files (safe to run in parallel) and the rest. */
export function partitionIndependent(tasks: Task[]): { independent: Task[]; rest: Task[] } {
  const used = new Set<string>();
  const independent: Task[] = [];
  const rest: Task[] = [];
  for (const t of tasks) {
    if (t.files.length > 0 && t.files.some((f) => used.has(f))) {
      rest.push(t);
    } else {
      t.files.forEach((f) => used.add(f));
      independent.push(t);
    }
  }
  return { independent, rest };
}

interface Prepared {
  task: Task;
  gen: GeneratedEdit;
  /** Set once a worktree has been created for this task. */
  wtDir?: string;
  commit?: string;
  error?: string;
  applied: boolean;
  explanation?: string;
}

export async function executeInWorktrees(
  model: MentalModel,
  tasks: Task[],
  provider: ClaudeProvider,
  mainGit: Git,
  opts: WorktreeOptions = {},
): Promise<TaskResult[]> {
  if (tasks.length === 0) return [];
  const limit = Math.max(1, opts.concurrency ?? tasks.length);
  log.step(`Executing ${tasks.length} independent step(s) in isolated worktrees`);

  // 1. Generate + review in parallel (no git, no writes).
  const prepared: Prepared[] = await mapWithConcurrency(tasks, limit, async (task) => {
    const gen = await generateEdit(model, task, provider, opts.conventions);
    if (gen.skip || gen.edits.length === 0) {
      return {
        task,
        gen,
        applied: false,
        error: gen.skip ?? "no edits",
        explanation: gen.explanation,
      };
    }
    if (opts.reviewer) {
      const review = await opts.reviewer(task, gen);
      if (!review.approved) {
        return {
          task,
          gen,
          applied: false,
          error: `rejected by reviewer: ${review.reason}`,
          explanation: gen.explanation,
        };
      }
    }
    return { task, gen, applied: false, explanation: gen.explanation };
  });

  const accepted = prepared.filter((p) => !p.error);

  // 2. Create worktrees serially (fast; avoids concurrent index-lock contention).
  for (const p of accepted) {
    p.wtDir = path.join(os.tmpdir(), `orgit-wt-${randomUUID()}`);
    await mainGit.addWorktree(p.wtDir);
    await linkNodeModules(model.root, p.wtDir);
  }

  // 3. Apply + validate + commit in PARALLEL — the expensive part (each test suite runs
  //    concurrently in its own worktree).
  await mapWithConcurrency(accepted, limit, async (p) => {
    try {
      for (const e of p.gen.edits) {
        const abs = path.join(p.wtDir!, e.path);
        await fs.mkdir(path.dirname(abs), { recursive: true });
        await fs.writeFile(abs, e.content, "utf8");
      }
      const v = await validate(p.wtDir!, model.signals);
      if (!v.ok) {
        p.applied = true;
        p.error = "validation failed";
        return;
      }
      const wtGit = simpleGit(p.wtDir!);
      await wtGit.add(["-A"]);
      await wtGit.commit(commitMessage(p.task, p.gen.explanation ?? ""));
      // Read the sha directly — in a detached-HEAD worktree the commit-result parse can
      // return a "HEAD <sha>" string that breaks cherry-pick.
      p.commit = (await wtGit.revparse(["HEAD"])).trim();
      p.applied = true;
    } catch (err) {
      p.error = (err as Error).message;
    }
  });

  // 4. Remove worktrees serially.
  for (const p of accepted) {
    if (p.wtDir) {
      await mainGit.removeWorktree(p.wtDir).catch(() => {});
      await fs.rm(p.wtDir, { recursive: true, force: true }).catch(() => {});
    }
  }

  // 5. Cherry-pick the successful commits onto the base branch, in order (disjoint → clean).
  const results: TaskResult[] = [];
  for (const p of prepared) {
    let result: TaskResult;
    if (p.commit) {
      try {
        await mainGit.cherryPick(p.commit);
        const changedFiles = p.gen.edits.map((e) => e.path);
        result = {
          taskId: p.task.id,
          applied: true,
          committed: true,
          rolledBack: false,
          commit: await mainGit.headSha(),
          explanation: p.explanation,
          changedFiles,
        };
        // Test phase on the base branch (sequential, after the pick).
        if (opts.tester) {
          const outcome = await opts.tester(p.task, changedFiles);
          result.tests = {
            added: outcome.wrote.length,
            passed: outcome.passed,
            committed: outcome.committed,
            note: outcome.note,
          };
          if (!outcome.passed) log.warn(`Test — ${p.task.id}: generated tests failed`);
        }
      } catch (err) {
        await mainGit.cherryPickAbort().catch(() => {});
        result = {
          taskId: p.task.id,
          applied: true,
          committed: false,
          rolledBack: true,
          error: `cherry-pick failed: ${(err as Error).message}`,
          explanation: p.explanation,
        };
      }
    } else {
      result = {
        taskId: p.task.id,
        applied: p.applied,
        committed: false,
        rolledBack: p.applied,
        error: p.error,
        explanation: p.explanation,
      };
    }
    results.push(result);
    if (result.committed) log.success(`${p.task.id} committed (${result.commit?.slice(0, 8)})`);
    else log.warn(`${p.task.id} not applied: ${result.error ?? "no change"}`);
    if (opts.onResult) await opts.onResult(result);
  }
  return results;
}

/** Best-effort: make the project's installed dependencies visible inside the worktree. */
async function linkNodeModules(root: string, wtDir: string): Promise<void> {
  const src = path.join(root, "node_modules");
  if (!(await fileExists(src))) return;
  try {
    await fs.symlink(src, path.join(wtDir, "node_modules"), "junction");
  } catch {
    // Non-fatal: validation may still pass (e.g. no deps needed) or the step blocks safely.
  }
}
