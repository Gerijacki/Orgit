import type { CodeChunk } from "../core/types.js";
import { languageOf } from "../util/fsutil.js";

/**
 * Split a file's contents into overlapping line-window chunks. Chunks are the unit
 * stored in vector memory; overlap preserves context that would otherwise be cut at
 * a boundary. This is deliberately language-agnostic and cheap — symbol-aware
 * chunking can be layered on later without changing the storage contract.
 */
export function chunkFile(
  path: string,
  content: string,
  fileHash: string,
  opts: { chunkLines: number; chunkOverlap: number },
): CodeChunk[] {
  const language = languageOf(path);
  const lines = content.split(/\r?\n/);
  const step = Math.max(1, opts.chunkLines - opts.chunkOverlap);
  const chunks: CodeChunk[] = [];

  if (lines.length === 0) return chunks;

  let index = 0;
  for (let start = 0; start < lines.length; start += step) {
    const end = Math.min(lines.length, start + opts.chunkLines);
    const slice = lines.slice(start, end).join("\n");
    if (slice.trim().length === 0) {
      if (end >= lines.length) break;
      continue;
    }
    chunks.push({
      id: `${path}#${index}`,
      path,
      index,
      startLine: start + 1,
      endLine: end,
      content: slice,
      fileHash,
      language,
    });
    index++;
    if (end >= lines.length) break;
  }
  return chunks;
}
