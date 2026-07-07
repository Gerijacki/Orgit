/**
 * Shared domain types for Orgit's evolution cycle:
 *   Understand → Analyze → Detect → Prioritize → Plan → Execute → Validate / Review → Test → Document → Continue
 *
 * These types are the contract between the analysis, detection, planning, execution
 * and validation layers. Keeping them here avoids circular imports between modules.
 */

/** How Orgit talks to Claude. `cli` uses the host subscription; `api` uses an API key. */
export type ProviderKind = "cli" | "api";

/** The operating modes described in INSTRUCTIONS.md. */
export type Mode = "audit" | "plan" | "execute" | "auto" | "continuous";

/** A single file in the repository's mental model. */
export interface RepoFile {
  /** Repo-relative POSIX path (e.g. `src/util/git.ts`). */
  path: string;
  /** SHA-256 of the file contents — drives incremental re-indexing. */
  hash: string;
  /** Byte size on disk. */
  size: number;
  /** Line count. */
  lines: number;
  /** Detected language / file type (e.g. `ts`, `js`, `py`, `md`, `json`, `other`). */
  language: string;
}

/** A chunk of a file, the unit stored in the vector memory. */
export interface CodeChunk {
  /** Stable id: `${path}#${index}`. */
  id: string;
  path: string;
  index: number;
  startLine: number;
  endLine: number;
  content: string;
  /** SHA-256 of the owning file, so we can invalidate all chunks when the file changes. */
  fileHash: string;
  language: string;
}

/** The high-level understanding Orgit builds before touching anything. */
export interface MentalModel {
  root: string;
  generatedAt: string;
  files: RepoFile[];
  totals: {
    files: number;
    lines: number;
    bytes: number;
  };
  languages: Record<string, number>;
  /** Module → the files that belong to it (top-level dir grouping to start). */
  modules: Record<string, string[]>;
  /** Detected package manager / build system signals. */
  signals: RepoSignals;
}

/** Build/test/lint entry points and ecosystem detected from the repo. */
export interface RepoSignals {
  ecosystem: "node" | "python" | "unknown";
  packageManager?: "pnpm" | "yarn" | "npm";
  scripts: {
    build?: string;
    test?: string;
    lint?: string;
  };
  hasGit: boolean;
}

export type OpportunityKind =
  | "dead-code"
  | "duplication"
  | "long-function"
  | "large-file"
  | "high-complexity"
  | "mixed-responsibilities"
  | "poor-naming"
  | "missing-docs"
  | "inconsistent-structure"
  | "unnecessary-dependency"
  | "other";

/** A detected improvement opportunity — the raw output of the detection phase. */
export interface Opportunity {
  id: string;
  kind: OpportunityKind;
  /** Where it lives. May span multiple files (e.g. duplication). */
  files: string[];
  /** Human-readable summary of the problem. */
  summary: string;
  /** Optional anchor line in the primary file. */
  line?: number;
  /** 0..1 confidence the detector has that this is real. */
  confidence: number;
  /** Whether a deterministic tool found it (vs an LLM judgement). */
  source: "static" | "llm";
  /** Free-form evidence (metrics, snippets) for reporting and prioritisation. */
  evidence?: Record<string, unknown>;
}

/** An opportunity after prioritisation, carrying benefit/risk scoring. */
export interface ScoredOpportunity extends Opportunity {
  /** 1..5 — how much value fixing this delivers. */
  benefit: number;
  /** 1..5 — how risky the change is (higher = riskier). */
  risk: number;
  /** benefit / risk, used to rank. Higher is better. */
  score: number;
}

/** A single, small, independent, reversible task in the plan. */
export interface Task {
  id: string;
  title: string;
  /** Files this task is allowed to touch. */
  files: string[];
  /** The opportunity this task addresses. */
  opportunityId: string;
  /** Why: justification required by the "Always explain" principle. */
  rationale: {
    why: string;
    improves: string;
    problem: string;
    impact: string;
  };
  benefit: number;
  risk: number;
  score: number;
}

/** A full plan produced by the planning phase. */
export interface Plan {
  generatedAt: string;
  root: string;
  tasks: Task[];
}

/** Result of running the project's validation (build/test/lint). */
export interface ValidationResult {
  ok: boolean;
  steps: Array<{
    name: "build" | "test" | "lint";
    command: string;
    ok: boolean;
    skipped: boolean;
    output: string;
  }>;
}

/** Outcome of executing a single task. */
export interface TaskResult {
  taskId: string;
  applied: boolean;
  committed: boolean;
  rolledBack: boolean;
  commit?: string;
  validation?: ValidationResult;
  error?: string;
  explanation?: string;
  /** Files actually written by this task (used by the documentation generator). */
  changedFiles?: string[];
  /** Outcome of the tester agent's Test phase, if it ran for this task. */
  tests?: {
    added: number;
    passed: boolean;
    committed: boolean;
    note?: string;
  };
}
