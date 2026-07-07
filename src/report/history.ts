import { promises as fs } from "node:fs";
import type { Workspace } from "../config/workspace.js";
import type { Health } from "../analysis/health.js";

/**
 * Persistent health history under `.orgit/history.json`. Each audit/evolve appends an
 * entry, so users can see the score trend across runs — the concrete evidence that a
 * repository is getting healthier (and the payoff signal for continuous mode).
 */
export interface HistoryEntry {
  timestamp: string;
  score: number;
  grade: Health["grade"];
  files: number;
  lines: number;
  opportunities: number;
}

export async function loadHistory(ws: Workspace): Promise<HistoryEntry[]> {
  try {
    const raw = await fs.readFile(ws.historyFile, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as HistoryEntry[]) : [];
  } catch {
    return [];
  }
}

export async function appendHistory(ws: Workspace, entry: HistoryEntry): Promise<HistoryEntry[]> {
  const history = await loadHistory(ws);
  history.push(entry);
  // Keep the file bounded; the tail is what matters for trend.
  const trimmed = history.slice(-200);
  await fs.writeFile(ws.historyFile, JSON.stringify(trimmed, null, 2), "utf8");
  return trimmed;
}

/** Human-readable delta vs the previous recorded score, e.g. "▲ +4" or "▼ -2". */
export function renderTrend(history: HistoryEntry[], current: number): string {
  if (history.length < 2) return "first recorded score";
  const prev = history[history.length - 2]!.score;
  const delta = current - prev;
  if (delta === 0) return "no change since last run";
  const arrow = delta > 0 ? "▲" : "▼";
  return `${arrow} ${delta > 0 ? "+" : ""}${delta} since last run`;
}
