import { promises as fs } from "node:fs";
import type { RunContext } from "../engine/context.js";
import { buildMentalModel } from "../analysis/model.js";
import { runStaticAnalyzers } from "../analysis/static.js";
import { detectSemanticDuplication } from "../detectors/semantic.js";
import { computeHealth, type Health } from "../analysis/health.js";
import { loadHistory, renderTrend } from "../report/history.js";
import {
  loadMission,
  progressOf,
  type MissionProgress,
  type StepStatus,
} from "../mission/mission.js";
import { loadConventions } from "../memory/conventions.js";
import { loadDecisions } from "../memory/decisions.js";

/** A read-only, JSON-serializable snapshot of the repo's state for the web dashboard. */
export interface StateSnapshot {
  root: string;
  generatedAt: string;
  totals: { files: number; lines: number; bytes: number };
  languages: Record<string, number>;
  modules: Array<{ name: string; files: number }>;
  health: Health;
  trend: string;
  opportunities: { total: number; byKind: Record<string, number> };
  memoryChunks: number;
  mission: {
    goal: string;
    status: string;
    progress: MissionProgress;
    steps: Array<{ id: string; title: string; status: StepStatus }>;
  } | null;
  conventions: {
    indent: string;
    quotes: string;
    semicolons: boolean | "unknown";
    testFramework?: string;
  };
  decisions: { count: number; recent: Array<{ summary: string; commit?: string }> };
  reports: string[];
}

/**
 * Assemble the dashboard snapshot from the same sources `orgit status` uses, plus a live
 * (token-free) mental model + static/semantic analysis so the UI shows current analysis,
 * not just the last persisted run. Requires no Claude provider.
 */
export async function buildStateSnapshot(ctx: RunContext): Promise<StateSnapshot> {
  const model = await buildMentalModel(ctx.root, ctx.config);

  const staticOps = await runStaticAnalyzers(model);
  let semanticOps: Awaited<ReturnType<typeof detectSemanticDuplication>> = [];
  try {
    semanticOps = await detectSemanticDuplication(ctx.store, {
      threshold: ctx.config.duplicationThreshold,
      maxChunks: ctx.config.semanticMaxChunks,
    });
  } catch {
    /* memory may be empty — fine */
  }
  const opportunities = [...staticOps, ...semanticOps];
  const byKind: Record<string, number> = {};
  for (const o of opportunities) byKind[o.kind] = (byKind[o.kind] ?? 0) + 1;
  const health = computeHealth(model, opportunities);

  const history = await loadHistory(ctx.workspace);
  const trend = history.length > 0 ? renderTrend(history, health.score) : "first recorded score";

  let memoryChunks = 0;
  try {
    memoryChunks = await ctx.store.countRows();
  } catch {
    /* store not opened / empty */
  }

  const mission = await loadMission(ctx.workspace);
  const conventions = await loadConventions(ctx.workspace);
  const decisions = await loadDecisions(ctx.workspace);

  let reports: string[] = [];
  try {
    reports = (await fs.readdir(ctx.workspace.reportsDir))
      .filter((f) => f.endsWith("-latest.md"))
      .sort();
  } catch {
    /* no reports yet */
  }

  return {
    root: ctx.root,
    generatedAt: new Date().toISOString(),
    totals: model.totals,
    languages: model.languages,
    modules: Object.entries(model.modules)
      .map(([name, files]) => ({ name, files: files.length }))
      .sort((a, b) => b.files - a.files)
      .slice(0, 20),
    health,
    trend,
    opportunities: { total: opportunities.length, byKind },
    memoryChunks,
    mission: mission
      ? {
          goal: mission.goal,
          status: mission.status,
          progress: progressOf(mission),
          steps: mission.steps.map((s) => ({ id: s.id, title: s.title, status: s.status })),
        }
      : null,
    conventions: {
      indent: conventions.indent,
      quotes: conventions.quotes,
      semicolons: conventions.semicolons,
      testFramework: conventions.testFramework,
    },
    decisions: {
      count: decisions.length,
      recent: decisions
        .slice(-10)
        .reverse()
        .map((d) => ({ summary: d.summary, commit: d.commit })),
    },
    reports,
  };
}
