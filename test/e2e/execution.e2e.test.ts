import { describe, it, expect, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import { Engine } from "../../src/engine/engine.js";
import type { RunContext } from "../../src/engine/context.js";
import { buildMentalModel } from "../../src/analysis/model.js";
import { DEFAULT_CONFIG } from "../../src/config/config.js";
import { Git } from "../../src/util/git.js";
import { generateEdit, applyEdit, isStale } from "../../src/executor/execute.js";
import { makeTempGitRepo, FakeProvider, emptyRetriever, type TempRepo } from "../helpers.js";
import type { CompleteOptions } from "../../src/providers/types.js";
import type { Task } from "../../src/core/types.js";

const PASS_PKG = JSON.stringify({ name: "s", scripts: { test: 'node -e "process.exit(0)"' } });

function longFn(name: string): string {
  return `function ${name}(x) {\n${Array.from(
    { length: 65 },
    (_, i) => `  const v${i} = ${i};`,
  ).join("\n")}\n  return x;\n}\nmodule.exports = { ${name} };\n`;
}

/** Fake Claude: static analyzer drives detection; executor returns a short edit per target file. */
function handler(opts: CompleteOptions): string {
  if ((opts.system ?? "").includes("executor")) {
    const paths = [...opts.prompt.matchAll(/=== FILE: (.+?) ===/g)].map((m) => m[1]!);
    return JSON.stringify({
      explanation: "Shortened.",
      edits: paths.map((p) => ({ path: p, content: `// shortened\nmodule.exports = {};\n` })),
    });
  }
  return JSON.stringify({ opportunities: [] });
}

function makeEngine(root: string, provider = new FakeProvider(handler)): { engine: Engine } {
  const ctx = {
    root,
    config: DEFAULT_CONFIG,
    provider,
    retriever: emptyRetriever,
    git: new Git(root),
  } as unknown as RunContext;
  return { engine: new Engine(ctx) };
}

let repo: TempRepo | undefined;
afterEach(async () => {
  await repo?.cleanup();
  repo = undefined;
});

describe("parallel execution", () => {
  it("generates edits in parallel and commits both tasks", async () => {
    repo = await makeTempGitRepo({
      "package.json": PASS_PKG,
      "src/a.js": longFn("alpha"),
      "src/b.js": longFn("beta"),
    });
    const provider = new FakeProvider(handler);
    const { engine } = makeEngine(repo.root, provider);
    const model = await buildMentalModel(repo.root, DEFAULT_CONFIG);
    const plan = engine.plan(model, await engine.audit(model));
    expect(plan.tasks.length).toBe(2);

    const results = await engine.execute(model, plan, { dryRun: false, concurrency: 2 });
    expect(results.filter((r) => r.committed)).toHaveLength(2);
    // Both files were shortened.
    for (const f of ["src/a.js", "src/b.js"]) {
      expect(await fs.readFile(path.join(repo.root, f), "utf8")).toContain("shortened");
    }
    const git = new Git(repo.root);
    expect(await git.isClean()).toBe(true);
  });
});

describe("reviewer gate", () => {
  it("does not commit an edit the reviewer rejects, and commits one it approves", async () => {
    repo = await makeTempGitRepo({
      "package.json": PASS_PKG,
      "src/a.js": longFn("alpha"),
      "src/b.js": longFn("beta"),
    });
    const { engine } = makeEngine(repo.root);
    const model = await buildMentalModel(repo.root, DEFAULT_CONFIG);
    const plan = engine.plan(model, await engine.audit(model));

    // Reject the first task, approve the rest.
    let n = 0;
    const results = await engine.execute(model, plan, {
      dryRun: false,
      reviewer: async () =>
        n++ === 0 ? { approved: false, reason: "scope creep" } : { approved: true, reason: "ok" },
    });

    expect(results[0]!.committed).toBe(false);
    expect(results[0]!.error).toContain("rejected by reviewer: scope creep");
    expect(results[1]!.committed).toBe(true);
    // The rejected task's file is untouched (never applied).
    expect(await fs.readFile(path.join(repo.root, "src/a.js"), "utf8")).not.toContain("shortened");
    expect(await new Git(repo.root).isClean()).toBe(true);
  });
});

describe("test phase", () => {
  it("runs the tester after a committed task and records the outcome", async () => {
    repo = await makeTempGitRepo({ "package.json": PASS_PKG, "src/a.js": longFn("alpha") });
    const { engine } = makeEngine(repo.root);
    const model = await buildMentalModel(repo.root, DEFAULT_CONFIG);
    const plan = engine.plan(model, await engine.audit(model));

    let called: string[] = [];
    const results = await engine.execute(model, plan, {
      dryRun: false,
      max: 1,
      tester: async (task, changedFiles) => {
        called = changedFiles;
        return { wrote: ["src/a.test.js"], committed: true, passed: true };
      },
    });

    expect(results[0]!.committed).toBe(true);
    expect(results[0]!.tests).toEqual({ added: 1, passed: true, committed: true, note: undefined });
    expect(called).toEqual(["src/a.js"]);
  });

  it("does not run the tester when the task was not committed", async () => {
    repo = await makeTempGitRepo({ "package.json": PASS_PKG, "src/a.js": longFn("alpha") });
    const { engine } = makeEngine(repo.root);
    const model = await buildMentalModel(repo.root, DEFAULT_CONFIG);
    const plan = engine.plan(model, await engine.audit(model));

    let ran = false;
    await engine.execute(model, plan, {
      dryRun: false,
      max: 1,
      reviewer: async () => ({ approved: false, reason: "no" }), // blocks the commit
      tester: async () => {
        ran = true;
        return { wrote: [], committed: false, passed: true };
      },
    });
    expect(ran).toBe(false);
  });
});

describe("interactive approval", () => {
  it("skips a task the user declines and applies the one they accept", async () => {
    repo = await makeTempGitRepo({
      "package.json": PASS_PKG,
      "src/a.js": longFn("alpha"),
      "src/b.js": longFn("beta"),
    });
    const { engine } = makeEngine(repo.root);
    const model = await buildMentalModel(repo.root, DEFAULT_CONFIG);
    const plan = engine.plan(model, await engine.audit(model));

    let i = 0;
    const decisions = ["skip", "apply"] as const;
    const results = await engine.execute(model, plan, {
      dryRun: false,
      approve: async () => decisions[i++]!,
    });
    expect(results[0]!.error).toBe("skipped by user");
    expect(results[0]!.committed).toBe(false);
    expect(results[1]!.committed).toBe(true);
  });

  it("stops the whole run when the user quits", async () => {
    repo = await makeTempGitRepo({
      "package.json": PASS_PKG,
      "src/a.js": longFn("alpha"),
      "src/b.js": longFn("beta"),
    });
    const { engine } = makeEngine(repo.root);
    const model = await buildMentalModel(repo.root, DEFAULT_CONFIG);
    const plan = engine.plan(model, await engine.audit(model));

    const results = await engine.execute(model, plan, {
      dryRun: false,
      approve: async () => "quit",
    });
    expect(results).toHaveLength(0);
    expect(await new Git(repo.root).isClean()).toBe(true);
  });
});

describe("executor generate/apply split", () => {
  const task: Task = {
    id: "task-001",
    title: "Shorten alpha",
    files: ["src/a.js"],
    opportunityId: "o1",
    rationale: { why: "w", improves: "i", problem: "p", impact: "m" },
    benefit: 3,
    risk: 2,
    score: 1.5,
  };

  it("generateEdit produces edits + source hashes without touching git", async () => {
    repo = await makeTempGitRepo({ "package.json": PASS_PKG, "src/a.js": longFn("alpha") });
    const model = await buildMentalModel(repo.root, DEFAULT_CONFIG);
    const gen = await generateEdit(model, task, new FakeProvider(handler));
    expect(gen.edits[0]!.path).toBe("src/a.js");
    expect(gen.sourceHashes["src/a.js"]).toBeTruthy();
    expect(gen.skip).toBeUndefined();
    // Nothing committed / changed yet.
    expect(await new Git(repo.root).isClean()).toBe(true);
  });

  it("isStale detects a source change after generation", async () => {
    repo = await makeTempGitRepo({ "package.json": PASS_PKG, "src/a.js": longFn("alpha") });
    const model = await buildMentalModel(repo.root, DEFAULT_CONFIG);
    const gen = await generateEdit(model, task, new FakeProvider(handler));
    expect(await isStale(model, gen)).toBe(false);
    await fs.appendFile(path.join(repo.root, "src/a.js"), "\n// touched\n");
    expect(await isStale(model, gen)).toBe(true);
  });

  it("applyEdit commits a validated edit", async () => {
    repo = await makeTempGitRepo({ "package.json": PASS_PKG, "src/a.js": longFn("alpha") });
    const model = await buildMentalModel(repo.root, DEFAULT_CONFIG);
    const git = new Git(repo.root);
    const gen = await generateEdit(model, task, new FakeProvider(handler));
    const result = await applyEdit(model, task, gen, git);
    expect(result.committed).toBe(true);
    expect(result.changedFiles).toEqual(["src/a.js"]);
  });

  it("creates a brand-new file (in a new directory) for extract-style steps", async () => {
    repo = await makeTempGitRepo({ "package.json": PASS_PKG, "src/a.js": longFn("alpha") });
    const model = await buildMentalModel(repo.root, DEFAULT_CONFIG);
    const createTask: Task = {
      ...task,
      id: "step-new",
      title: "Create util",
      files: ["src/util/new.js"],
    };
    // A file that does not exist yet must NOT be treated as "no target files".
    const creator = new FakeProvider(() =>
      JSON.stringify({
        explanation: "Create the shared util.",
        edits: [{ path: "src/util/new.js", content: "module.exports = { ok: true };\n" }],
      }),
    );
    const gen = await generateEdit(model, createTask, creator);
    expect(gen.skip).toBeUndefined();
    expect(gen.edits[0]!.path).toBe("src/util/new.js");

    const result = await applyEdit(model, createTask, gen, new Git(repo.root));
    expect(result.committed).toBe(true);
    expect(await fs.readFile(path.join(repo.root, "src/util/new.js"), "utf8")).toContain("ok");
  });
});
