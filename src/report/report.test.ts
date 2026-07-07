import { describe, it, expect } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { renderAudit, renderPlan, renderResults, writeReport } from "./report.js";
import type { MentalModel, Plan, ScoredOpportunity, TaskResult } from "../core/types.js";
import type { Workspace } from "../config/workspace.js";

const model = {
  root: "/repo",
  totals: { files: 3, lines: 100, bytes: 2000 },
  signals: { ecosystem: "node" },
} as unknown as MentalModel;

const scored: ScoredOpportunity[] = [
  {
    id: "o1",
    kind: "dead-code",
    files: ["a.ts"],
    summary: "unused helper | with pipe",
    confidence: 0.9,
    source: "static",
    benefit: 4,
    risk: 1,
    score: 4,
  },
];

describe("renderAudit", () => {
  it("renders a table and escapes pipes in summaries", () => {
    const md = renderAudit(model, scored);
    expect(md).toContain("# Orgit Audit Report");
    expect(md).toContain("dead-code");
    expect(md).toContain("unused helper \\| with pipe");
  });

  it("handles the empty case", () => {
    const md = renderAudit(model, []);
    expect(md).toContain("No improvement opportunities detected");
  });
});

describe("renderPlan", () => {
  it("lists each task with its justification", () => {
    const plan: Plan = {
      generatedAt: "now",
      root: "/repo",
      tasks: [
        {
          id: "task-001",
          title: "Remove dead code in a.ts",
          files: ["a.ts"],
          opportunityId: "o1",
          rationale: { why: "w", improves: "i", problem: "p", impact: "m" },
          benefit: 4,
          risk: 1,
          score: 4,
        },
      ],
    };
    const md = renderPlan(plan);
    expect(md).toContain("task-001 — Remove dead code in a.ts");
    expect(md).toContain("Why: w");
    expect(md).toContain("Improves: i");
  });
});

describe("renderResults", () => {
  it("summarises committed / rolled-back / skipped", () => {
    const results: TaskResult[] = [
      { taskId: "task-001", applied: true, committed: true, rolledBack: false, commit: "abc123" },
      {
        taskId: "task-002",
        applied: true,
        committed: false,
        rolledBack: true,
        error: "validation failed",
      },
    ];
    const md = renderResults(results);
    expect(md).toContain("Committed: 1");
    expect(md).toContain("Rolled back: 1");
    expect(md).toContain("✓ committed");
    expect(md).toContain("↺ rolled back");
  });
});

describe("writeReport", () => {
  it("writes markdown, json, and a latest pointer", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "orgit-rep-"));
    const ws = { reportsDir: dir } as unknown as Workspace;
    const { md, json } = await writeReport(ws, "audit", "# hi", { a: 1 });
    expect(await fs.readFile(md, "utf8")).toBe("# hi");
    expect(JSON.parse(await fs.readFile(json, "utf8"))).toEqual({ a: 1 });
    expect(await fs.readFile(path.join(dir, "audit-latest.md"), "utf8")).toBe("# hi");
    await fs.rm(dir, { recursive: true, force: true });
  });
});
