import type { MentalModel, Plan, ScoredOpportunity, Task } from "../core/types.js";
import type { OrgitConfig } from "../config/config.js";

/**
 * Planning phase: turn prioritised opportunities into a plan of small, independent,
 * reversible tasks — each one carrying the four-part justification Orgit requires
 * ("always explain": why / what improves / what problem / what impact).
 *
 * This is deterministic: one task per opportunity, ordered by score, capped by config.
 * The rationale is templated from the opportunity; richer LLM-authored rationales can
 * be layered on in the executor without changing the plan contract.
 */
export function buildPlan(
  model: MentalModel,
  scored: ScoredOpportunity[],
  config: OrgitConfig,
): Plan {
  const tasks: Task[] = scored.slice(0, config.maxTasksPerPlan).map((op, i) => ({
    id: `task-${String(i + 1).padStart(3, "0")}`,
    title: taskTitle(op),
    files: op.files,
    opportunityId: op.id,
    rationale: rationaleFor(op),
    benefit: op.benefit,
    risk: op.risk,
    score: op.score,
  }));

  return { generatedAt: new Date().toISOString(), root: model.root, tasks };
}

function taskTitle(op: ScoredOpportunity): string {
  const verbs: Record<string, string> = {
    "dead-code": "Remove dead code in",
    duplication: "De-duplicate logic across",
    "long-function": "Extract helpers from long function in",
    "large-file": "Split oversized module",
    "high-complexity": "Reduce complexity in",
    "mixed-responsibilities": "Separate responsibilities in",
    "poor-naming": "Improve naming in",
    "missing-docs": "Document",
    "inconsistent-structure": "Align structure of",
    "unnecessary-dependency": "Drop unnecessary dependency in",
    other: "Improve",
  };
  const verb = verbs[op.kind] ?? "Improve";
  const where = op.files.length === 1 ? op.files[0] : `${op.files.length} files`;
  return `${verb} ${where}`;
}

function rationaleFor(op: ScoredOpportunity): Task["rationale"] {
  return {
    why: op.summary,
    improves: improvementFor(op.kind),
    problem: op.summary,
    impact: `benefit ${op.benefit}/5, risk ${op.risk}/5 (score ${op.score}). Change is scoped to ${op.files.length} file(s) and is independently revertible.`,
  };
}

function improvementFor(kind: string): string {
  const map: Record<string, string> = {
    "dead-code": "maintainability and clarity by removing unused code",
    duplication: "maintainability by removing repeated logic",
    "long-function": "readability and testability via smaller functions",
    "large-file": "modularity and navigability",
    "high-complexity": "readability and reduced defect risk",
    "mixed-responsibilities": "cohesion and separation of concerns",
    "poor-naming": "readability and self-documentation",
    "missing-docs": "onboarding and comprehension",
    "inconsistent-structure": "consistency and predictability",
    "unnecessary-dependency": "supply-chain surface and install size",
    other: "overall quality",
  };
  return map[kind] ?? "overall quality";
}
