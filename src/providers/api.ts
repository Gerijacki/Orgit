import Anthropic from "@anthropic-ai/sdk";
import type { ClaudeProvider, CompleteOptions } from "./types.js";
import { DEFAULT_MODEL } from "./models.js";

/**
 * Uses the Anthropic API via the official SDK. Requires ANTHROPIC_API_KEY (or an
 * OAuth token). Defaults to Claude Opus 4.8 with adaptive thinking, and caches the
 * stable system prefix to reduce cost across the many calls a refactor cycle makes.
 */
export class ApiProvider implements ClaudeProvider {
  readonly kind = "api" as const;
  private readonly client: Anthropic;

  constructor(private readonly model: string = DEFAULT_MODEL) {
    this.client = new Anthropic();
  }

  describe(): string {
    return `Anthropic API · model=${this.model}`;
  }

  async healthCheck(): Promise<{ ok: boolean; detail: string }> {
    try {
      // Cheapest meaningful probe: retrieve model metadata.
      const m = await this.client.models.retrieve(this.model);
      return { ok: true, detail: `${m.display_name} reachable` };
    } catch (err) {
      return { ok: false, detail: (err as Error).message };
    }
  }

  async complete(opts: CompleteOptions): Promise<string> {
    const maxTokens = opts.maxTokens ?? 16_000;
    // Two system blocks: the large, run-stable context first (cached so it is billed
    // once across the many calls a cycle makes), then the per-call instruction block.
    const system: Anthropic.TextBlockParam[] = [];
    if (opts.cacheableContext) {
      system.push({
        type: "text",
        text: opts.cacheableContext,
        cache_control: { type: "ephemeral" },
      });
    }
    if (opts.system) {
      system.push({ type: "text", text: opts.system });
    }
    const stream = this.client.messages.stream({
      model: this.model,
      max_tokens: maxTokens,
      thinking: { type: "adaptive" },
      ...(system.length > 0 ? { system } : {}),
      messages: [{ role: "user", content: opts.prompt }],
    });

    const message = await stream.finalMessage();
    return message.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");
  }
}
