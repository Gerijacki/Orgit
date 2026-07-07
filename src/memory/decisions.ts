import { promises as fs } from "node:fs";
import path from "node:path";
import type { Workspace } from "../config/workspace.js";

/**
 * Cross-run **decision memory**, persisted to `.orgit/decisions.json`. Every committed
 * task (and, optionally, notable findings) is appended here, so Orgit remembers what it
 * has already decided and done across *any* number of runs — not just within a mission.
 * A distilled, deterministic render is fed back into detection/planning prompts (via the
 * cached prefix), so it avoids re-proposing work it already did and carries real context
 * forward. Building this costs **zero tokens** — it is pure bookkeeping.
 */
export interface DecisionEntry {
  id: string;
  timestamp: string;
  kind: "task" | "finding" | "note";
  /** One-line description of the decision/change. */
  summary: string;
  /** Files involved, if any. */
  files?: string[];
  /** Short rationale (why it was done). */
  rationale?: string;
  /** Commit sha when the decision produced a commit. */
  commit?: string;
}

const MAX_DECISIONS = 200;

export async function loadDecisions(ws: Workspace): Promise<DecisionEntry[]> {
  try {
    const raw = await fs.readFile(ws.decisionsFile, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as DecisionEntry[]) : [];
  } catch {
    return [];
  }
}

export async function appendDecision(
  ws: Workspace,
  entry: DecisionEntry,
): Promise<DecisionEntry[]> {
  const decisions = await loadDecisions(ws);
  decisions.push(entry);
  const trimmed = decisions.slice(-MAX_DECISIONS);
  await fs.mkdir(path.dirname(ws.decisionsFile), { recursive: true });
  await fs.writeFile(ws.decisionsFile, JSON.stringify(trimmed, null, 2), "utf8");
  return trimmed;
}

/** Stable-ish id from a monotonic timestamp plus a short random suffix. */
function decisionId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

/** Convenience: record a committed task as a decision. */
export async function recordTaskDecision(
  ws: Workspace,
  input: { title: string; files?: string[]; rationale?: string; commit?: string },
): Promise<void> {
  await appendDecision(ws, {
    id: decisionId(),
    timestamp: new Date().toISOString(),
    kind: "task",
    summary: input.title,
    files: input.files,
    rationale: input.rationale,
    commit: input.commit,
  });
}

/**
 * Render the most recent decisions as a compact block for a prompt. Deterministic and
 * bounded (most-recent-first, capped by count and characters) so it never blows the
 * token budget. Returns "" when there is nothing to say.
 */
export function renderDecisions(
  decisions: DecisionEntry[],
  opts: { limit?: number; maxChars?: number } = {},
): string {
  if (decisions.length === 0) return "";
  const limit = opts.limit ?? 30;
  const maxChars = opts.maxChars ?? 2_000;
  const recent = decisions.slice(-limit).reverse();

  const lines: string[] = [];
  let used = 0;
  for (const d of recent) {
    const where = d.files && d.files.length > 0 ? ` (${d.files.slice(0, 4).join(", ")})` : "";
    const why = d.rationale ? ` — ${d.rationale}` : "";
    const line = `- ${d.summary}${where}${why}`;
    if (used + line.length > maxChars) break;
    lines.push(line);
    used += line.length;
  }
  if (lines.length === 0) return "";
  return `Already done in previous Orgit runs (do not repeat these):\n${lines.join("\n")}`;
}
