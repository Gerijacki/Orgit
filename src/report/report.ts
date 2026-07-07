import { promises as fs } from "node:fs";
import path from "node:path";
import type { MentalModel, Plan, ScoredOpportunity, TaskResult } from "../core/types.js";
import type { Workspace } from "../config/workspace.js";
import type { Health } from "../analysis/health.js";

/**
 * Renders human-readable (Markdown) and machine-readable (JSON) reports for each
 * phase. Reports live under `.orgit/reports/` so a run is always auditable
 * (design spec → "Audited").
 */

export function renderAudit(
  model: MentalModel,
  scored: ScoredOpportunity[],
  health?: Health,
  trend?: string,
): string {
  const lines: string[] = [];
  lines.push(`# Orgit Audit Report`);
  lines.push(``);
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push(`Root: \`${model.root}\``);
  lines.push(``);
  if (health) {
    lines.push(`## Health`);
    lines.push(``);
    lines.push(`**${health.score}/100 (grade ${health.grade})**${trend ? ` — ${trend}` : ""}`);
    lines.push(``);
    lines.push(
      `- Large files: ${health.metrics.largeFiles} · Long functions: ${health.metrics.longFunctions} · Duplicate pairs: ${health.metrics.duplication} · Other: ${health.metrics.otherIssues}`,
    );
    lines.push(
      `- Avg file length: ${health.metrics.avgFileLines} lines · Doc ratio: ${health.metrics.docRatio}`,
    );
    lines.push(``);
  }
  lines.push(`## Overview`);
  lines.push(``);
  lines.push(`- Files: ${model.totals.files}`);
  lines.push(`- Lines: ${model.totals.lines}`);
  lines.push(`- Ecosystem: ${model.signals.ecosystem}`);
  lines.push(``);
  lines.push(`## Opportunities (${scored.length})`);
  lines.push(``);
  if (scored.length === 0) {
    lines.push(`No improvement opportunities detected. The project looks healthy.`);
  } else {
    lines.push(`| # | Kind | Benefit | Risk | Score | Where | Summary |`);
    lines.push(`|---|------|---------|------|-------|-------|---------|`);
    scored.forEach((o, i) => {
      const where = o.files.length === 1 ? o.files[0] : `${o.files.length} files`;
      lines.push(
        `| ${i + 1} | ${o.kind} | ${o.benefit} | ${o.risk} | ${o.score} | \`${where}\` | ${escapePipe(o.summary)} |`,
      );
    });
  }
  lines.push(``);
  return lines.join("\n");
}

export function renderPlan(plan: Plan): string {
  const lines: string[] = [];
  lines.push(`# Orgit Plan`);
  lines.push(``);
  lines.push(`Generated: ${plan.generatedAt}`);
  lines.push(`Tasks: ${plan.tasks.length}`);
  lines.push(``);
  plan.tasks.forEach((t) => {
    lines.push(`## ${t.id} — ${t.title}`);
    lines.push(``);
    lines.push(`- Files: ${t.files.map((f) => `\`${f}\``).join(", ")}`);
    lines.push(`- Benefit: ${t.benefit}/5 · Risk: ${t.risk}/5 · Score: ${t.score}`);
    lines.push(`- Why: ${t.rationale.why}`);
    lines.push(`- Improves: ${t.rationale.improves}`);
    lines.push(`- Impact: ${t.rationale.impact}`);
    lines.push(``);
  });
  return lines.join("\n");
}

export function renderResults(results: TaskResult[]): string {
  const lines: string[] = [];
  lines.push(`# Orgit Evolution Results`);
  lines.push(``);
  const committed = results.filter((r) => r.committed).length;
  const rolledBack = results.filter((r) => r.rolledBack).length;
  const skipped = results.filter((r) => !r.applied && !r.committed).length;
  lines.push(`- Committed: ${committed}`);
  lines.push(`- Rolled back: ${rolledBack}`);
  lines.push(`- Skipped: ${skipped}`);
  lines.push(``);
  results.forEach((r) => {
    const status = r.committed ? "✓ committed" : r.rolledBack ? "↺ rolled back" : "– skipped";
    lines.push(`## ${r.taskId} — ${status}`);
    if (r.commit) lines.push(`- Commit: \`${r.commit}\``);
    if (r.explanation) lines.push(`- ${r.explanation}`);
    if (r.error) lines.push(`- Error: ${r.error}`);
    lines.push(``);
  });
  return lines.join("\n");
}

/** Persist both a Markdown and JSON artefact under the workspace reports dir. */
export async function writeReport(
  ws: Workspace,
  name: string,
  markdown: string,
  data: unknown,
): Promise<{ md: string; json: string }> {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const md = path.join(ws.reportsDir, `${name}-${stamp}.md`);
  const json = path.join(ws.reportsDir, `${name}-${stamp}.json`);
  await fs.writeFile(md, markdown, "utf8");
  await fs.writeFile(json, JSON.stringify(data, null, 2), "utf8");
  // Also refresh a stable "latest" pointer for convenience.
  await fs.writeFile(path.join(ws.reportsDir, `${name}-latest.md`), markdown, "utf8");
  return { md, json };
}

function escapePipe(s: string): string {
  return s.replace(/\|/g, "\\|").replace(/\n/g, " ");
}
