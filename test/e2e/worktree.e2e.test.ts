import { describe, it, expect, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import { buildMentalModel } from "../../src/analysis/model.js";
import { DEFAULT_CONFIG } from "../../src/config/config.js";
import { Git } from "../../src/util/git.js";
import { executeInWorktrees, partitionIndependent } from "../../src/executor/worktree.js";
import { makeTempGitRepo, FakeProvider, type TempRepo } from "../helpers.js";
import type { CompleteOptions } from "../../src/providers/types.js";
import type { Task } from "../../src/core/types.js";

const PASS = JSON.stringify({ name: "s", scripts: { test: 'node -e "process.exit(0)"' } });

function task(id: string, file: string): Task {
  return {
    id,
    title: `Shorten ${file}`,
    files: [file],
    opportunityId: id,
    rationale: { why: "w", improves: "i", problem: "p", impact: "m" },
    benefit: 3,
    risk: 2,
    score: 1.5,
  };
}

function handler(opts: CompleteOptions): string {
  const paths = [...opts.prompt.matchAll(/=== FILE: (.+?) ===/g)].map((m) => m[1]!);
  return JSON.stringify({
    explanation: "Shortened.",
    edits: paths.map((p) => ({ path: p, content: `// shortened ${p}\nmodule.exports = {};\n` })),
  });
}

describe("partitionIndependent", () => {
  it("separates disjoint-file tasks from overlapping ones", () => {
    const a = task("a", "src/a.js");
    const b = task("b", "src/b.js");
    const c = task("c", "src/a.js"); // overlaps a
    const { independent, rest } = partitionIndependent([a, b, c]);
    expect(independent.map((t) => t.id)).toEqual(["a", "b"]);
    expect(rest.map((t) => t.id)).toEqual(["c"]);
  });
});

let repo: TempRepo | undefined;
afterEach(async () => {
  await repo?.cleanup();
  repo = undefined;
});

describe("executeInWorktrees", () => {
  it("applies independent tasks in isolated worktrees and cherry-picks them onto the base branch", async () => {
    repo = await makeTempGitRepo({
      "package.json": PASS,
      "src/a.js": "function alpha(){ return 1; }\nmodule.exports = { alpha };\n",
      "src/b.js": "function beta(){ return 2; }\nmodule.exports = { beta };\n",
    });
    const model = await buildMentalModel(repo.root, DEFAULT_CONFIG);
    const git = new Git(repo.root);
    const before = await git.headSha();

    const results = await executeInWorktrees(
      model,
      [task("t-a", "src/a.js"), task("t-b", "src/b.js")],
      new FakeProvider(handler),
      git,
      { concurrency: 2 },
    );

    expect(results.filter((r) => r.committed)).toHaveLength(2);
    // Both edits landed on the base branch.
    for (const f of ["src/a.js", "src/b.js"]) {
      expect(await fs.readFile(path.join(repo.root, f), "utf8")).toContain("shortened");
    }
    // Two new commits, clean tree, no leftover worktrees.
    expect(await git.headSha()).not.toBe(before);
    expect(await git.isClean()).toBe(true);
  });

  it("does not commit a task whose validation fails", async () => {
    repo = await makeTempGitRepo({
      "package.json": JSON.stringify({ name: "s", scripts: { test: 'node -e "process.exit(1)"' } }),
      "src/a.js": "module.exports = {};\n",
    });
    const model = await buildMentalModel(repo.root, DEFAULT_CONFIG);
    const git = new Git(repo.root);
    const before = await git.headSha();

    const results = await executeInWorktrees(
      model,
      [task("t-a", "src/a.js")],
      new FakeProvider(handler),
      git,
      {},
    );
    expect(results[0]!.committed).toBe(false);
    expect(results[0]!.error).toContain("validation failed");
    expect(await git.headSha()).toBe(before);
    expect(await git.isClean()).toBe(true);
  });
});
