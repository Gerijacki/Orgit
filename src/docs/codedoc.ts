import { promises as fs } from "node:fs";
import path from "node:path";
import type { ClaudeProvider } from "../providers/types.js";
import type { Workspace } from "../config/workspace.js";
import type { DocsLevel } from "../config/config.js";
import { readFileSafe } from "../util/fsutil.js";

/** Doc levels that actually generate output (everything except `none`). */
export type ActiveDocsLevel = Exclude<DocsLevel, "none">;

/**
 * Documentation-during-refactor. When enabled (`evolve --docs`), Orgit documents the
 * code it just changed: for each committed task it asks Claude to describe the new code
 * and writes Markdown — either into the workspace (`.orgit/reports/docs/`, git-ignored)
 * or, with `--docs-commit`, into the repo's docs dir as its own commit.
 */
export interface ChangeDocEntry {
  taskId: string;
  title: string;
  files: string[];
  markdown: string;
}

const DOC_COMMON = `Output Markdown only — do not wrap the whole document in a code fence, and do
not invent behaviour that isn't in the code.`;

/**
 * Per-level documentation style + output budget. Higher levels produce more thorough docs
 * and cost more tokens, so the level is a direct cost/verbosity control for the user.
 */
export const DOC_LEVELS: Record<ActiveDocsLevel, { system: string; maxTokens: number }> = {
  minimal: {
    system: `You write a single short paragraph documenting changed code: what it does now (after
a refactoring) in 2–3 sentences. No headings, no lists. ${DOC_COMMON}`,
    maxTokens: 500,
  },
  standard: {
    system: `You write concise, accurate developer documentation for changed code.
Describe what the code does now (after a refactoring), its key exports/functions, and how to
use it. Prefer short paragraphs and bullet lists. ${DOC_COMMON}`,
    maxTokens: 2000,
  },
  detailed: {
    system: `You write thorough developer documentation for changed code. Include: an overview of
what the code does now (after a refactoring); each key export/function with its parameters and
return value; at least one short usage example in a fenced code block; and a brief rationale for
the change. Use clear headings and bullet lists. ${DOC_COMMON}`,
    maxTokens: 4000,
  },
};

/** Ask Claude to document the (post-change) contents of a task's files at the given level. */
export async function generateChangeDoc(
  provider: ClaudeProvider,
  title: string,
  files: Array<{ path: string; content: string }>,
  level: ActiveDocsLevel = "standard",
): Promise<string> {
  const { system, maxTokens } = DOC_LEVELS[level];
  const blocks = files.map((f) => `=== ${f.path} ===\n${f.content}`).join("\n\n");
  const answer = await provider.complete({
    system,
    prompt: `Refactoring task: "${title}".\nDocument the current code below.\n\n${blocks}`,
    maxTokens,
  });
  return answer.trim();
}

/**
 * Build a documentation entry for a committed task by reading the changed files' current
 * (post-commit) contents and generating a doc for them. Returns null if nothing to doc.
 */
export async function buildChangeDoc(
  provider: ClaudeProvider,
  root: string,
  taskId: string,
  title: string,
  changedFiles: string[],
  level: ActiveDocsLevel = "standard",
): Promise<ChangeDocEntry | null> {
  const files: Array<{ path: string; content: string }> = [];
  for (const rel of changedFiles) {
    const content = await readFileSafe(root, rel);
    if (content !== null) files.push({ path: rel, content });
  }
  if (files.length === 0) return null;
  const markdown = await generateChangeDoc(provider, title, files, level);
  return { taskId, title, files: changedFiles, markdown };
}

/** Write documentation entries plus an index. Returns the base directory and file paths. */
export async function writeChangeDocs(
  root: string,
  ws: Workspace,
  entries: ChangeDocEntry[],
  opts: { toRepo: boolean; dir: string },
): Promise<{ baseDir: string; files: string[] }> {
  const baseDir = opts.toRepo ? path.join(root, opts.dir) : path.join(ws.reportsDir, "docs");
  await fs.mkdir(baseDir, { recursive: true });

  const written: string[] = [];
  for (const entry of entries) {
    const file = path.join(baseDir, `${entry.taskId}.md`);
    const header = `# ${entry.title}\n\n_Files: ${entry.files.map((f) => `\`${f}\``).join(", ")}_\n\n`;
    await fs.writeFile(file, `${header}${entry.markdown}\n`, "utf8");
    written.push(file);
  }

  const index =
    `# Generated documentation\n\n_Produced by Orgit during evolution._\n\n` +
    entries.map((e) => `- [${e.title}](${e.taskId}.md) — ${e.files.join(", ")}`).join("\n") +
    "\n";
  const indexPath = path.join(baseDir, "README.md");
  await fs.writeFile(indexPath, index, "utf8");
  written.push(indexPath);

  return { baseDir, files: written };
}
