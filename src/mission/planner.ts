import { z } from "zod";
import type { MentalModel } from "../core/types.js";
import type { ClaudeProvider } from "../providers/types.js";
import { completeJson } from "../providers/factory.js";
import type { Retriever } from "../memory/retriever.js";
import { Retriever as R } from "../memory/retriever.js";
import { summariseModel } from "../analysis/model.js";
import type { Agent } from "../agents/agents.js";
import type { MissionStep } from "./mission.js";

const PLANNER_SYSTEM = `You are Orgit's planning agent. You take a large refactoring goal and break it into an
ordered sequence of SMALL, INDEPENDENT, REVERSIBLE steps — the way a meticulous senior
engineer would. Rules:
- Each step is a single, concrete, self-contained change that could be its own commit.
- Order matters: put foundational steps first. Use "dependsOn" to declare when a step
  needs an earlier one to be done first (by that step's 1-based number).
- List the exact repository files each step will touch (existing paths from the context,
  or new paths you will create). Never invent unrelated files.
- Prefer 3–12 steps. Do not bundle unrelated work into one step.
- Preserve behaviour; do not change functionality unless the goal explicitly requires it.`;

const RawStep = z.object({
  title: z.string(),
  description: z.string(),
  files: z.array(z.string()).default([]),
  dependsOn: z.array(z.number().int().positive()).default([]),
});
const PlanResult = z.object({ steps: z.array(RawStep).min(1) });

/** The planner agent: turns a goal into a persisted, ordered step plan grounded in the repo. */
export class PlannerAgent implements Agent {
  readonly role = "planner" as const;
  readonly name = "planner";

  constructor(
    private readonly provider: ClaudeProvider,
    private readonly retriever: Retriever,
  ) {}

  async decompose(
    model: MentalModel,
    goal: string,
    conventions?: string,
  ): Promise<Omit<MissionStep, "commits" | "status">[]> {
    const hits = await this.retriever.retrieve(goal, 14);
    const context = R.renderContext(hits);
    const conventionsBlock =
      conventions && conventions !== "No conventions learned yet."
        ? `\nProject conventions:\n${conventions}\n`
        : "";
    const cacheableContext = `Repository summary:\n${summariseModel(model)}\n${conventionsBlock}`;

    const prompt = `Goal: ${goal}

Relevant code (retrieved from memory — a focused subset, not the whole repo):
${context}

Return JSON: { "steps": [ { "title", "description", "files": [..], "dependsOn": [step numbers] } ] }
Steps must be ordered. Use real file paths that appear above (or new paths you will create).`;

    const result = await completeJson(this.provider, PlanResult, {
      system: PLANNER_SYSTEM,
      cacheableContext,
      prompt,
      maxTokens: 6000,
    });

    // Assign stable ids and map 1-based dependsOn indices to step ids.
    const ids = result.steps.map((_, i) => `step-${String(i + 1).padStart(3, "0")}`);
    return result.steps.map((s, i) => ({
      id: ids[i]!,
      title: s.title,
      description: s.description,
      files: s.files,
      dependsOn: s.dependsOn
        .filter((n) => n >= 1 && n <= result.steps.length && n - 1 !== i)
        .map((n) => ids[n - 1]!),
    }));
  }
}
