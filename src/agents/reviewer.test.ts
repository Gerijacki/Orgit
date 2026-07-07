import { describe, it, expect } from "vitest";
import { ReviewerAgent } from "./reviewer.js";
import type { ClaudeProvider, CompleteOptions } from "../providers/types.js";
import type { GeneratedEdit } from "../executor/execute.js";
import type { Task } from "../core/types.js";

class RProvider implements ClaudeProvider {
  readonly kind = "cli" as const;
  public prompts: string[] = [];
  constructor(private readonly text: string) {}
  describe() {
    return "r";
  }
  async healthCheck() {
    return { ok: true, detail: "r" };
  }
  async complete(opts: CompleteOptions) {
    this.prompts.push(opts.prompt);
    return this.text;
  }
}

const task: Task = {
  id: "task-001",
  title: "Remove dead code",
  files: ["a.ts"],
  opportunityId: "o1",
  rationale: { why: "unused vars", improves: "clarity", problem: "p", impact: "i" },
  benefit: 3,
  risk: 1,
  score: 3,
};

const gen: GeneratedEdit = {
  taskId: "task-001",
  edits: [{ path: "a.ts", content: "export const a = 1;\n" }],
  explanation: "removed unused",
  sourceHashes: { "a.ts": "h" },
};

describe("ReviewerAgent", () => {
  it("approves an edit that matches its intent, seeing the task + edit", async () => {
    const p = new RProvider(JSON.stringify({ approved: true, reason: "matches intent" }));
    const r = await new ReviewerAgent(p).review(task, gen);
    expect(r.approved).toBe(true);
    expect(p.prompts[0]).toContain("Remove dead code");
    expect(p.prompts[0]).toContain("a.ts");
  });

  it("rejects with a reason", async () => {
    const p = new RProvider(JSON.stringify({ approved: false, reason: "removes needed export" }));
    const r = await new ReviewerAgent(p).review(task, gen);
    expect(r.approved).toBe(false);
    expect(r.reason).toContain("needed export");
  });

  it("rejects when there are no edits", async () => {
    const p = new RProvider("irrelevant");
    const r = await new ReviewerAgent(p).review(task, { ...gen, edits: [] });
    expect(r.approved).toBe(false);
    expect(r.reason).toContain("no edits");
  });

  it("fails open when the model returns unparseable output (validation still guards correctness)", async () => {
    const p = new RProvider("not json at all");
    const r = await new ReviewerAgent(p).review(task, gen);
    expect(r.approved).toBe(true);
    expect(r.reason).toContain("unavailable");
  });
});
