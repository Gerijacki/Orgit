import { describe, it, expect } from "vitest";
import { prioritize } from "./prioritize.js";
import type { Opportunity } from "../core/types.js";

function op(partial: Partial<Opportunity>): Opportunity {
  return {
    id: "x",
    kind: "other",
    files: ["a.ts"],
    summary: "s",
    confidence: 0.8,
    source: "static",
    ...partial,
  };
}

describe("prioritize", () => {
  it("ranks low-risk/high-benefit opportunities first", () => {
    const scored = prioritize([
      op({ id: "big", kind: "large-file", confidence: 0.7 }),
      op({ id: "dead", kind: "dead-code", confidence: 0.9 }),
    ]);
    expect(scored[0]!.id).toBe("dead");
    expect(scored[0]!.score).toBeGreaterThanOrEqual(scored[1]!.score);
  });

  it("clamps benefit and risk to 1..5", () => {
    const [s] = prioritize([op({ kind: "dead-code", confidence: 1 })]);
    expect(s!.benefit).toBeGreaterThanOrEqual(1);
    expect(s!.benefit).toBeLessThanOrEqual(5);
    expect(s!.risk).toBeGreaterThanOrEqual(1);
    expect(s!.risk).toBeLessThanOrEqual(5);
  });

  it("adds risk for multi-file changes", () => {
    const single = prioritize([op({ kind: "duplication", files: ["a.ts"] })])[0]!;
    const multi = prioritize([op({ kind: "duplication", files: ["a.ts", "b.ts", "c.ts"] })])[0]!;
    expect(multi.risk).toBeGreaterThan(single.risk);
  });

  it("computes score as benefit/risk", () => {
    const [s] = prioritize([op({ kind: "poor-naming", confidence: 0.8 })]);
    expect(s!.score).toBeCloseTo(s!.benefit / s!.risk, 2);
  });
});
