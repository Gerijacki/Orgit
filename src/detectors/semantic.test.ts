import { describe, it, expect } from "vitest";
import { detectSemanticDuplication, normalize, dot } from "./semantic.js";
import type { MemoryStore } from "../memory/store.js";
import type { CodeChunk } from "../core/types.js";

function chunk(path: string, vector: number[], lines = 8): CodeChunk & { vector: number[] } {
  return {
    id: `${path}#0`,
    path,
    index: 0,
    startLine: 1,
    endLine: lines,
    content: Array.from({ length: lines }, (_, i) => `line ${i} of ${path}`).join("\n"),
    fileHash: "h",
    language: "ts",
    vector,
  };
}

function fakeStore(rows: Array<CodeChunk & { vector: number[] }>): MemoryStore {
  return { scanVectors: async () => rows } as unknown as MemoryStore;
}

describe("normalize / dot", () => {
  it("normalize yields a unit vector; dot of identical unit vectors is 1", () => {
    const u = normalize([3, 4]);
    expect(Math.hypot(u[0]!, u[1]!)).toBeCloseTo(1, 6);
    expect(dot(u, u)).toBeCloseTo(1, 6);
  });
});

describe("detectSemanticDuplication", () => {
  it("flags near-duplicate chunks across different files", async () => {
    const store = fakeStore([
      chunk("a.ts", [1, 0, 0]),
      chunk("b.ts", [0.99, 0.01, 0]), // ~parallel to a.ts
      chunk("c.ts", [0, 1, 0]), // orthogonal
    ]);
    const ops = await detectSemanticDuplication(store, { threshold: 0.9, minLines: 4 });
    expect(ops).toHaveLength(1);
    expect(ops[0]!.kind).toBe("duplication");
    expect(ops[0]!.files.sort()).toEqual(["a.ts", "b.ts"]);
    expect(ops[0]!.source).toBe("static");
  });

  it("ignores chunks in the same file (overlap is by design)", async () => {
    const store = fakeStore([
      { ...chunk("a.ts", [1, 0, 0]), id: "a.ts#0", index: 0 },
      { ...chunk("a.ts", [1, 0, 0]), id: "a.ts#1", index: 1 },
    ]);
    const ops = await detectSemanticDuplication(store, { threshold: 0.9, minLines: 4 });
    expect(ops).toHaveLength(0);
  });

  it("respects the similarity threshold", async () => {
    const store = fakeStore([chunk("a.ts", [1, 0, 0]), chunk("b.ts", [0.5, 0.87, 0])]);
    const ops = await detectSemanticDuplication(store, { threshold: 0.95, minLines: 4 });
    expect(ops).toHaveLength(0);
  });

  it("filters out chunks with too few lines", async () => {
    const store = fakeStore([chunk("a.ts", [1, 0, 0], 3), chunk("b.ts", [1, 0, 0], 3)]);
    const ops = await detectSemanticDuplication(store, { threshold: 0.9, minLines: 6 });
    expect(ops).toHaveLength(0);
  });

  it("skips very large chunk sets", async () => {
    const rows = Array.from({ length: 10 }, (_, i) => chunk(`f${i}.ts`, [1, 0, 0]));
    const ops = await detectSemanticDuplication(store2(rows), { maxChunks: 5, threshold: 0.9 });
    expect(ops).toHaveLength(0);
  });
});

function store2(rows: Array<CodeChunk & { vector: number[] }>): MemoryStore {
  return fakeStore(rows);
}
