import type { MentalModel, Plan, ScoredOpportunity, TaskResult } from "../core/types.js";
import type { RunContext } from "./context.js";
import type { IndexStats } from "../memory/indexer.js";
import { buildMentalModel } from "../analysis/model.js";
import { detectOpportunities } from "../detectors/detect.js";
import { prioritize } from "../planner/prioritize.js";
import { buildPlan } from "../planner/plan.js";
import { generateEdit, applyEdit, isStale } from "../executor/execute.js";
import {
  loadConventions,
  saveConventions,
  deriveConventions,
  renderConventions,
} from "../memory/conventions.js";
import { loadDecisions, renderDecisions, recordTaskDecision } from "../memory/decisions.js";
import { mapWithConcurrency } from "../util/concurrency.js";
import type { Approver } from "../util/prompt.js";
import type { Reviewer } from "../agents/reviewer.js";
import type { Tester } from "../agents/tester.js";
import { log } from "../util/log.js";

/**
 * The cycle engine. It enforces the mandatory order from the design spec and never
 * modifies before understanding:
 *
 *   Understand → Analyze → Detect → Prioritize → Plan → Execute → Validate / Review → Test → Document
 *
 * Each public method is one phase (or a composition of earlier phases), so commands
 * can enter at the depth their mode requires (audit / plan / execute / auto / continuous).
 */
export class Engine {
  constructor(private readonly ctx: RunContext) {}

  /** Understand + index into memory. Pure understanding — no writes to the repo. */
  async understand(): Promise<{ model: MentalModel; index: IndexStats }> {
    log.step("Understand — building repository mental model");
    const model = await buildMentalModel(this.ctx.root, this.ctx.config);
    log.debug(`model: ${model.totals.files} files, ${model.totals.lines} lines`);

    log.step("Indexing into vector memory (incremental)");
    const index = await this.ctx.indexer.sync(model);
    log.debug(
      `index: +${index.added} ~${index.changed} -${index.removed} (=${index.unchanged}), ${index.chunks} chunks embedded`,
    );

    // Learn the project: derive and persist conventions so each run gets smarter.
    try {
      const prev = await loadConventions(this.ctx.workspace);
      await saveConventions(this.ctx.workspace, await deriveConventions(model, prev));
    } catch (err) {
      log.debug(`conventions learning skipped: ${(err as Error).message}`);
    }

    return { model, index };
  }

  /** Detect + Prioritize. Returns ranked opportunities without planning changes. */
  async audit(model: MentalModel): Promise<ScoredOpportunity[]> {
    log.step("Detect — finding improvement opportunities");
    const conventions = renderConventions(await loadConventions(this.ctx.workspace));
    const decisions = renderDecisions(await loadDecisions(this.ctx.workspace));
    const opportunities = await detectOpportunities(model, {
      provider: this.ctx.provider,
      retriever: this.ctx.retriever,
      store: this.ctx.store,
      config: this.ctx.config,
      conventions,
      decisions,
    });
    log.step("Prioritize — ranking by benefit / risk");
    return prioritize(opportunities);
  }

  /** Plan. Turns ranked opportunities into a plan of small reversible tasks. */
  plan(model: MentalModel, scored: ScoredOpportunity[]): Plan {
    log.step("Plan — building task plan");
    return buildPlan(model, scored, this.ctx.config);
  }

