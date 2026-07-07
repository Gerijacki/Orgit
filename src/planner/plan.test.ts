import { describe, it, expect } from "vitest";
import { buildPlan } from "./plan.js";
import { prioritize } from "./prioritize.js";
import { DEFAULT_CONFIG } from "../config/config.js";
import type { MentalModel, Opportunity } from "../core/types.js";

const model = { root: "/repo" } as unknown as MentalModel;

function op(id: string, partial: Partial<Opportunity> = {}): Opportunity {
  return {
    id,
    kind: "dead-code",
    files: ["a.ts"],
    summary: `summary ${id}`,
    confidence: 0.8,
    source: "static",
    ...partial,
  };
}

describe("buildPlan", () => {
  it("creates one task per opportunity with a four-part rationale", () => {
    const scored = prioritize([op("x", { kind: "duplication", files: ["a.ts", "b.ts"] })]);
    const plan = buildPlan(model, scored, DEFAULT_CONFIG);
    expect(plan.tasks).toHaveLength(1);
    const t = plan.tasks[0]!;
    expect(t.id).toBe("task-001");
    expect(t.files).toEqual(["a.ts", "b.ts"]);
    expect(t.rationale.why).toBeTruthy();
    expect(t.rationale.improves).toBeTruthy();
    expect(t.rationale.problem).toBeTruthy();
    expect(t.rationale.impact).toBeTruthy();
    expect(t.title.toLowerCase()).toContain("de-duplicate");
  });

  it("caps the plan at maxTasksPerPlan", () => {
    const scored = prioritize(Array.from({ length: 30 }, (_, i) => op(`o${i}`)));
    const plan = buildPlan(model, scored, { ...DEFAULT_CONFIG, maxTasksPerPlan: 5 });
    expect(plan.tasks).toHaveLength(5);
  });

  it("preserves the prioritised order (highest score first)", () => {
    const scored = prioritize([
      op("low", { kind: "large-file", confidence: 0.6 }),
      op("high", { kind: "dead-code", confidence: 0.95 }),
    ]);
    const plan = buildPlan(model, scored, DEFAULT_CONFIG);
    expect(plan.tasks[0]!.opportunityId).toBe("high");
  });
});
