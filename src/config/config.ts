import { promises as fs } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { DEFAULT_MODEL } from "../providers/models.js";

/**
 * Orgit configuration. Resolution order (first wins per field):
 *   1. CLI flags / env vars (applied by the caller)
 *   2. orgit.config.json in the target repo root
 *   3. built-in defaults
 *
 * The config is intentionally small — Orgit should work with zero configuration.
 */

export const ConfigSchema = z.object({
  /** Which Claude backend to use. `auto` = CLI if available, else API. */
  provider: z.enum(["auto", "cli", "api"]).default("auto"),
  /** Claude model id (or a short alias like `opus`/`sonnet`/`haiku`). Used by both backends. */
  model: z.string().default(DEFAULT_MODEL),
  /** Local embedding model name for fastembed. */
  embeddingModel: z.string().default("BAAI/bge-small-en-v1.5"),
  /** Glob patterns to exclude from analysis, on top of .gitignore. */
  exclude: z.array(z.string()).default([]),
  /** Max lines per code chunk stored in memory. */
  chunkLines: z.number().int().positive().default(120),
  /** Overlap in lines between consecutive chunks. */
  chunkOverlap: z.number().int().nonnegative().default(15),
  /** Cap on tasks generated per plan (keeps changes small and reviewable). */
  maxTasksPerPlan: z.number().int().positive().default(20),
  /** Cosine-similarity threshold for the embedding-based duplication detector. */
  duplicationThreshold: z.number().min(0.5).max(1).default(0.92),
  /** Skip semantic duplication scanning above this many chunks (keeps large repos fast). */
  semanticMaxChunks: z.number().int().positive().default(2500),
  /** How many task edits to generate in parallel during `evolve`. */
  concurrency: z.number().int().positive().max(16).default(4),
  /** Repo-relative directory for committed generated docs (`evolve --docs-commit`). */
  docsDir: z.string().default("docs/orgit"),
  /** How much documentation `evolve --docs` generates (also scales its token cost). */
  docsLevel: z.enum(["none", "minimal", "standard", "detailed"]).default("standard"),
});

/** Documentation verbosity for the doc-during-refactor feature. */
export type DocsLevel = OrgitConfig["docsLevel"];

export type OrgitConfig = z.infer<typeof ConfigSchema>;

export const DEFAULT_CONFIG: OrgitConfig = ConfigSchema.parse({});

const CONFIG_FILENAMES = ["orgit.config.json", ".orgitrc.json"];

/** Load and validate config from the target repo root, merging over defaults. */
export async function loadConfig(root: string): Promise<OrgitConfig> {
  for (const name of CONFIG_FILENAMES) {
    const file = path.join(root, name);
    try {
      const raw = await fs.readFile(file, "utf8");
      const parsed = ConfigSchema.parse(JSON.parse(raw));
      return parsed;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw new Error(`Failed to load ${name}: ${(err as Error).message}`);
    }
  }
  return { ...DEFAULT_CONFIG };
}
