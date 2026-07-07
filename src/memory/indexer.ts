import type { MentalModel, CodeChunk } from "../core/types.js";
import type { OrgitConfig } from "../config/config.js";
import { readFileSafe } from "../util/fsutil.js";
import { chunkFile } from "./chunker.js";
import { Embeddings } from "./embeddings.js";
import { MemoryStore } from "./store.js";

export interface IndexStats {
  added: number;
  changed: number;
  removed: number;
  unchanged: number;
  chunks: number;
}

/**
 * Incrementally sync the vector memory with the current repository state.
 *
 * Only files whose content hash differs from what's stored are re-chunked and
 * re-embedded; deleted files are purged. This is the core token-saving mechanism:
 * re-running analysis on a repo that changed one file costs one file's worth of work.
 */
export class Indexer {
  constructor(
    private readonly store: MemoryStore,
    private readonly embeddings: Embeddings,
    private readonly config: OrgitConfig,
  ) {}

  async sync(model: MentalModel): Promise<IndexStats> {
    const stored = await this.store.indexedFileHashes();
    const current = new Map(model.files.map((f) => [f.path, f.hash]));

    const toIndex = model.files.filter((f) => stored.get(f.path) !== f.hash);
    const removed = [...stored.keys()].filter((p) => !current.has(p));
    const unchanged = model.files.length - toIndex.length;

    const added = toIndex.filter((f) => !stored.has(f.path)).length;
    const changed = toIndex.length - added;

    if (removed.length > 0) await this.store.deletePaths(removed);

    let totalChunks = 0;
    // Build all chunks first, then embed in batches for throughput.
    const chunks: CodeChunk[] = [];
    for (const f of toIndex) {
      const content = await readFileSafe(model.root, f.path);
      if (content === null) continue;
      chunks.push(
        ...chunkFile(f.path, content, f.hash, {
          chunkLines: this.config.chunkLines,
          chunkOverlap: this.config.chunkOverlap,
        }),
      );
    }

    if (chunks.length > 0) {
      const vectors = await this.embeddings.embedDocuments(chunks.map((c) => c.content));
      await this.store.upsert(chunks, vectors);
      totalChunks = chunks.length;
    }

    return { added, changed, removed: removed.length, unchanged, chunks: totalChunks };
  }
}
