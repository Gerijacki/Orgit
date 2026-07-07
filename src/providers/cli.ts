import { execa } from "execa";
import type { ClaudeProvider, CompleteOptions } from "./types.js";

/**
 * Uses the host `claude` CLI in non-interactive print mode. This runs under the
 * user's Claude Code subscription, so there is no per-token API billing — the
 * primary reason Orgit defaults to this backend.
 */
export class CliProvider implements ClaudeProvider {
  readonly kind = "cli" as const;

  constructor(private readonly model?: string) {}

  describe(): string {
    return `Claude Code CLI (subscription)${this.model ? ` · model=${this.model}` : ""}`;
  }

  async healthCheck(): Promise<{ ok: boolean; detail: string }> {
    try {
      const { stdout } = await execa("claude", ["--version"], { timeout: 10_000 });
      return { ok: true, detail: stdout.trim() };
    } catch (err) {
      return { ok: false, detail: (err as Error).message };
    }
  }

  async complete(opts: CompleteOptions): Promise<string> {
    const args = ["-p", opts.prompt, "--output-format", "json"];
    if (this.model) args.push("--model", this.model);
    // The CLI has no prompt caching, so the stable context just joins the system prompt.
    const system = [opts.cacheableContext, opts.system].filter(Boolean).join("\n\n");
    if (system) args.push("--append-system-prompt", system);

    const { stdout } = await execa("claude", args, {
      timeout: 300_000,
      maxBuffer: 64 * 1024 * 1024,
    });

    return parseCliOutput(stdout);
  }
}

/**
 * The CLI's `--output-format json` returns an object like
 * `{ type, subtype, is_error, result, ... }` where `result` holds the reply (or, on
 * failure, the error text with `is_error: true`). Fall back to raw stdout if the
 * output is not JSON, so we never silently lose the model's reply.
 */
export function parseCliOutput(stdout: string): string {
  const trimmed = stdout.trim();
  let obj: { result?: unknown; error?: unknown; is_error?: unknown };
  try {
    obj = JSON.parse(trimmed);
  } catch {
    return trimmed; // plain-text output mode or non-JSON — use as-is
  }
  if (obj.is_error === true) {
    const detail = typeof obj.result === "string" ? obj.result : "unknown error";
    throw new Error(`claude CLI reported an error: ${detail}`);
  }
  if (typeof obj.result === "string") return obj.result;
  if (typeof obj.error === "string") throw new Error(obj.error);
  return trimmed;
}
