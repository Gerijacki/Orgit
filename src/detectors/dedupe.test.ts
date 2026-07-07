import { describe, it, expect } from "vitest";
import { dedupe } from "./detect.js";
import type { Opportunity } from "../core/types.js";

function op(partial: Partial<Opportunity> & Pick<Opportunity, "kind" | "files">): Opportunity {
  return {
    id: partial.id ?? `${partial.kind}-${partial.files.join(",")}`,
    summary: partial.summary ?? "x",
    confidence: partial.confidence ?? 0.5,
    source: partial.source ?? "static",
    ...partial,
  };
}

describe("dedupe", () => {
  it("keeps distinct opportunities untouched", () => {
    const ops = [
      op({ kind: "dead-code", files: ["a.ts"] }),
      op({ kind: "duplication", files: ["b.ts"] }),
    ];
    expect(dedupe(ops)).toHaveLength(2);
  });

  it("merges same-kind opportunities that share a file, keeping the most confident", () => {
    const ops = [
      op({ kind: "duplication", files: ["a.ts", "b.ts"], confidence: 0.4, summary: "low" }),
      op({ kind: "duplication", files: ["b.ts", "c.ts"], confidence: 0.9, summary: "high" }),
    ];
    const result = dedupe(ops);
    expect(result).toHaveLength(1);
    expect(result[0]!.confidence).toBe(0.9);
    expect(result[0]!.summary).toBe("high");
  });

  it("does not merge overlapping files of a different kind", () => {
    const ops = [
      op({ kind: "duplication", files: ["a.ts"] }),
      op({ kind: "long-function", files: ["a.ts"] }),
    ];
    expect(dedupe(ops)).toHaveLength(2);
  });

  it("keeps the first when a later overlapping op is less confident", () => {
    const ops = [
      op({ kind: "dead-code", files: ["a.ts"], confidence: 0.8, summary: "first" }),
      op({ kind: "dead-code", files: ["a.ts"], confidence: 0.2, summary: "second" }),
    ];
    const result = dedupe(ops);
    expect(result).toHaveLength(1);
    expect(result[0]!.summary).toBe("first");
  });
});
