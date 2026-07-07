import { promises as fs } from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { MentalModel, Task } from "../core/types.js";
import type { ClaudeProvider } from "../providers/types.js";
import { completeJson } from "../providers/factory.js";
import { Git } from "../util/git.js";
import { runTestsOnly } from "../validation/validate.js";
import { readFileSafe, fileExists } from "../util/fsutil.js";
import type { Agent } from "./agents.js";

/**
 * The tester agent. After a change has been applied, validated (build/test/lint) and
 * reviewed, the tester writes tests that exercise the new code and runs them:
 *
 *   Execute → Validate / Review → **Test** → Document
 *
 * If the new tests pass they are committed (increasing coverage and confirming the
 * refactor). If they fail — the change might have a regression, or the generated test
 * might be wrong — the tests are discarded and a warning is surfaced, so the repository
 * always stays green while the concern is reported.
 */
export interface TestOutcome {
  /** Test files written (relative paths). */
  wrote: string[];
  committed: boolean;
  passed: boolean;
  output?: string;
  note?: string;
}

export type Tester = (task: Task, changedFiles: string[]) => Promise<TestOutcome>;

const TestResult = z.object({
  explanation: z.string().default(""),
  files: z.array(z.object({ path: z.string(), content: z.string() })).default([]),
});

const TESTER_SYSTEM = `You are Orgit's tester agent. Given code that was just changed, you write focused
automated tests that verify its behaviour. Rules:
- Write NEW test files only (do not modify source or existing tests). Use the project's test
  framework and file-naming convention.
- Cover the public behaviour of the changed code, including an important edge case or two.
- Tests must be runnable as-is and must not depend on network or external services.
- If you cannot write meaningful tests for this change, return an empty files array.`;

const TEST_PATH = /(\.|_)(test|spec)\.[cm]?[jt]sx?$/i;

export class TesterAgent implements Agent {
  readonly role = "tester" as const;
  readonly name = "tester";

  constructor(
    private readonly provider: ClaudeProvider,
    private readonly model: MentalModel,
    private readonly git: Git,
    private readonly conventions?: string,
  ) {}

  async testChange(task: Task, changedFiles: string[]): Promise<TestOutcome> {
    const root = this.model.root;
    if (!this.model.signals.scripts.test) {
      return { wrote: [], committed: false, passed: true, note: "no test runner configured" };
    }

    const files: Array<{ path: string; content: string }> = [];
    for (const rel of changedFiles) {
      const content = await readFileSafe(root, rel);
      if (content !== null) files.push({ path: rel, content });
    }
    if (files.length === 0) {
      return { wrote: [], committed: false, passed: true, note: "no changed files to test" };
    }

    let generated: z.infer<typeof TestResult>;
    try {
      generated = await completeJson(this.provider, TestResult, {
        system: TESTER_SYSTEM,
        prompt: buildTestPrompt(task, files, this.conventions),
        maxTokens: 8000,
      });
    } catch (err) {
      return {
        wrote: [],
        committed: false,
        passed: true,
        note: `tester generation failed: ${(err as Error).message}`,
      };
    }

    // Only accept NEW test files — never overwrite source or existing tests. This keeps
    // discarding safe (just delete what we created).
    const candidates: Array<{ path: string; content: string }> = [];
    for (const f of generated.files) {
      if (!TEST_PATH.test(f.path)) continue;
      if (await fileExists(path.join(root, f.path))) continue;
      candidates.push(f);
    }
    if (candidates.length === 0) {
      return {
        wrote: [],
        committed: false,
        passed: true,
        note: "tester produced no new test files",
      };
    }

    for (const f of candidates) {
      const abs = path.join(root, f.path);
      await fs.mkdir(path.dirname(abs), { recursive: true });
      await fs.writeFile(abs, f.content, "utf8");
    }

    const wrote = candidates.map((f) => f.path);
    const run = await runTestsOnly(root, this.model.signals);

    if (run.ok) {
      await this.git.addFiles(wrote);
      await this.git.commit(testCommitMessage(task, wrote));
      return { wrote, committed: true, passed: true };
    }

    // Failing — discard the generated tests so the committed state stays green.
    for (const f of candidates) {
      await fs.rm(path.join(root, f.path), { force: true }).catch(() => {});
    }
    return {
      wrote,
      committed: false,
      passed: false,
      output: run.output,
      note: "generated tests failed — discarded; the change may need a closer look",
    };
  }

  /** Convenience: a plain `Tester` function bound to this agent. */
  asTester(): Tester {
    return (task, changedFiles) => this.testChange(task, changedFiles);
  }
}

function buildTestPrompt(
  task: Task,
  files: Array<{ path: string; content: string }>,
  conventions?: string,
): string {
  const blocks = files.map((f) => `=== FILE: ${f.path} ===\n${f.content}`).join("\n\n");
  const conventionsBlock =
    conventions && conventions !== "No conventions learned yet."
      ? `\nProject conventions:\n${conventions}\n`
      : "";
  return `A refactoring task titled "${task.title}" just changed the code below.
${conventionsBlock}
${blocks}

Write NEW test files that verify this code. Return JSON:
{ "explanation": string, "files": [ { "path": string, "content": string } ] }
Each path must be a new test file (e.g. next to the source, using the project's test naming).`;
}

function testCommitMessage(task: Task, files: string[]): string {
  return [
    `orgit: add tests for ${task.title}`,
    "",
    `Added ${files.length} test file(s): ${files.join(", ")}`,
    "",
    "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>",
  ].join("\n");
}
