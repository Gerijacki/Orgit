import { execa } from "execa";
import type { RepoSignals, ValidationResult } from "../core/types.js";

/**
 * Run the target project's own build/test/lint after a change, so Orgit can prove
 * the project still works (design spec → "Validation"). Missing steps are marked
 * skipped, not failed. Nothing here is hidden: full output is captured for reporting.
 */
export async function validate(root: string, signals: RepoSignals): Promise<ValidationResult> {
  const steps: ValidationResult["steps"] = [];

  for (const name of ["build", "test", "lint"] as const) {
    const command = signals.scripts[name];
    if (!command) {
      steps.push({ name, command: "", ok: true, skipped: true, output: "" });
      continue;
    }
    const step = await runStep(root, name, command);
    steps.push(step);
    // Stop at the first hard failure — no point testing on a broken build.
    if (!step.ok) break;
  }

  const ok = steps.every((s) => s.ok || s.skipped);
  return { ok, steps };
}

async function runStep(
  root: string,
  name: "build" | "test" | "lint",
  command: string,
): Promise<ValidationResult["steps"][number]> {
  try {
    const result = await execa(command, {
      cwd: root,
      shell: true,
      timeout: 600_000,
      reject: false,
      all: true,
    });
    return {
      name,
      command,
      ok: result.exitCode === 0,
      skipped: false,
      output: tail(result.all ?? "", 4000),
    };
  } catch (err) {
    return { name, command, ok: false, skipped: false, output: (err as Error).message };
  }
}

/**
 * Run only the project's test command — used by the tester agent's Test phase, which
 * checks its freshly-written tests without re-running build/lint (those already passed
 * during validation).
 */
export async function runTestsOnly(
  root: string,
  signals: RepoSignals,
): Promise<{ ok: boolean; ran: boolean; output: string }> {
  const command = signals.scripts.test;
  if (!command) return { ok: true, ran: false, output: "" };
  try {
    const result = await execa(command, {
      cwd: root,
      shell: true,
      timeout: 600_000,
      reject: false,
      all: true,
    });
    return { ok: result.exitCode === 0, ran: true, output: tail(result.all ?? "", 4000) };
  } catch (err) {
    return { ok: false, ran: true, output: (err as Error).message };
  }
}

function tail(s: string, n: number): string {
  return s.length <= n ? s : s.slice(s.length - n);
}
