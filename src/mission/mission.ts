import { promises as fs } from "node:fs";
import type { Workspace } from "../config/workspace.js";

/**
 * A Mission is Orgit's long-term memory of a large refactoring process. The user states
 * a goal ONCE; Orgit decomposes it into ordered steps and persists everything to
 * `.orgit/mission.json`. Because it is stored on disk and reloaded on every run, the
 * original goal — and exactly which step is next — survives across any number of
 * iterations, crashes, or days. This is what lets Orgit be meticulous over the long haul:
 * it never forgets what it was asked to do until the mission is complete.
 */

export type StepStatus = "pending" | "in-progress" | "done" | "blocked";

export interface MissionStep {
  /** Stable id, e.g. `step-001`. */
  id: string;
  title: string;
  /** What this step changes and why, in enough detail to execute later. */
  description: string;
  status: StepStatus;
  /** Files this step is expected to touch (existing or new). */
  files: string[];
  /** Ids of earlier steps that must complete first (ordering / dependencies). */
  dependsOn: string[];
  /** Commit(s) that advanced this step. */
  commits: string[];
  /** Outcome / reason blocked. */
  note?: string;
}

export type MissionStatus = "active" | "completed" | "abandoned";

export interface MissionLogEntry {
  at: string;
  message: string;
}

export interface Mission {
  id: string;
  /** The user's original request — remembered verbatim for the life of the mission. */
  goal: string;
  createdAt: string;
  updatedAt: string;
  status: MissionStatus;
  steps: MissionStep[];
  /** Meticulous, append-only progress log across all runs. */
  log: MissionLogEntry[];
}

export function createMission(
  goal: string,
  steps: Omit<MissionStep, "commits" | "status">[],
): Mission {
  const now = new Date().toISOString();
  return {
    id: `mission-${now.replace(/[:.]/g, "-")}`,
    goal,
    createdAt: now,
    updatedAt: now,
    status: "active",
    steps: steps.map((s) => ({ ...s, status: "pending", commits: [] })),
    log: [{ at: now, message: `Mission created: ${goal}` }],
  };
}

export async function loadMission(ws: Workspace): Promise<Mission | null> {
  try {
    const raw = await fs.readFile(ws.missionFile, "utf8");
    return JSON.parse(raw) as Mission;
  } catch {
    return null;
  }
}

export async function saveMission(ws: Workspace, mission: Mission): Promise<void> {
  mission.updatedAt = new Date().toISOString();
  await fs.writeFile(ws.missionFile, JSON.stringify(mission, null, 2), "utf8");
}

export function addLog(mission: Mission, message: string): void {
  mission.log.push({ at: new Date().toISOString(), message });
}

/** The next step ready to run: pending, with all dependencies done. Null if none. */
export function nextRunnableStep(mission: Mission): MissionStep | null {
  const done = new Set(mission.steps.filter((s) => s.status === "done").map((s) => s.id));
  return (
    mission.steps.find((s) => s.status === "pending" && s.dependsOn.every((d) => done.has(d))) ??
    null
  );
}

/** All currently-runnable steps (pending + dependencies satisfied) — candidates to run in parallel. */
export function runnableSteps(mission: Mission): MissionStep[] {
  const done = new Set(mission.steps.filter((s) => s.status === "done").map((s) => s.id));
  return mission.steps.filter(
    (s) => s.status === "pending" && s.dependsOn.every((d) => done.has(d)),
  );
}

export function stepById(mission: Mission, id: string): MissionStep | undefined {
  return mission.steps.find((s) => s.id === id);
}

/** Recompute the mission's overall status from its steps. */
export function refreshStatus(mission: Mission): void {
  if (mission.status === "abandoned") return;
  const allDone = mission.steps.every((s) => s.status === "done");
  const anyRunnable = runnableSteps(mission).length > 0;
  const anyActive = mission.steps.some((s) => s.status === "in-progress");
  if (allDone) mission.status = "completed";
  else if (!anyRunnable && !anyActive)
    mission.status = "active"; // stalled (all remaining blocked) — still active, needs attention
  else mission.status = "active";
}

export interface MissionProgress {
  total: number;
  done: number;
  blocked: number;
  pending: number;
  inProgress: number;
  percent: number;
}

export function progressOf(mission: Mission): MissionProgress {
  const total = mission.steps.length;
  const by = (st: StepStatus) => mission.steps.filter((s) => s.status === st).length;
  const done = by("done");
  return {
    total,
    done,
    blocked: by("blocked"),
    pending: by("pending"),
    inProgress: by("in-progress"),
    percent: total === 0 ? 0 : Math.round((done / total) * 100),
  };
}

/** Render the mission as a step-by-step checklist for the CLI / reports. */
export function renderMission(mission: Mission): string {
  const p = progressOf(mission);
  const icon: Record<StepStatus, string> = {
    done: "[x]",
    "in-progress": "[~]",
    blocked: "[!]",
    pending: "[ ]",
  };
  const lines = [
    `# Mission — ${mission.status}`,
    ``,
    `**Goal:** ${mission.goal}`,
    ``,
    `Progress: ${p.done}/${p.total} steps (${p.percent}%)` +
      (p.blocked ? ` · ${p.blocked} blocked` : ""),
    ``,
    `## Steps`,
    ``,
    ...mission.steps.map(
      (s) =>
        `- ${icon[s.status]} **${s.id}** ${s.title}` +
        (s.files.length ? ` — \`${s.files.join("`, `")}\`` : "") +
        (s.note ? `\n      ${s.note}` : ""),
    ),
  ];
  return lines.join("\n");
}
