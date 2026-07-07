#!/usr/bin/env node
import path from "node:path";
import { Command } from "commander";
import { setVerbose, log } from "../util/log.js";
import {
  analyzeCmd,
  auditCmd,
  planCmd,
  evolveCmd,
  improveCmd,
  docsCmd,
  explainCmd,
  doctorCmd,
  statusCmd,
  uiCmd,
  missionStartCmd,
  missionRunCmd,
  missionStatusCmd,
  missionAbandonCmd,
  type GlobalOpts,
} from "./commands.js";

/**
 * Orgit CLI — the Autonomous Repository Evolution Engine for Claude Code.
 * Commands map onto the operating modes from INSTRUCTIONS.md.
 */
const program = new Command();

program
  .name("orgit")
  .description("Autonomous repository evolution engine powered by Claude Code.")
  .version("0.1.0")
  .option("-C, --cwd <dir>", "target repository directory", process.cwd())
  .option("-v, --verbose", "verbose output", false)
  .option("-p, --provider <kind>", "claude backend: cli | api | auto")
  .option("-m, --model <name>", "claude model id or alias (opus | sonnet | haiku | fable)");

function globals(): GlobalOpts {
  const opts = program.opts<{ cwd: string; verbose: boolean; provider?: string; model?: string }>();
  setVerbose(Boolean(opts.verbose));
  if (opts.provider) process.env.ORGIT_PROVIDER = opts.provider;
  if (opts.model) process.env.ORGIT_MODEL = opts.model;
  return { cwd: path.resolve(opts.cwd) };
}

async function run(fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (err) {
    log.error((err as Error).message);
    process.exitCode = 1;
  }
}

program
  .command("analyze")
  .description("Understand + Analyze: build the mental model and index memory")
  .action(() => run(() => analyzeCmd(globals())));

program
  .command("audit")
  .description("Analyst mode: detect and report opportunities (no changes)")
  .action(() => run(() => auditCmd(globals())));

program
  .command("plan")
  .description("Planning mode: produce a task plan (no changes)")
  .action(() => run(() => planCmd(globals())));

program
  .command("evolve")
  .description("Execution / auto / continuous mode: run the full cycle and apply improvements")
  .option("--dry-run", "plan and generate edits without writing or committing", false)
  .option("--max <n>", "maximum number of tasks to apply per cycle", (v) => parseInt(v, 10))
  .option("--continuous", "keep running cycles until the project reaches a stable point", false)
  .option("--max-iterations <n>", "cap on continuous cycles (default 5)", (v) => parseInt(v, 10))
  .option("--branch", "apply changes on a fresh orgit/evolve-* branch (PR-ready)", false)
  .option("--concurrency <n>", "generate this many task edits in parallel", (v) => parseInt(v, 10))
  .option("--interactive", "ask before applying each task", false)
  .option("--docs", "generate documentation for the changed code", false)
  .option("--docs-level <level>", "doc verbosity: none | minimal | standard | detailed")
  .option("--docs-commit", "with --docs, write docs into the repo and commit them", false)
  .option("--review", "verify each edit against its task before committing", false)
  .option("--test", "write & run tests for the changed code (Test phase)", false)
  .action(
    (opts: {
      dryRun: boolean;
      max?: number;
      continuous: boolean;
      maxIterations?: number;
      branch: boolean;
      concurrency?: number;
      interactive: boolean;
      docs: boolean;
      docsLevel?: string;
      docsCommit: boolean;
      review: boolean;
      test: boolean;
    }) => {
      const levels = ["none", "minimal", "standard", "detailed"];
      if (opts.docsLevel && !levels.includes(opts.docsLevel)) {
        throw new Error(`--docs-level must be one of: ${levels.join(", ")}`);
      }
      return run(() =>
        evolveCmd({
          ...globals(),
          dryRun: opts.dryRun,
          max: opts.max,
          continuous: opts.continuous,
          maxIterations: opts.maxIterations,
          branch: opts.branch,
          concurrency: opts.concurrency,
          interactive: opts.interactive,
          docs: opts.docs,
          docsLevel: opts.docsLevel as "none" | "minimal" | "standard" | "detailed" | undefined,
          docsCommit: opts.docsCommit,
          review: opts.review,
          test: opts.test,
        }),
      );
    },
  );

program
  .command("improve")
  .description("Apply the single highest-value improvement")
  .action(() => run(() => improveCmd(globals())));

program
  .command("docs")
  .description("Generate an architecture overview from the mental model")
  .option("--to-repo", "write into the repo's docs/ instead of .orgit/reports", false)
  .action((opts: { toRepo: boolean }) => run(() => docsCmd(globals(), opts.toRepo)));

program
  .command("explain <query...>")
  .description("Answer a question about the repository using memory + Claude")
  .action((query: string[]) => run(() => explainCmd(globals(), query.join(" "))));

const mission = program
  .command("mission")
  .description("Long-running, goal-directed refactoring that Orgit remembers across runs");

mission
  .command("start <goal...>")
  .description("State a large goal; Orgit decomposes it into steps and remembers it")
  .action((goal: string[]) => run(() => missionStartCmd(globals(), goal.join(" "))));

mission
  .command("run")
  .description("Advance the active mission, resuming from where it left off")
  .option("--max <n>", "maximum steps to attempt this run", (v) => parseInt(v, 10))
  .option("--concurrency <n>", "generate this many step edits in parallel", (v) => parseInt(v, 10))
  .option("--interactive", "ask before applying each step", false)
  .option("--continuous", "keep running cycles until the mission is complete or stalls", false)
  .option("--max-iterations <n>", "cap on continuous cycles (default 20)", (v) => parseInt(v, 10))
  .option("--retry", "retry previously-blocked steps", false)
  .option("--no-review", "skip the reviewer agent's intent check before committing")
  .option("--parallel", "run independent steps concurrently in isolated git worktrees", false)
  .option("--test", "write & run tests for each step's changed code (Test phase)", false)
  .action(
    (opts: {
      max?: number;
      concurrency?: number;
      interactive: boolean;
      continuous: boolean;
      maxIterations?: number;
      retry: boolean;
      review: boolean;
      parallel: boolean;
      test: boolean;
    }) =>
      run(() =>
        missionRunCmd({
          ...globals(),
          max: opts.max,
          concurrency: opts.concurrency,
          interactive: opts.interactive,
          continuous: opts.continuous,
          maxIterations: opts.maxIterations,
          retry: opts.retry,
          review: opts.review,
          parallel: opts.parallel,
          test: opts.test,
        }),
      ),
  );

mission
  .command("status")
  .description("Show the remembered goal and step-by-step progress")
  .action(() => run(() => missionStatusCmd(globals())));

mission
  .command("abandon")
  .description("Stop tracking the active mission")
  .action(() => run(() => missionAbandonCmd(globals())));

program
  .command("doctor")
  .description("Diagnose environment and Claude backends")
  .action(() => run(() => doctorCmd(globals())));

program
  .command("status")
  .description("Show workspace and memory state")
  .action(() => run(() => statusCmd(globals())));

program
  .command("ui")
  .description("Start the local web dashboard: monitor analysis/health and launch runs")
  .option("--port <n>", "port to listen on (default 4319)", (v) => parseInt(v, 10))
  .option("--open", "open the dashboard in your browser", false)
  .action((opts: { port?: number; open: boolean }) =>
    run(() => uiCmd({ ...globals(), port: opts.port, open: opts.open })),
  );

program.parseAsync(process.argv);
