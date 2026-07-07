import { describe, it, expect } from "vitest";
import { Retriever } from "./retriever.js";
import type { ChunkHit } from "./store.js";

function hit(path: string, startLine: number, endLine: number, content: string): ChunkHit {
  return {
    id: `${path}#${startLine}`,
    path,
    index: startLine,
    startLine,
    endLine,
    content,
    fileHash: "h",
    language: "ts",
    distance: 0.1,
  };
}

describe("Retriever.renderContext", () => {
  it("renders cited chunks", () => {
    const out = Retriever.renderContext([hit("a.ts", 1, 3, "AAA")]);
    expect(out).toContain("// a.ts:1-3");
    expect(out).toContain("AAA");
  });

  it("drops overlapping same-file chunks", () => {
    const out = Retriever.renderContext([
      hit("a.ts", 1, 10, "FIRST"),
      hit("a.ts", 5, 15, "OVERLAP"),
      hit("a.ts", 20, 25, "SEPARATE"),
    ]);
    expect(out).toContain("FIRST");
    expect(out).not.toContain("OVERLAP");
    expect(out).toContain("SEPARATE");
  });

  it("skips an oversized chunk but keeps packing smaller later ones", () => {
    const big = hit("big.ts", 1, 999, "X".repeat(500));
    const small = hit("small.ts", 1, 2, "small-content");
    // Budget fits `small` but not `big`; the old code would `break` on `big` and lose `small`.
    const out = Retriever.renderContext([big, small], 100);
    expect(out).not.toContain("XXXX");
    expect(out).toContain("small-content");
  });
});
