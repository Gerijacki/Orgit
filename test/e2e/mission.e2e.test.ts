import { describe, it, expect, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import { Engine } from "../../src/engine/engine.js";
import type { RunContext } from "../../src/engine/context.js";
import { DEFAULT_CONFIG } from "../../src/config/config.js";
import { ensureWorkspace } from "../../src/config/workspace.js";
import { Git } from "../../src/util/git.js";
import { startMission, runMission } from "../../src/mission/runner.js";
import { loadMission } from "../../src/mission/mission.js";
import { makeTempGitRepo, FakeProvider, emptyRetriever, type TempRepo } from "../helpers.js";
import type { CompleteOptions } from "../../src/providers/types.js";

const PASS = JSON.stringify({ name: "s", scripts: { test: 'node -e "process.exit(0)"' } });
const FAIL = JSON.stringify({ name: "s", scripts: { test: 'node -e "process.exit(1)"' } });

function longFn(name: string): string {
  return `function ${name}(x) {\n${Array.from(
    { length: 40 },
    (_, i) => `  const v${i} = ${i};`,
  ).join("\n")}\n  return x;\n}\nmodule.exports = { ${name} };\n`;
}

/** Fake Claude: planner returns two dependent steps; worker edits; reviewer approves. */
function handler(opts: CompleteOptions): string {
  const sys = opts.system ?? "";
  if (sys.includes("planning agent")) {
    return JSON.stringify({
      steps: [
        { title: "Shorten alpha", description: "d", files: ["src/a.js"], dependsOn: [] },
        { title: "Shorten beta", description: "d", files: ["src/b.js"], dependsOn: [1] },
      ],
    });
  }
  if (sys.includes("reviewer agent")) {
    return JSON.stringify({ approved: true, reason: "matches intent" });
  }
  if (sys.includes("executor")) {
    const paths = [...opts.prompt.matchAll(/=== FILE: (.+?) ===/g)].map((m) => m[1]!);
    return JSON.stringify({
      explanation: "Shortened.",
      edits: paths.map((p) => ({ path: p, content: `// shortened\nmodule.exports = {};\n` })),
    });
  }
  return "{}";
}

/** Like `handler` but the reviewer rejects every edit. */
function rejectingHandler(opts: CompleteOptions): string {
  if ((opts.system ?? "").includes("reviewer agent")) {
    return JSON.stringify({ approved: false, reason: "not what the step intended" });
  }
  return handler(opts);
}

async function fakeCtx(
  root: string,
  h: (opts: CompleteOptions) => string = handler,
): Promise<RunContext> {
  const workspace = await ensureWorkspace(root);
  return {
    root,
    config: DEFAULT_CONFIG,
    workspace,
    provider: new FakeProvider(h),
    retriever: emptyRetriever,
    indexer: {
      sync: async () => ({ added: 0, changed: 0, removed: 0, unchanged: 0, chunks: 0 }),
    },
    git: new Git(root),
  } as unknown as RunContext;
}

let repo: TempRepo | undefined;
afterEach(async () => {
  await repo?.cleanup();
  repo = undefined;
});

describe("mission memory (persistent, resumable goal)", () => {
  it("remembers the goal and completes across separate runs", async () => {
    repo = await makeTempGitRepo({
      "package.json": PASS,
      "src/a.js": longFn("alpha"),
      "src/b.js": longFn("beta"),
    });
    const ctx = await fakeCtx(repo.root);
    const engine = new Engine(ctx);

    // 1. User states the goal ONCE.
    const created = await startMission(ctx, engine, "Modularise the code");
    expect(created.goal).toBe("Modularise the code");
    expect(created.steps).toHaveLength(2);

    // 2. First run — advance a single step.
    await runMission(ctx, engine, { max: 1 });
    let mission = (await loadMission(ctx.workspace))!;
    expect(mission.goal).toBe("Modularise the code"); // still remembered
    expect(mission.steps[0]!.status).toBe("done");
    expect(mission.steps[1]!.status).toBe("pending"); // blocked by dependency until step-001 done
    expect(mission.status).toBe("active");

    // 3. "Many iterations later": the goal is reloaded purely from disk.
    mission = (await loadMission(ctx.workspace))!;
    expect(mission.goal).toBe("Modularise the code");
    expect(mission.steps[0]!.commits.length).toBe(1);

    // 4. Second run — the dependent step now runs; mission completes.
    await runMission(ctx, engine, { max: 1 });
    mission = (await loadMission(ctx.workspace))!;
    expect(mission.steps.every((s) => s.status === "done")).toBe(true);
    expect(mission.status).toBe("completed");

    // Both files were actually refactored and committed.
    for (const f of ["src/a.js", "src/b.js"]) {
      expect(await fs.readFile(path.join(repo.root, f), "utf8")).toContain("shortened");
    }
  });

  it("persists progress after every step, so a re-run is idempotent when complete", async () => {
    repo = await makeTempGitRepo({
      "package.json": PASS,
      "src/a.js": longFn("alpha"),
      "src/b.js": longFn("beta"),
    });
    const ctx = await fakeCtx(repo.root);
    const engine = new Engine(ctx);
    await startMission(ctx, engine, "g");

    // Run to completion (no max → all runnable this cycle plus a follow-up).
    await runMission(ctx, engine, {});
    await runMission(ctx, engine, {}); // step-002 (dependency now satisfied)
    const result = await runMission(ctx, engine, {}); // nothing left
    expect(result.attempted).toBe(0);
    expect((await loadMission(ctx.workspace))!.status).toBe("completed");
  });

  it("blocks a step the reviewer agent rejects, without committing it", async () => {
    repo = await makeTempGitRepo({
      "package.json": PASS,
      "src/a.js": longFn("alpha"),
      "src/b.js": longFn("beta"),
    });
    const ctx = await fakeCtx(repo.root, rejectingHandler);
    const engine = new Engine(ctx);
    await startMission(ctx, engine, "careful refactor");
    await runMission(ctx, engine, { max: 1 });

    const mission = (await loadMission(ctx.workspace))!;
    expect(mission.steps[0]!.status).toBe("blocked");
    expect(mission.steps[0]!.note).toContain("rejected by reviewer");
    expect(mission.goal).toBe("careful refactor"); // still remembered
    // Nothing was committed — the edit never applied.
    expect(await fs.readFile(path.join(repo.root, "src/a.js"), "utf8")).toContain("alpha");
    expect(await new Git(repo.root).isClean()).toBe(true);
  });

  it("marks a step blocked when its validation fails, without losing the mission", async () => {
    repo = await makeTempGitRepo({
      "package.json": FAIL, // test always fails → step validation fails → blocked
      "src/a.js": longFn("alpha"),
      "src/b.js": longFn("beta"),
    });
    const ctx = await fakeCtx(repo.root);
    const engine = new Engine(ctx);
    await startMission(ctx, engine, "risky refactor");
    await runMission(ctx, engine, { max: 1 });

    const mission = (await loadMission(ctx.workspace))!;
    expect(mission.steps[0]!.status).toBe("blocked");
    expect(mission.status).toBe("active"); // still remembered, not lost
    expect(mission.goal).toBe("risky refactor");
    // The tree was restored (rollback), so it stays clean.
    expect(await new Git(repo.root).isClean()).toBe(true);
  });
});
