import type { Embeddings } from "./embeddings.js";
import type { MemoryStore, ChunkHit } from "./store.js";

/**
 * Retrieval side of the memory layer. Given a natural-language question about the
 * repo, return the most relevant code chunks so the LLM sees a focused context
 * instead of whole files — the concrete way memory reduces token usage.
 */
export class Retriever {
  constructor(
    private readonly store: MemoryStore,
    private readonly embeddings: Embeddings,
  ) {}

  async retrieve(query: string, k = 8): Promise<ChunkHit[]> {
    const vector = await this.embeddings.embedQuery(query);
    return this.store.search(vector, k);
  }

  /** Default character budget for a rendered context block (~3k tokens). */
  static readonly DEFAULT_CONTEXT_BUDGET = 12_000;

  /**
   * Render retrieved chunks as a compact, cited context block for a prompt. Overlapping
   * chunks from the same file are dropped (the chunker's sliding windows overlap), and a
   * chunk that would overflow the budget is skipped rather than ending the loop — so one
   * large early chunk no longer discards every smaller, relevant chunk after it.
   */
  static renderContext(hits: ChunkHit[], maxChars = Retriever.DEFAULT_CONTEXT_BUDGET): string {
    const parts: string[] = [];
    const seen = new Map<string, Array<[number, number]>>();
    let used = 0;
    for (const h of hits) {
      const ranges = seen.get(h.path) ?? [];
      if (ranges.some(([s, e]) => h.startLine <= e && h.endLine >= s)) continue; // overlaps
      const block = `// ${h.path}:${h.startLine}-${h.endLine}\n${h.content}`;
      if (used + block.length > maxChars) continue; // skip, keep packing smaller chunks
      parts.push(block);
      used += block.length;
      ranges.push([h.startLine, h.endLine]);
      seen.set(h.path, ranges);
    }
    return parts.join("\n\n");
  }
}
