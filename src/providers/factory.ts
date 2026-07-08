import { z } from "zod";
import type { OrgitConfig } from "../config/config.js";
import type { ClaudeProvider } from "./types.js";
import { extractJson } from "./types.js";
import { CliProvider } from "./cli.js";
import { ApiProvider } from "./api.js";
import { detectBackends } from "./detect.js";
import { resolveModel } from "./models.js";

/**
 * Choose a backend. `ORGIT_PROVIDER` env overrides config. In `auto` mode we prefer
 * the subscription CLI (no per-token cost) and fall back to the API only if a key
 * is present. Throws a clear, actionable error when neither is available.
 */
export async function createProvider(config: OrgitConfig): Promise<ClaudeProvider> {
  const requested = (process.env.ORGIT_PROVIDER as OrgitConfig["provider"]) ?? config.provider;
  const backends = await detectBackends();

  // Per-run `--model` (via ORGIT_MODEL) overrides config; short aliases are expanded.
  const model = resolveModel(process.env.ORGIT_MODEL ?? config.model);

  const wantCli = requested === "cli" || requested === "auto";
  const wantApi = requested === "api" || requested === "auto";

  if (wantCli && backends.cli.available) return new CliProvider(model);
  if (wantApi && backends.api.available) return new ApiProvider(model);

  // Explicit request that could not be satisfied.
  if (requested === "cli") {
    throw new Error(
      "Provider 'cli' requested but the `claude` CLI was not found on PATH. Install Claude Code or set ORGIT_PROVIDER=api with an API key.",
    );
  }
  if (requested === "api") {
    throw new Error(
      "Provider 'api' requested but no ANTHROPIC_API_KEY was found. Export a key or set ORGIT_PROVIDER=cli.",
    );
  }
  throw new Error(
    "No Claude backend available. Install the `claude` CLI (subscription) or set ANTHROPIC_API_KEY (API).",
  );
}

/**
 * Ask the model for JSON matching a schema and parse it defensively. Works for both
 * backends (neither guarantees strict output through this seam, so we extract and
 * validate). On malformed output it retries **once with a short repair prompt** — the
 * bad output plus the parse error — instead of re-sending the whole (possibly large)
 * original prompt, roughly halving the cost of a retry.
 */
export async function completeJson<S extends z.ZodTypeAny>(
  provider: ClaudeProvider,
  schema: S,
  opts: { system?: string; cacheableContext?: string; prompt: string; maxTokens?: number },
): Promise<z.infer<S>> {
  const jsonSystem =
    (opts.system ? opts.system + "\n\n" : "") +
    "Respond with ONLY valid JSON matching the requested shape. No prose, no code fences.";

  let lastError = "";
  let lastRaw = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    const prompt =
      attempt === 0
        ? opts.prompt
        : `Your previous response was not valid JSON: ${lastError}\n\n` +
          `Here is what you returned:\n${lastRaw}\n\n` +
          "Return ONLY the corrected JSON — no prose, no code fences.";
    const raw = await provider.complete({
      system: jsonSystem,
      // The stable prefix is only worth sending on the first attempt; the repair turn
      // is self-contained and cheap.
      ...(attempt === 0 ? { cacheableContext: opts.cacheableContext } : {}),
      prompt,
      maxTokens: opts.maxTokens,
    });
    const jsonText = extractJson(raw) ?? raw;
    try {
      return schema.parse(JSON.parse(jsonText));
    } catch (err) {
      lastError = (err as Error).message;
      lastRaw = raw.slice(0, 4000);
      if (attempt === 1) {
        throw new Error(`Model did not return valid JSON: ${lastError}`, { cause: err });
      }
    }
  }
  // Unreachable, but satisfies the type checker.
  throw new Error("completeJson: exhausted retries");
}