  /**
   * Execute + Validate. Generates each task's edit — fanned out across parallel
   * workers for speed — then applies them one at a time, each as its own commit, hard-
   * resetting any task whose validation fails. Requires a clean tree unless dry-run.
   *
   * `approve` (interactive mode) is consulted before each task; `concurrency` bounds the
   * parallel edit generation. A parallel-generated edit that becomes stale (an earlier
   * task in this run touched its files) is regenerated against fresh content.
   */
  async execute(
    model: MentalModel,
    plan: Plan,
    opts: {
      dryRun: boolean;
      max?: number;
      concurrency?: number;
      approve?: Approver;
      /** Intent gate: verify each edit accomplishes its task before committing. */
      reviewer?: Reviewer;
      /** Test phase: write & run tests for the changed code after each committed task. */
      tester?: Tester;
      /** Fired after each task is applied — lets a mission persist progress per step. */
      onResult?: (result: TaskResult) => void | Promise<void>;
    },
  ): Promise<TaskResult[]> {
    const tasks = opts.max ? plan.tasks.slice(0, opts.max) : plan.tasks;

    if (!opts.dryRun) {
      if (!(await this.ctx.git.isRepo())) {
        throw new Error("Not a git repository. Orgit needs git to make reversible changes.");
      }
      if (!(await this.ctx.git.isClean())) {
        throw new Error(
          "Working tree is not clean. Commit or stash changes before running orgit evolve (Orgit needs a clean baseline to stay reversible).",
        );
      }
      const s = model.signals.scripts;
      if (!s.build && !s.test && !s.lint) {
        log.warn(
          "No build/test/lint script detected — changes will be committed WITHOUT automated validation. Review each commit before pushing.",
        );
      }
    }

    const conventions = renderConventions(await loadConventions(this.ctx.workspace));
    const limit = Math.max(1, opts.concurrency ?? 1);

    // Analyze + Modify: generate every task's edit, in parallel where allowed.
    log.step(
      `Modify — generating ${tasks.length} edit(s)${limit > 1 ? ` (${limit} in parallel)` : ""}`,
    );
    const generated = await mapWithConcurrency(tasks, limit, (task) =>
      generateEdit(model, task, this.ctx.provider, conventions),
    );

    if (opts.dryRun) {
      return tasks.map((task, i) => ({
        taskId: task.id,
        applied: false,
        committed: false,
        rolledBack: false,
        explanation: generated[i]!.explanation,
        error: generated[i]!.skip,
      }));
    }

    // Review + Verify + Finalize: apply sequentially on the shared tree.
    const results: TaskResult[] = [];
    for (let i = 0; i < tasks.length; i++) {
      const task = tasks[i]!;
      let gen = generated[i]!;

      if (opts.approve) {
        const decision = await opts.approve(`Apply ${task.id}: ${task.title}?`);
        if (decision === "quit") {
          log.warn("Stopped by user.");
          break;
        }
        if (decision === "skip") {
          log.info(`${task.id} skipped by user`);
          const skipResult: TaskResult = {
            taskId: task.id,
            applied: false,
            committed: false,
            rolledBack: false,
            error: "skipped by user",
          };
          results.push(skipResult);
          if (opts.onResult) await opts.onResult(skipResult);
          continue;
        }
      }

      // A parallel-generated edit may be stale if an earlier task touched its files.
      if (await isStale(model, gen)) {
        log.debug(`${task.id}: regenerating (source changed since parallel generation)`);
        gen = await generateEdit(model, task, this.ctx.provider, conventions);
      }

      // Reviewer agent: intent gate before we touch the tree. Rejected edits are not
      // applied, so nothing is committed that doesn't match its task.
      if (opts.reviewer && !gen.skip && gen.edits.length > 0) {
        const review = await opts.reviewer(task, gen);
        if (!review.approved) {
          log.warn(`${task.id} rejected by reviewer: ${review.reason}`);
          const rejected: TaskResult = {
            taskId: task.id,
            applied: false,
            committed: false,
            rolledBack: false,
            explanation: gen.explanation,
            error: `rejected by reviewer: ${review.reason}`,
          };
          results.push(rejected);
          if (opts.onResult) await opts.onResult(rejected);
          continue;
        }
      }

      log.step(`Execute — ${task.id}: ${task.title}`);
      const result = await applyEdit(model, task, gen, this.ctx.git);
      results.push(result);
      if (result.committed) {
        log.success(`${task.id} committed (${result.commit?.slice(0, 8)})`);
        // Remember this decision across runs so future runs don't re-propose it.
        await recordTaskDecision(this.ctx.workspace, {
          title: task.title,
          files: result.changedFiles ?? task.files,
          rationale: task.rationale.why,
          commit: result.commit,
        }).catch((err) => log.debug(`decision memory skipped: ${(err as Error).message}`));
      } else if (result.rolledBack) log.warn(`${task.id} rolled back: ${result.error}`);
      else log.warn(`${task.id} skipped: ${result.error ?? "no change"}`);

      // Test phase: write & run tests for the code this task changed.
      if (opts.tester && result.committed) {
        const outcome = await opts.tester(task, result.changedFiles ?? []);
        result.tests = {
          added: outcome.wrote.length,
          passed: outcome.passed,
          committed: outcome.committed,
          note: outcome.note,
        };
        if (outcome.committed) {
          log.success(`Test — ${task.id}: ${outcome.wrote.length} test(s) added and passing`);
        } else if (!outcome.passed) {
          log.warn(`Test — ${task.id}: generated tests failed — ${outcome.note}`);
        } else if (outcome.note) {
          log.debug(`Test — ${task.id}: ${outcome.note}`);
        }
      }

      if (opts.onResult) await opts.onResult(result);
    }
    return results;
  }
}
