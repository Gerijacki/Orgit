import { describe, it, expect, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import { TesterAgent } from "../../src/agents/tester.js";
import { buildMentalModel } from "../../src/analysis/model.js";
import { DEFAULT_CONFIG } from "../../src/config/config.js";
import { Git } from "../../src/util/git.js";
import { makeTempGitRepo, FakeProvider, type TempRepo } from "../helpers.js";
import type { CompleteOptions } from "../../src/providers/types.js";
import type { Task } from "../../src/core/types.js";

const task: Task = {
  id: "task-001",
  title: "Add helper",
  files: ["src/a.js"],
  opportunityId: "o1",
  rationale: { why: "w", improves: "i", problem: "p", impact: "m" },
  benefit: 3,
  risk: 1,
  score: 3,
};

/** Provider that returns a single new test file. */
function testWriter(testPath = "src/a.test.js"): (o: CompleteOptions) => string {
  return () =>
    JSON.stringify({
      explanation: "tests for a",
      files: [{ path: testPath, content: "// generated test\nmodule.exports = {};\n" }],
    });
}

let repo: TempRepo | undefined;
afterEach(async () => {
  await repo?.cleanup();
  repo = undefined;
});

describe("TesterAgent", () => {
  it("writes tests and commits them when they pass", async () => {
    repo = await makeTempGitRepo({
      "package.json": JSON.stringify({ name: "s", scripts: { test: 'node -e "process.exit(0)"' } }),
      "src/a.js": "module.exports = { a: 1 };\n",
    });
    const model = await buildMentalModel(repo.root, DEFAULT_CONFIG);
    const git = new Git(repo.root);
    const agent = new TesterAgent(new FakeProvider(testWriter()), model, git);

    const outcome = await agent.testChange(task, ["src/a.js"]);
    expect(outcome.passed).toBe(true);
    expect(outcome.committed).toBe(true);
    expect(outcome.wrote).toEqual(["src/a.test.js"]);
    // The test file exists and the tree is clean (committed).
    expect(await fs.readFile(path.join(repo.root, "src/a.test.js"), "utf8")).toContain("generated");
    expect(await git.isClean()).toBe(true);
  });

  it("discards generated tests that fail, keeping the tree green", async () => {
    repo = await makeTempGitRepo({
      "package.json": JSON.stringify({ name: "s", scripts: { test: 'node -e "process.exit(1)"' } }),
      "src/a.js": "module.exports = { a: 1 };\n",
    });
    const model = await buildMentalModel(repo.root, DEFAULT_CONFIG);
    const git = new Git(repo.root);
    const agent = new TesterAgent(new FakeProvider(testWriter()), model, git);

    const outcome = await agent.testChange(task, ["src/a.js"]);
    expect(outcome.passed).toBe(false);
    expect(outcome.committed).toBe(false);
    // The failing test file was removed; tree is clean.
    await expect(fs.stat(path.join(repo.root, "src/a.test.js"))).rejects.toThrow();
    expect(await git.isClean()).toBe(true);
  });

  it("no-ops cleanly when the project has no test runner", async () => {
    repo = await makeTempGitRepo({
      "package.json": JSON.stringify({ name: "s", scripts: {} }),
      "src/a.js": "module.exports = { a: 1 };\n",
    });
    const model = await buildMentalModel(repo.root, DEFAULT_CONFIG);
    const agent = new TesterAgent(new FakeProvider(testWriter()), model, new Git(repo.root));
    const outcome = await agent.testChange(task, ["src/a.js"]);
    expect(outcome.wrote).toEqual([]);
    expect(outcome.note).toContain("no test runner");
  });

  it("ignores non-test file paths the model might return", async () => {
    repo = await makeTempGitRepo({
      "package.json": JSON.stringify({ name: "s", scripts: { test: 'node -e "0"' } }),
      "src/a.js": "module.exports = { a: 1 };\n",
    });
    const model = await buildMentalModel(repo.root, DEFAULT_CONFIG);
    // Returns a non-test path → must be ignored (tester only creates new *.test.* files).
    const agent = new TesterAgent(
      new FakeProvider(testWriter("src/extra.js")),
      model,
      new Git(repo.root),
    );
    const outcome = await agent.testChange(task, ["src/a.js"]);
    expect(outcome.wrote).toEqual([]);
    expect(await fs.stat(path.join(repo.root, "src/extra.js")).catch(() => null)).toBeNull();
  });
});
