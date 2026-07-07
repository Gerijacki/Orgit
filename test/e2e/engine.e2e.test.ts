import { describe, it, expect, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import { Engine } from "../../src/engine/engine.js";
import type { RunContext } from "../../src/engine/context.js";
import { buildMentalModel } from "../../src/analysis/model.js";
import { DEFAULT_CONFIG } from "../../src/config/config.js";
import { Git } from "../../src/util/git.js";
import { makeTempGitRepo, FakeProvider, emptyRetriever, type TempRepo } from "../helpers.js";
import type { CompleteOptions } from "../../src/providers/types.js";

/**
 * End-to-end exercise of the execution cycle — Detect → Prioritize → Plan →
 * Execute → Validate → (commit | rollback) — against a real git repo, with Claude
 * replaced by a deterministic FakeProvider. No network, no embeddings.
 */

const LONG_FN = `function big(x) {\n${Array.from(
  { length: 70 },
  (_, i) => `  const v${i} = ${i};`,
).join("\n")}\n  return x;\n}\nmodule.exports = { big };\n`;

const SHORT_FN = `function big(x) {\n  return x;\n}\nmodule.exports = { big };\n`;

/** Fake Claude: no extra opportunities during audit; a shortening edit during execution. */
function claudeHandler(opts: CompleteOptions): string {
  const sys = opts.system ?? "";
  if (sys.includes("executor")) {
    return JSON.stringify({
      explanation: "Shortened big() by removing unused locals.",
      edits: [{ path: "src/big.js", content: SHORT_FN }],
    });
  }
  // Detection pass: let the static analyzer's long-function finding drive the plan.
  return JSON.stringify({ opportunities: [] });
}

function makeEngine(root: string, handler = claudeHandler): Engine {
  const ctx = {
    root,
    config: DEFAULT_CONFIG,
    provider: new FakeProvider(handler),
    retriever: emptyRetriever,
    git: new Git(root),
  } as unknown as RunContext;
  return new Engine(ctx);
}

let repo: TempRepo | undefined;
afterEach(async () => {
  await repo?.cleanup();
  repo = undefined;
});

describe("engine cycle (offline, fake Claude)", () => {
  it("audits, plans, and applies a validated change as a commit", async () => {
    repo = await makeTempGitRepo({
      "package.json": JSON.stringify({
        name: "s",
        scripts: { test: 'node -e "process.exit(0)"' },
      }),
      "src/big.js": LONG_FN,
    });
    const engine = makeEngine(repo.root);

    const model = await buildMentalModel(repo.root, DEFAULT_CONFIG);
    const scored = await engine.audit(model);
    expect(scored.some((o) => o.kind === "long-function")).toBe(true);

    const plan = engine.plan(model, scored);
    expect(plan.tasks.length).toBeGreaterThan(0);
    expect(plan.tasks[0]!.files).toContain("src/big.js");

    const results = await engine.execute(model, plan, { dryRun: false, max: 1 });
    expect(results[0]!.committed).toBe(true);
    expect(results[0]!.rolledBack).toBe(false);

    // The file was actually shortened and the change committed.
    const after = await fs.readFile(path.join(repo.root, "src/big.js"), "utf8");
    expect(after).toBe(SHORT_FN);
    const git = new Git(repo.root);
    expect(await git.isClean()).toBe(true);
  });

  it("dry-run generates the edit but writes nothing", async () => {
    repo = await makeTempGitRepo({
      "package.json": JSON.stringify({ name: "s", scripts: { test: 'node -e "0"' } }),
      "src/big.js": LONG_FN,
    });
    const engine = makeEngine(repo.root);
    const model = await buildMentalModel(repo.root, DEFAULT_CONFIG);
    const plan = engine.plan(model, await engine.audit(model));

    const results = await engine.execute(model, plan, { dryRun: true, max: 1 });
    expect(results[0]!.committed).toBe(false);
    expect(results[0]!.explanation).toContain("Shortened");
    // File untouched.
    const after = await fs.readFile(path.join(repo.root, "src/big.js"), "utf8");
    expect(after).toBe(LONG_FN);
  });

  it("rolls back a change whose validation fails, leaving the tree pristine", async () => {
    repo = await makeTempGitRepo({
      // Test script always fails → validation fails → rollback.
      "package.json": JSON.stringify({
        name: "s",
        scripts: { test: 'node -e "process.exit(1)"' },
      }),
      "src/big.js": LONG_FN,
    });
    const engine = makeEngine(repo.root);
    const model = await buildMentalModel(repo.root, DEFAULT_CONFIG);
    const plan = engine.plan(model, await engine.audit(model));

    const before = await new Git(repo.root).headSha();
    const results = await engine.execute(model, plan, { dryRun: false, max: 1 });

    expect(results[0]!.rolledBack).toBe(true);
    expect(results[0]!.committed).toBe(false);
    const git = new Git(repo.root);
    expect(await git.headSha()).toBe(before);
    expect(await git.isClean()).toBe(true);
    const after = await fs.readFile(path.join(repo.root, "src/big.js"), "utf8");
    expect(after).toBe(LONG_FN); // restored
  });

  it("refuses to modify a dirty working tree", async () => {
    repo = await makeTempGitRepo({
      "package.json": JSON.stringify({ name: "s", scripts: {} }),
      "src/big.js": LONG_FN,
    });
    // Make the tree dirty.
    await fs.writeFile(path.join(repo.root, "src/big.js"), LONG_FN + "\n// dirty\n", "utf8");
    const engine = makeEngine(repo.root);
    const model = await buildMentalModel(repo.root, DEFAULT_CONFIG);
    const plan = engine.plan(model, await engine.audit(model));

    await expect(engine.execute(model, plan, { dryRun: false })).rejects.toThrow(/not clean/i);
  });
});
