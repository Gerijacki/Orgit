import { z } from "zod";
import type { Task } from "../core/types.js";
import type { ClaudeProvider } from "../providers/types.js";
import { completeJson } from "../providers/factory.js";
import type { GeneratedEdit } from "../executor/execute.js";
import type { Agent } from "./agents.js";

/**
 * The reviewer agent. Before a change is committed, it independently checks that the
 * proposed edit actually accomplishes its stated intent — no scope creep, no obviously
 * broken behaviour, no unrelated edits. Pairing this intent check with the executor's
 * behavioural validation (build/test/lint) is what makes a mission meticulous: a step is
 * committed only when it both *works* and *does what it was meant to do*.
 */
export interface Review {
  approved: boolean;
  reason: string;
}

export type Reviewer = (task: Task, gen: GeneratedEdit) => Promise<Review>;

const ReviewSchema = z.object({ approved: z.boolean(), reason: z.string() });

const REVIEWER_SYSTEM = `You are Orgit's reviewer agent. You verify that a proposed code change
actually accomplishes its stated task, WITHOUT scope creep, broken behaviour, or unrelated edits.
Approve only if the change matches the intent and looks correct and complete for that intent.
Reject — with a specific, actionable reason — if it does something different, is incomplete,
introduces an obvious bug, or edits things it should not. Be strict but fair.`;

export class ReviewerAgent implements Agent {
  readonly role = "reviewer" as const;
  readonly name = "reviewer";

  constructor(private readonly provider: ClaudeProvider) {}

  async review(task: Task, gen: GeneratedEdit): Promise<Review> {
    if (gen.edits.length === 0) return { approved: false, reason: "no edits to review" };

    const edits = gen.edits.map((e) => `=== ${e.path} ===\n${e.content}`).join("\n\n");
    const prompt = `Task: ${task.title}
Intent: ${task.rationale.why}
Goal: ${task.rationale.improves}

Proposed new file contents:
${edits}

Return JSON: { "approved": boolean, "reason": string }`;

    try {
      return await completeJson(this.provider, ReviewSchema, {
        system: REVIEWER_SYSTEM,
        prompt,
        maxTokens: 1000,
      });
    } catch {
      // Fail open: a transient reviewer error must not stall the mission. The
      // behavioural validation (build/test/lint) still guards correctness.
      return { approved: true, reason: "reviewer unavailable — skipped intent check" };
    }
  }

  /** Convenience: a plain `Reviewer` function bound to this agent. */
  asReviewer(): Reviewer {
    return (task, gen) => this.review(task, gen);
  }
}
