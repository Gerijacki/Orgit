import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildStateSnapshot } from "./state.js";
import { resolveWorkspace } from "../config/workspace.js";
import { DEFAULT_CONFIG } from "../config/config.js";
import type { RunContext } from "../engine/context.js";

let dir: string;

// A minimal in-memory context: real mental model over temp files, an empty vector store.
function fakeCtx(root: string): RunContext {
  return {
    root,
    config: DEFAULT_CONFIG,
    workspace: resolveWorkspace(root),
    store: { scanVectors: async () => [], countRows: async () => 0 },
  } as unknown as RunContext;
}

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "orgit-state-"));
  await fs.mkdir(path.join(dir, "src"), { recursive: true });
  await fs.writeFile(path.join(dir, "src", "a.ts"), "export const a = 1;\n");
  await fs.writeFile(path.join(dir, "src", "b.ts"), "export const b = 2;\n");
});
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe("buildStateSnapshot", () => {
  it("summarizes analysis, health and memory over a real repo", async () => {
    const snap = await buildStateSnapshot(fakeCtx(dir));
    expect(snap.totals.files).toBe(2);
    expect(snap.languages.ts).toBe(2);
    expect(snap.health.score).toBeGreaterThan(0);
    expect(["A", "B", "C", "D", "F"]).toContain(snap.health.grade);
    expect(snap.memoryChunks).toBe(0);
    expect(snap.mission).toBeNull();
    expect(snap.trend).toBe("first recorded score");
    expect(snap.decisions.count).toBe(0);
    expect(Array.isArray(snap.reports)).toBe(true);
  });
});
