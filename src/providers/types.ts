import type { ProviderKind } from "../core/types.js";

export interface CompleteOptions {
  /** System prompt / role instructions. */
  system?: string;
  /**
   * Large, run-stable context (e.g. the mental-model summary, learned conventions,
   * cross-run decision memory) that is identical across many calls in a run. The API
   * provider marks it as a cached prefix so it is billed once, not on every call; the
   * CLI provider simply prepends it to the system prompt.
   */
  cacheableContext?: string;
  /** The user prompt. */
  prompt: string;
  /** Soft cap on output tokens (honoured by the API provider). */
  maxTokens?: number;
}

/**
 * The single seam between Orgit and Claude. Both the subscription CLI and the API
 * implement this, so every other layer is backend-agnostic (INSTRUCTIONS.md asks
 * for compatibility with Claude Code on the host *and* via API).
 */
export interface ClaudeProvider {
  readonly kind: ProviderKind;
  /** Human-readable description for `orgit doctor`. */
  describe(): string;
  /** Cheap liveness probe — does not consume meaningful tokens. */
  healthCheck(): Promise<{ ok: boolean; detail: string }>;
  /** Single-shot completion returning the model's text. */
  complete(opts: CompleteOptions): Promise<string>;
}

/** Extract the first balanced JSON object/array from a possibly chatty response. */
export function extractJson(text: string): string | null {
  const start = text.search(/[[{]/);
  if (start === -1) return null;
  const open = text[start];
  const close = open === "{" ? "}" : "]";
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (ch === "\\") {
      escape = true;
      continue;
    }
    if (ch === '"') inString = !inString;
    if (inString) continue;
    if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}
