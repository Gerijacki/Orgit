import { execa } from "execa";

/** Result of probing the host for available Claude backends. */
export interface BackendAvailability {
  cli: { available: boolean; version?: string };
  api: { available: boolean; source?: string };
}

/** Is the `claude` CLI on PATH? Returns its version if so. */
export async function detectClaudeCli(): Promise<{ available: boolean; version?: string }> {
  try {
    const { stdout } = await execa("claude", ["--version"], { timeout: 10_000 });
    return { available: true, version: stdout.trim() };
  } catch {
    return { available: false };
  }
}

/** Is an Anthropic API key available in the environment? */
export function detectApiKey(): { available: boolean; source?: string } {
  if (process.env.ANTHROPIC_API_KEY) return { available: true, source: "ANTHROPIC_API_KEY" };
  if (process.env.ANTHROPIC_AUTH_TOKEN) return { available: true, source: "ANTHROPIC_AUTH_TOKEN" };
  return { available: false };
}

export async function detectBackends(): Promise<BackendAvailability> {
  const [cli] = await Promise.all([detectClaudeCli()]);
  return { cli, api: detectApiKey() };
}
