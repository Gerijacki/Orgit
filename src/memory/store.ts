import * as lancedb from "@lancedb/lancedb";
import type { CodeChunk } from "../core/types.js";

const TABLE = "chunks";

/** A row as stored in LanceDB: a chunk plus its embedding vector. */
interface ChunkRow {
  id: string;
  path: string;
  index: number;
  startLine: number;
  endLine: number;
  content: string;
  fileHash: string;
  language: string;
  vector: number[];
}

/** A search hit: the chunk fields plus a distance (`_distance`, lower = closer). */
export interface ChunkHit extends CodeChunk {
  distance: number;
}

/**
 * Embedded vector store over the repo's code chunks, backed by LanceDB (file-based,
 * no server). Supports incremental upserts keyed by file path, which is what makes
 * re-analysis cheap: only changed files are re-embedded and rewritten.
 */
export class MemoryStore {
  private db?: lancedb.Connection;
  private table?: lancedb.Table;

  constructor(private readonly dir: string) {}

  async open(): Promise<void> {
    this.db = await lancedb.connect(this.dir);
    const names = await this.db.tableNames();
    if (names.includes(TABLE)) {
      this.table = await this.db.openTable(TABLE);
    }
  }

  private requireDb(): lancedb.Connection {
    if (!this.db) throw new Error("MemoryStore.open() must be called first");
    return this.db;
  }

  /** Insert/replace all chunks for the given paths. Existing rows for those paths are removed first. */
  async upsert(chunks: CodeChunk[], vectors: number[][]): Promise<void> {
    if (chunks.length === 0) return;
    const rows: ChunkRow[] = chunks.map((c, i) => ({ ...c, vector: vectors[i]! }));

    const data = rows as unknown as Record<string, unknown>[];
    if (!this.table) {
      this.table = await this.requireDb().createTable(TABLE, data, { mode: "create" });
      return;
    }
    const paths = [...new Set(chunks.map((c) => c.path))];
    await this.deletePaths(paths);
    await this.table.add(data);
  }

  /** Remove all chunks belonging to the given file paths. */
  async deletePaths(paths: string[]): Promise<void> {
    if (!this.table || paths.length === 0) return;
    const list = paths.map((p) => `'${p.replace(/'/g, "''")}'`).join(", ");
    await this.table.delete(`path IN (${list})`);
  }

  /** Map of indexed file path → the fileHash currently stored, for incremental diffing. */
  async indexedFileHashes(): Promise<Map<string, string>> {
    const map = new Map<string, string>();
    if (!this.table) return map;
    const rows = (await this.table.query().select(["path", "fileHash"]).toArray()) as Array<{
      path: string;
      fileHash: string;
    }>;
    for (const r of rows) map.set(r.path, r.fileHash);
    return map;
  }

  /** Nearest-neighbour search. Returns up to `k` chunks ordered by similarity. */
  async search(vector: number[], k: number): Promise<ChunkHit[]> {
    if (!this.table) return [];
    const rows = (await this.table.query().nearestTo(vector).limit(k).toArray()) as Array<
      ChunkRow & { _distance: number }
    >;
    return rows.map((r) => ({
      id: r.id,
      path: r.path,
      index: r.index,
      startLine: r.startLine,
      endLine: r.endLine,
      content: r.content,
      fileHash: r.fileHash,
      language: r.language,
      distance: r._distance,
    }));
  }

  async countRows(): Promise<number> {
    if (!this.table) return 0;
    return this.table.countRows();
  }

  /**
   * Read every stored chunk with its embedding vector. Used by the semantic
   * duplication detector, which reuses the vectors already computed for memory —
   * so cross-file duplication is found without spending any Claude tokens.
   */
  async scanVectors(): Promise<Array<CodeChunk & { vector: number[] }>> {
    if (!this.table) return [];
    const rows = (await this.table.query().toArray()) as ChunkRow[];
    return rows.map((r) => ({
      id: r.id,
      path: r.path,
      index: r.index,
      startLine: r.startLine,
      endLine: r.endLine,
      content: r.content,
      fileHash: r.fileHash,
      language: r.language,
      vector: Array.from(r.vector),
    }));
  }
}
