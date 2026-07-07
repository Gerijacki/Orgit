import { describe, it, expect } from "vitest";
import { computeHealth } from "./health.js";
import type { MentalModel, Opportunity } from "../core/types.js";

function model(overrides: Partial<MentalModel> = {}): MentalModel {
  return {
    root: "/repo",
    generatedAt: "now",
    files: [
      { path: "src/a.ts", hash: "h", size: 100, lines: 50, language: "ts" },
      { path: "src/b.ts", hash: "h", size: 100, lines: 50, language: "ts" },
      { path: "README.md", hash: "h", size: 10, lines: 5, language: "md" },
    ],
    totals: { files: 3, lines: 105, bytes: 210 },
    languages: { ts: 2, md: 1 },
    modules: { src: ["src/a.ts", "src/b.ts"] },
    signals: { ecosystem: "node", scripts: {}, hasGit: true },
    ...overrides,
  };
}

function op(kind: Opportunity["kind"]): Opportunity {
  return { id: kind, kind, files: ["src/a.ts"], summary: "s", confidence: 0.8, source: "static" };
}

describe("computeHealth", () => {
  it("gives a clean repo a perfect or near-perfect score", () => {
    const h = computeHealth(model(), []);
    expect(h.score).toBe(100);
    expect(h.grade).toBe("A");
  });

  it("lowers the score as issues accumulate", () => {
    const clean = computeHealth(model(), []).score;
    const messy = computeHealth(model(), [
      op("large-file"),
      op("long-function"),
      op("duplication"),
      op("duplication"),
    ]).score;
    expect(messy).toBeLessThan(clean);
  });

  it("counts metric categories", () => {
    const h = computeHealth(model(), [op("large-file"), op("duplication"), op("poor-naming")]);
    expect(h.metrics.largeFiles).toBe(1);
    expect(h.metrics.duplication).toBe(1);
    expect(h.metrics.otherIssues).toBe(1);
  });

  it("caps any single dimension so it cannot dominate the score", () => {
    // 40 duplications alone hit the duplication cap (−25) → score stays at 75.
    const h = computeHealth(
      model(),
      Array.from({ length: 40 }, () => op("duplication")),
    );
    expect(h.score).toBe(75);
  });

  it("clamps to 0..100 and fails a repo that is messy across many dimensions", () => {
    const many = [
      ...Array.from({ length: 6 }, () => op("large-file")),
      ...Array.from({ length: 12 }, () => op("long-function")),
      ...Array.from({ length: 8 }, () => op("duplication")),
      ...Array.from({ length: 12 }, () => op("poor-naming")),
    ];
    const h = computeHealth(model(), many);
    expect(h.score).toBeGreaterThanOrEqual(0);
    expect(h.score).toBeLessThanOrEqual(100);
    expect(["D", "F"]).toContain(h.grade);
  });
});
