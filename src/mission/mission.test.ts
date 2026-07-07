import { describe, it, expect, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  createMission,
  loadMission,
  saveMission,
  addLog,
  nextRunnableStep,
  runnableSteps,
  progressOf,
  refreshStatus,
  renderMission,
  stepById,
  type Mission,
  type MissionStep,
} from "./mission.js";
import type { Workspace } from "../config/workspace.js";

let dir: string | undefined;
afterEach(async () => {
  if (dir) await fs.rm(dir, { recursive: true, force: true });
  dir = undefined;
});

async function ws(): Promise<Workspace> {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "orgit-mission-"));
  return { missionFile: path.join(dir, "mission.json") } as unknown as Workspace;
}

function steps(): Omit<MissionStep, "commits" | "status">[] {
  return [
    {
      id: "step-001",
      title: "Extract validator",
      description: "d",
      files: ["a.ts"],
      dependsOn: [],
    },
    {
      id: "step-002",
      title: "Use validator",
      description: "d",
      files: ["b.ts"],
      dependsOn: ["step-001"],
    },
  ];
}

describe("mission model", () => {
  it("createMission seeds pending steps and a log entry, remembering the goal", () => {
    const m = createMission("Modularise the auth layer", steps());
    expect(m.goal).toBe("Modularise the auth layer");
    expect(m.status).toBe("active");
    expect(m.steps.every((s) => s.status === "pending" && s.commits.length === 0)).toBe(true);
    expect(m.log[0]!.message).toContain("Modularise the auth layer");
  });

  it("persists and reloads a mission verbatim (goal survives)", async () => {
    const w = await ws();
    const m = createMission("Big refactor", steps());
    await saveMission(w, m);
    const loaded = await loadMission(w);
    expect(loaded).not.toBeNull();
    expect(loaded!.goal).toBe("Big refactor");
    expect(loaded!.steps).toHaveLength(2);
  });

  it("returns null when no mission exists", async () => {
    expect(await loadMission(await ws())).toBeNull();
  });

  it("nextRunnableStep respects dependencies", () => {
    const m = createMission("g", steps());
    // step-002 depends on step-001, so step-001 runs first.
    expect(nextRunnableStep(m)!.id).toBe("step-001");
    stepById(m, "step-001")!.status = "done";
    expect(nextRunnableStep(m)!.id).toBe("step-002");
  });

  it("runnableSteps excludes steps whose dependencies aren't done", () => {
    const m = createMission("g", steps());
    expect(runnableSteps(m).map((s) => s.id)).toEqual(["step-001"]);
  });

  it("progressOf and refreshStatus track completion", () => {
    const m = createMission("g", steps());
    expect(progressOf(m).percent).toBe(0);
    m.steps.forEach((s) => (s.status = "done"));
    refreshStatus(m);
    expect(m.status).toBe("completed");
    expect(progressOf(m).percent).toBe(100);
  });

  it("renderMission shows a step checklist with status icons", () => {
    const m = createMission("Do the thing", steps());
    stepById(m, "step-001")!.status = "done";
    const out = renderMission(m);
    expect(out).toContain("**Goal:** Do the thing");
    expect(out).toContain("[x] **step-001**");
    expect(out).toContain("[ ] **step-002**");
  });

  it("addLog appends timestamped entries", () => {
    const m: Mission = createMission("g", steps());
    const before = m.log.length;
    addLog(m, "did a thing");
    expect(m.log.length).toBe(before + 1);
    expect(m.log.at(-1)!.message).toBe("did a thing");
  });
});
