import { describe, it, expect } from "vitest";
import { PlannerAgent } from "./planner.js";
import type { ClaudeProvider, CompleteOptions } from "../providers/types.js";
import type { Retriever } from "../memory/retriever.js";
import type { MentalModel } from "../core/types.js";

class PlanProvider implements ClaudeProvider {
  readonly kind = "cli" as const;
  constructor(private readonly json: string) {}
  describe() {
    return "plan";
  }
  async healthCheck() {
    return { ok: true, detail: "plan" };
  }
  async complete(_opts: CompleteOptions) {
    return this.json;
  }
}

const emptyRetriever = { retrieve: async () => [] } as unknown as Retriever;
const model = {
  root: "/repo",
  generatedAt: "now",
  files: [{ path: "src/a.ts", hash: "h", size: 1, lines: 1, language: "ts" }],
  totals: { files: 1, lines: 1, bytes: 1 },
  languages: { ts: 1 },
  modules: { src: ["src/a.ts"] },
  signals: { ecosystem: "node", scripts: {}, hasGit: true },
} as unknown as MentalModel;

describe("PlannerAgent.decompose", () => {
  it("assigns stable step ids and maps 1-based dependsOn to ids", async () => {
    const provider = new PlanProvider(
      JSON.stringify({
        steps: [
          { title: "Create util", description: "extract", files: ["src/util.ts"], dependsOn: [] },
          { title: "Use util", description: "rewire", files: ["src/a.ts"], dependsOn: [1] },
        ],
      }),
    );
    const agent = new PlannerAgent(provider, emptyRetriever);
    const steps = await agent.decompose(model, "modularise");
    expect(steps).toHaveLength(2);
    expect(steps[0]!.id).toBe("step-001");
    expect(steps[1]!.id).toBe("step-002");
    expect(steps[1]!.dependsOn).toEqual(["step-001"]);
    expect(steps[0]!.files).toEqual(["src/util.ts"]);
  });

  it("drops self-referential or out-of-range dependencies", async () => {
    const provider = new PlanProvider(
      JSON.stringify({
        steps: [{ title: "A", description: "d", files: [], dependsOn: [1, 5] }],
      }),
    );
    const agent = new PlannerAgent(provider, emptyRetriever);
    const steps = await agent.decompose(model, "goal");
    expect(steps[0]!.dependsOn).toEqual([]);
  });
});
