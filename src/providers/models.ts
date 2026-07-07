/**
 * Single source of truth for the Claude model id. The default lives here (not scattered
 * across config + the API provider), and a small alias table lets users pass short names
 * (`opus`, `sonnet`, `haiku`, `fable`) on the command line instead of full ids.
 */
export const DEFAULT_MODEL = "claude-opus-4-8";

/** Friendly short names → full model ids. Unknown names pass through unchanged. */
export const MODEL_ALIASES: Record<string, string> = {
  opus: "claude-opus-4-8",
  "opus-4.8": "claude-opus-4-8",
  sonnet: "claude-sonnet-5",
  haiku: "claude-haiku-4-5-20251001",
  fable: "claude-fable-5",
};

/**
 * Resolve a user-supplied model name to a concrete id. Applies the alias table
 * (case-insensitive); any other value is returned verbatim so new/experimental model
 * ids keep working without a code change. Empty/undefined falls back to the default.
 */
export function resolveModel(name?: string): string {
  if (!name) return DEFAULT_MODEL;
  const key = name.trim().toLowerCase();
  return MODEL_ALIASES[key] ?? name.trim();
}
