import { z } from "zod";
import type { MentalModel, Opportunity, OpportunityKind } from "../core/types.js";
import type { OrgitConfig } from "../config/config.js";
import type { ClaudeProvider } from "../providers/types.js";
import { completeJson } from "../providers/factory.js";
import type { Retriever } from "../memory/retriever.js";
import { Retriever as R } from "../memory/retriever.js";
import type { MemoryStore } from "../memory/store.js";
import { detectSemanticDuplication } from "./semantic.js";
import { runStaticAnalyzers } from "../analysis/static.js";
import { summariseModel } from "../analysis/model.js";
import { log } from "../util/log.js";

export interface DetectContext {
  provider: ClaudeProvider;
  retriever: Retriever;
  store: MemoryStore;
  config: OrgitConfig;
  /** Rendered learned conventions, injected into the LLM judgement prompt. */
  conventions?: string;
  /** Rendered cross-run decision memory (what Orgit already did), added to the cached prefix. */
  decisions?: string;
}

const KINDS: OpportunityKind[] = [
  "dead-code",
  "duplication",
  "long-function",
  "large-file",
  "high-complexity",
  "mixed-responsibilities",
  "poor-naming",
  "missing-docs",
  "inconsistent-structure",
  "unnecessary-dependency",
  "other",
];

const LlmOpportunity = z.object({
  // Models occasionally return near-miss kinds (e.g. "missing-documentation");
  // coerce anything unrecognised to "other" rather than discarding the finding.
  kind: z.enum(KINDS as [OpportunityKind, ...OpportunityKind[]]).catch("other"),
  files: z.array(z.string()).min(1),
  summary: z.string(),
  line: z.number().int().positive().optional(),
  confidence: z.number().min(0).max(1).catch(0.5).default(0.5),
});

const LlmResult = z.object({ opportunities: z.array(LlmOpportunity).default([]) });

const DETECT_SYSTEM = `You are a senior software engineer performing a code audit for the Orgit repository evolution engine.
You do NOT modify code. You identify concrete, high-value improvement opportunities:
reduced duplication, better separation of responsibilities, dead code, poor naming,
missing documentation, inconsistent structure, and excessive complexity.
Only report opportunities you can justify from the provided context. Prefer a few
high-confidence findings over many speculative ones.`;

/**
 * Detection phase. Runs deterministic, token-free analyzers first — textual static
 * checks *and* embedding-based semantic duplication (reusing the vectors already in
 * memory) — then asks the LLM to add judgement-based opportunities using retrieved
 * context (not whole files). The LLM pass is best-effort: if it fails, the free
 * results stand.
 */
export async function detectOpportunities(
  model: MentalModel,
  ctx: DetectContext,
): Promise<Opportunity[]> {
  const staticOps = await runStaticAnalyzers(model);
  log.debug(`static analyzers found ${staticOps.length} opportunities`);

  let semanticOps: Opportunity[] = [];
  try {
    semanticOps = await detectSemanticDuplication(ctx.store, {
      threshold: ctx.config.duplicationThreshold,
      maxChunks: ctx.config.semanticMaxChunks,
    });
    if (semanticOps.length)
      log.debug(`semantic detector found ${semanticOps.length} duplicate pairs`);
  } catch (err) {
    log.debug(`semantic duplication skipped: ${(err as Error).message}`);
  }

  let llmOps: Opportunity[] = [];
  try {
    llmOps = await detectWithLlm(
      model,
      ctx.provider,
      ctx.retriever,
      ctx.conventions,
      ctx.decisions,
    );
    log.debug(`llm judgement added ${llmOps.length} opportunities`);
  } catch (err) {
    log.warn(`LLM detection skipped: ${(err as Error).message}`);
  }

  return dedupe([...staticOps, ...semanticOps, ...llmOps]);
}

async function detectWithLlm(
  model: MentalModel,
  provider: ClaudeProvider,
  retriever: Retriever,
  conventions?: string,
  decisions?: string,
): Promise<Opportunity[]> {
  const query =
    "duplicated logic, functions with mixed responsibilities, unclear naming, dead code, inconsistent structure";
  const hits = await retriever.retrieve(query, 12);
  const context = R.renderContext(hits);

  // Run-stable context (identical across detector/planner/executor calls) goes into the
  // cached prefix so it is billed once, not re-sent on every call.
  const conventionsBlock = conventions
    ? `\nProject conventions (respect these when judging naming/consistency):\n${conventions}\n`
    : "";
  const decisionsBlock = decisions ? `\n${decisions}\n` : "";
  const cacheableContext = `Repository summary:\n${summariseModel(model)}\n${conventionsBlock}${decisionsBlock}`;

  const prompt = `Relevant code (retrieved from memory — this is a focused subset, not the whole repo):
${context}

Return JSON: { "opportunities": [ { "kind", "files", "summary", "line?", "confidence" } ] }
Use only file paths that appear above. Keep summaries specific and actionable.`;

  const result = await completeJson(provider, LlmResult, {
    system: DETECT_SYSTEM,
    cacheableContext,
    prompt,
    maxTokens: 4000,
  });

  return result.opportunities.map((o, i) => ({
    id: `llm-${o.kind}-${i}`,
    kind: o.kind,
    files: o.files,
    summary: o.summary,
    line: o.line,
    confidence: o.confidence,
    source: "llm" as const,
  }));
}

/** Merge near-duplicate opportunities (same kind + overlapping files), keeping the most confident. */
export function dedupe(ops: Opportunity[]): Opportunity[] {
  const out: Opportunity[] = [];
  for (const op of ops) {
    const existing = out.find(
      (e) => e.kind === op.kind && e.files.some((f) => op.files.includes(f)),
    );
    if (!existing) {
      out.push(op);
    } else if (op.confidence > existing.confidence) {
      Object.assign(existing, op);
    }
  }
  return out;
}
