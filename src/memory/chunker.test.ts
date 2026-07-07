import { describe, it, expect } from "vitest";
import { chunkFile } from "./chunker.js";

describe("chunkFile", () => {
  const opts = { chunkLines: 10, chunkOverlap: 2 };

  it("returns a single chunk for a small file", () => {
    const content = Array.from({ length: 5 }, (_, i) => `line ${i}`).join("\n");
    const chunks = chunkFile("a.ts", content, "hash", opts);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.startLine).toBe(1);
    expect(chunks[0]!.endLine).toBe(5);
    expect(chunks[0]!.language).toBe("ts");
    expect(chunks[0]!.fileHash).toBe("hash");
  });

  it("produces overlapping windows for a large file", () => {
    const content = Array.from({ length: 30 }, (_, i) => `line ${i}`).join("\n");
    const chunks = chunkFile("a.ts", content, "hash", opts);
    // step = chunkLines - overlap = 8
    expect(chunks.length).toBeGreaterThan(1);
    // Consecutive chunks overlap: chunk[1] starts before chunk[0] ends.
    expect(chunks[1]!.startLine).toBeLessThan(chunks[0]!.endLine);
    // ids are stable and unique
    const ids = new Set(chunks.map((c) => c.id));
    expect(ids.size).toBe(chunks.length);
    expect(chunks[0]!.id).toBe("a.ts#0");
  });

  it("skips whitespace-only files", () => {
    expect(chunkFile("a.ts", "\n\n\n", "h", opts)).toHaveLength(0);
  });

  it("covers the whole file", () => {
    const content = Array.from({ length: 25 }, (_, i) => `x${i}`).join("\n");
    const chunks = chunkFile("a.ts", content, "h", opts);
    expect(chunks.at(-1)!.endLine).toBe(25);
  });
});
