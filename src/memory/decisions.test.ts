import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { resolveWorkspace } from "../config/workspace.js";
import {
  loadDecisions,
  appendDecision,
  recordTaskDecision,
  renderDecisions,
  type DecisionEntry,
} from "./decisions.js";

function entry(summary: string): DecisionEntry {
  return { id: summary, timestamp: new Date().toISOString(), kind: "task", summary };
}

describe("decision memory", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "orgit-dec-"));
  });
  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("returns [] when no file exists", async () => {
    expect(await loadDecisions(resolveWorkspace(dir))).toEqual([]);
  });

  it("appends and reloads entries", async () => {
    const ws = resolveWorkspace(dir);
    await appendDecision(ws, entry("first"));
    await appendDecision(ws, entry("second"));
    const all = await loadDecisions(ws);
    expect(all.map((d) => d.summary)).toEqual(["first", "second"]);
  });

  it("caps history at 200 entries", async () => {
    const ws = resolveWorkspace(dir);
    for (let i = 0; i < 210; i++) await appendDecision(ws, entry(`e${i}`));
    const all = await loadDecisions(ws);
    expect(all).toHaveLength(200);
    expect(all[0]!.summary).toBe("e10"); // oldest 10 trimmed
  });

  it("records a task decision with rationale and files", async () => {
    const ws = resolveWorkspace(dir);
    await recordTaskDecision(ws, {
      title: "extract helper",
      files: ["a.ts"],
      rationale: "removes duplication",
      commit: "abc123",
    });
    const [d] = await loadDecisions(ws);
    expect(d!.summary).toBe("extract helper");
    expect(d!.files).toEqual(["a.ts"]);
    expect(d!.commit).toBe("abc123");
  });
});

describe("renderDecisions", () => {
  it("returns empty string when there are none", () => {
    expect(renderDecisions([])).toBe("");
  });

  it("renders recent decisions most-recent-first with files and rationale", () => {
    const out = renderDecisions([
      { ...entry("old"), files: ["x.ts"], rationale: "why-old" },
      { ...entry("new"), files: ["y.ts"], rationale: "why-new" },
    ]);
    expect(out).toContain("do not repeat");
    const firstBullet = out.indexOf("- new");
    const secondBullet = out.indexOf("- old");
    expect(firstBullet).toBeGreaterThan(-1);
    expect(firstBullet).toBeLessThan(secondBullet); // most-recent-first
    expect(out).toContain("(y.ts)");
    expect(out).toContain("why-new");
  });

  it("respects the character budget", () => {
    const many = Array.from({ length: 100 }, (_, i) => entry(`decision-number-${i}`));
    const out = renderDecisions(many, { maxChars: 120 });
    expect(out.length).toBeLessThan(400);
  });
});
