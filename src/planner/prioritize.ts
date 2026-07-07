import type { Opportunity, OpportunityKind, ScoredOpportunity } from "../core/types.js";

/**
 * Prioritisation: convert raw opportunities into ranked ones by benefit/risk.
 *
 * Orgit's principle (design spec → "Minimum risk") is to prefer high benefit at
 * low risk first — dead-code removal and renames before large migrations. The base
 * table encodes that ordering; confidence nudges the final score.
 */
const BASELINE: Record<OpportunityKind, { benefit: number; risk: number }> = {
  "dead-code": { benefit: 4, risk: 1 },
  duplication: { benefit: 4, risk: 2 },
  "poor-naming": { benefit: 3, risk: 1 },
  "missing-docs": { benefit: 2, risk: 1 },
  "long-function": { benefit: 3, risk: 2 },
  "large-file": { benefit: 3, risk: 3 },
  "high-complexity": { benefit: 4, risk: 3 },
  "mixed-responsibilities": { benefit: 4, risk: 3 },
  "inconsistent-structure": { benefit: 3, risk: 3 },
  "unnecessary-dependency": { benefit: 3, risk: 2 },
  other: { benefit: 2, risk: 3 },
};

export function prioritize(opportunities: Opportunity[]): ScoredOpportunity[] {
  return opportunities
    .map((op) => {
      const base = BASELINE[op.kind];
      // Confidence scales benefit; multi-file changes carry slightly more risk.
      const benefit = clamp1to5(base.benefit * (0.5 + op.confidence / 2));
      const risk = clamp1to5(base.risk + (op.files.length > 2 ? 1 : 0));
      const score = Number((benefit / risk).toFixed(3));
      return { ...op, benefit, risk, score };
    })
    .sort((a, b) => b.score - a.score);
}

function clamp1to5(n: number): number {
  return Math.max(1, Math.min(5, Math.round(n)));
}
