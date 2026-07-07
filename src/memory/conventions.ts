import { promises as fs } from "node:fs";
import type { MentalModel } from "../core/types.js";
import type { Workspace } from "../config/workspace.js";
import { readFileSafe } from "../util/fsutil.js";

/**
 * Learned project conventions — Orgit's "Aprendizaje del proyecto" (learning the
 * project). Conventions are derived deterministically from the code, persisted to
 * `.orgit/conventions.json`, and refined on every run. They are fed into the detection
 * and execution prompts so Orgit's changes respect the house style, and accumulated
 * `notes` let the engine remember decisions across sessions.
 */
export interface Conventions {
  indent: "space" | "tab" | "unknown";
  indentSize: number;
  quotes: "single" | "double" | "unknown";
  semicolons: boolean | "unknown";
  testFramework?: string;
  /** Free-form learnings accumulated across runs (deduplicated, capped). */
  notes: string[];
  updatedAt: string;
}

const EMPTY: Conventions = {
  indent: "unknown",
  indentSize: 2,
  quotes: "unknown",
  semicolons: "unknown",
  notes: [],
  updatedAt: new Date(0).toISOString(),
};

export async function loadConventions(ws: Workspace): Promise<Conventions> {
  try {
    const raw = await fs.readFile(ws.conventionsFile, "utf8");
    return { ...EMPTY, ...(JSON.parse(raw) as Partial<Conventions>) };
  } catch {
    return { ...EMPTY };
  }
}

export async function saveConventions(ws: Workspace, conv: Conventions): Promise<void> {
  await fs.writeFile(ws.conventionsFile, JSON.stringify(conv, null, 2), "utf8");
}

/**
 * Derive conventions from the current code and merge them with anything already
 * learned. Sampling a bounded number of code files keeps this cheap on large repos.
 */
export async function deriveConventions(
  model: MentalModel,
  previous: Conventions,
): Promise<Conventions> {
  const codeFiles = model.files
    .filter((f) => ["ts", "js", "py", "go", "rust", "java"].includes(f.language))
    .slice(0, 40);

  let tabIndent = 0;
  let spaceIndent = 0;
  const spaceSizes: Record<number, number> = {};
  let single = 0;
  let double = 0;
  let semiLines = 0;
  let braceLines = 0;

  for (const f of codeFiles) {
    const content = await readFileSafe(model.root, f.path);
    if (content === null) continue;
    for (const line of content.split(/\r?\n/)) {
      const indentMatch = /^([ \t]+)\S/.exec(line);
      if (indentMatch) {
        const ws = indentMatch[1]!;
        if (ws[0] === "\t") tabIndent++;
        else {
          spaceIndent++;
          const size = ws.length;
          if (size > 0 && size <= 8) spaceSizes[size] = (spaceSizes[size] ?? 0) + 1;
        }
      }
      single += (line.match(/'/g) ?? []).length;
      double += (line.match(/"/g) ?? []).length;
      const t = line.trim();
      if (t.endsWith("{") || t.endsWith("}") || t.endsWith(";")) braceLines++;
      if (t.endsWith(";")) semiLines++;
    }
  }

  const indent = tabIndent > spaceIndent ? "tab" : spaceIndent > 0 ? "space" : "unknown";
  const indentSize =
    indent === "space"
      ? Number(
          Object.entries(spaceSizes).sort((a, b) => b[1] - a[1])[0]?.[0] ?? previous.indentSize,
        )
      : previous.indentSize;
  const quotes = single > double ? "single" : double > 0 ? "double" : "unknown";
  const semicolons = braceLines === 0 ? "unknown" : semiLines / braceLines > 0.3;

  return {
    indent,
    indentSize,
    quotes,
    semicolons,
    testFramework: detectTestFramework(model) ?? previous.testFramework,
    notes: previous.notes.slice(0, 50),
    updatedAt: new Date().toISOString(),
  };
}

function detectTestFramework(model: MentalModel): string | undefined {
  if (model.files.some((f) => /vitest\.config\./.test(f.path))) return "vitest";
  if (model.files.some((f) => /jest\.config\./.test(f.path))) return "jest";
  if (model.signals.scripts.test?.includes("vitest")) return "vitest";
  if (model.signals.scripts.test?.includes("jest")) return "jest";
  if (model.signals.scripts.test?.includes("pytest")) return "pytest";
  return undefined;
}

/** Record a learning for future runs (deduplicated, newest first, capped). */
export function addNote(conv: Conventions, note: string): Conventions {
  const trimmed = note.trim();
  if (!trimmed || conv.notes.includes(trimmed)) return conv;
  return { ...conv, notes: [trimmed, ...conv.notes].slice(0, 50) };
}

/** Render conventions as a compact instruction block for LLM prompts. */
export function renderConventions(conv: Conventions): string {
  const parts: string[] = [];
  if (conv.indent !== "unknown")
    parts.push(`Indentation: ${conv.indent === "tab" ? "tabs" : `${conv.indentSize} spaces`}.`);
  if (conv.quotes !== "unknown") parts.push(`String quotes: ${conv.quotes}.`);
  if (conv.semicolons !== "unknown")
    parts.push(`Semicolons: ${conv.semicolons ? "required" : "omitted"}.`);
  if (conv.testFramework) parts.push(`Test framework: ${conv.testFramework}.`);
  if (conv.notes.length) parts.push(`Learned notes:\n- ${conv.notes.slice(0, 10).join("\n- ")}`);
  return parts.length ? parts.join("\n") : "No conventions learned yet.";
}
