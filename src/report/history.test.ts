import { describe, it, expect, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadHistory, appendHistory, renderTrend, type HistoryEntry } from "./history.js";
import type { Workspace } from "../config/workspace.js";

let dir: string | undefined;
afterEach(async () => {
  if (dir) await fs.rm(dir, { recursive: true, force: true });
  dir = undefined;
});

async function ws(): Promise<Workspace> {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "orgit-hist-"));
  return { historyFile: path.join(dir, "history.json") } as unknown as Workspace;
}

function entry(score: number): HistoryEntry {
  return {
    timestamp: new Date().toISOString(),
    score,
    grade: "B",
    files: 1,
    lines: 1,
    opportunities: 0,
  };
}

describe("history", () => {
  it("returns an empty array when no history exists", async () => {
    expect(await loadHistory(await ws())).toEqual([]);
  });

  it("appends and reloads entries", async () => {
    const w = await ws();
    await appendHistory(w, entry(70));
    const after = await appendHistory(w, entry(75));
    expect(after).toHaveLength(2);
    expect((await loadHistory(w)).map((e) => e.score)).toEqual([70, 75]);
  });

  it("caps the history at 200 entries", async () => {
    const w = await ws();
    for (let i = 0; i < 210; i++) await appendHistory(w, entry(i));
    const all = await loadHistory(w);
    expect(all.length).toBe(200);
    expect(all[all.length - 1]!.score).toBe(209);
  });
});

describe("renderTrend", () => {
  it("labels the first score", () => {
    expect(renderTrend([entry(70)], 70)).toBe("first recorded score");
  });
  it("shows an increase", () => {
    expect(renderTrend([entry(70), entry(74)], 74)).toContain("▲ +4");
  });
  it("shows a decrease", () => {
    expect(renderTrend([entry(74), entry(70)], 70)).toContain("▼ -4");
  });
  it("shows no change", () => {
    expect(renderTrend([entry(70), entry(70)], 70)).toBe("no change since last run");
  });
});
