import type { MentalModel, Opportunity } from "../core/types.js";

/**
 * A single 0–100 health score for the repository, derived deterministically from the
 * mental model and detected opportunities. It gives users (and continuous mode) a
 * concrete number to watch trend downward on debt / upward on health over time — the
 * motivating "watch your technical debt shrink" signal.
 */
export interface Health {
  score: number;
  grade: "A" | "B" | "C" | "D" | "F";
  metrics: {
    files: number;
    lines: number;
    avgFileLines: number;
    largeFiles: number;
    longFunctions: number;
    duplication: number;
    otherIssues: number;
    docRatio: number;
  };
}

const CODE_LANGS = ["ts", "js", "py", "go", "rust", "java", "ruby", "php", "csharp"];

export function computeHealth(model: MentalModel, opportunities: Opportunity[]): Health {
  const count = (k: string) => opportunities.filter((o) => o.kind === k).length;
  const largeFiles = count("large-file");
  const longFunctions = count("long-function");
  const duplication = count("duplication");
  const otherIssues = opportunities.length - largeFiles - longFunctions - duplication;

  const codeFiles = model.files.filter((f) => CODE_LANGS.includes(f.language));
  const docFiles = model.files.filter((f) => f.language === "md").length;
  const avgFileLines = codeFiles.length
    ? Math.round(codeFiles.reduce((s, f) => s + f.lines, 0) / codeFiles.length)
    : 0;
  const docRatio = codeFiles.length ? Number((docFiles / codeFiles.length).toFixed(2)) : 0;

  // Penalties (capped so one dimension can't dominate).
  let penalty = 0;
  penalty += Math.min(15, largeFiles * 3);
  penalty += Math.min(20, longFunctions * 2);
  penalty += Math.min(25, duplication * 4);
  penalty += Math.min(10, otherIssues * 1);
  if (avgFileLines > 250) penalty += Math.min(10, Math.floor((avgFileLines - 250) / 50) * 2);
  if (docRatio < 0.02 && codeFiles.length > 5) penalty += 5;

  const score = Math.max(0, Math.min(100, Math.round(100 - penalty)));
  return {
    score,
    grade: gradeOf(score),
    metrics: {
      files: model.totals.files,
      lines: model.totals.lines,
      avgFileLines,
      largeFiles,
      longFunctions,
      duplication,
      otherIssues,
      docRatio,
    },
  };
}

function gradeOf(score: number): Health["grade"] {
  if (score >= 90) return "A";
  if (score >= 80) return "B";
  if (score >= 70) return "C";
  if (score >= 60) return "D";
  return "F";
}
