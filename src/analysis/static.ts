import type { MentalModel, Opportunity } from "../core/types.js";
import { readFileSafe } from "../util/fsutil.js";

/**
 * Deterministic, LLM-free opportunity detectors. Running these in plain code is a
 * deliberate token-saving move: the model is reserved for judgement and planning,
 * not for spotting things a scanner can find for free.
 */

const LARGE_FILE_LINES = 400;
const LONG_FUNCTION_LINES = 60;

export async function runStaticAnalyzers(model: MentalModel): Promise<Opportunity[]> {
  const opportunities: Opportunity[] = [];
  let counter = 0;
  const nextId = (kind: string) => `static-${kind}-${counter++}`;

  for (const file of model.files) {
    // Large-file detector — cheap, from the mental model alone.
    if (file.lines > LARGE_FILE_LINES && isCodeLang(file.language)) {
      opportunities.push({
        id: nextId("large-file"),
        kind: "large-file",
        files: [file.path],
        summary: `${file.path} is ${file.lines} lines — a candidate for splitting into smaller modules.`,
        confidence: 0.7,
        source: "static",
        evidence: { lines: file.lines },
      });
    }
  }

  // Long-function and missing-docs detectors need file contents.
  for (const file of model.files) {
    if (!isCodeLang(file.language)) continue;
    const content = await readFileSafe(model.root, file.path);
    if (content === null) continue;

    for (const fn of findLongFunctions(content, file.language)) {
      opportunities.push({
        id: nextId("long-function"),
        kind: "long-function",
        files: [file.path],
        line: fn.line,
        summary: `Function \`${fn.name}\` in ${file.path} spans ~${fn.length} lines — consider extracting helpers.`,
        confidence: 0.6,
        source: "static",
        evidence: { length: fn.length, name: fn.name },
      });
    }
  }

  return opportunities;
}

/** Reserved words that look like `NAME(...) {` but are control flow, not functions. */
const CONTROL_KEYWORDS = new Set([
  "if",
  "for",
  "while",
  "switch",
  "catch",
  "do",
  "else",
  "with",
  "return",
  "await",
]);

function isCodeLang(lang: string): boolean {
  return ["ts", "js", "py", "go", "rust", "java", "ruby", "php", "csharp"].includes(lang);
}

interface FnHit {
  name: string;
  line: number;
  length: number;
}

/**
 * Heuristic long-function finder. For brace languages it matches `{`/`}` depth from
 * a function header; for Python it uses indentation. Intentionally approximate — a
 * static hint, later confirmed by the LLM judgement pass.
 */
export function findLongFunctions(content: string, language: string): FnHit[] {
  const lines = content.split(/\r?\n/);
  const hits: FnHit[] = [];

  if (language === "py") {
    for (let i = 0; i < lines.length; i++) {
      const m = /^(\s*)def\s+([A-Za-z_]\w*)/.exec(lines[i]!);
      if (!m) continue;
      const indent = m[1]!.length;
      let end = i + 1;
      while (end < lines.length) {
        const l = lines[end]!;
        if (l.trim() !== "" && leadingSpaces(l) <= indent) break;
        end++;
      }
      const length = end - i;
      if (length > LONG_FUNCTION_LINES) hits.push({ name: m[2]!, line: i + 1, length });
    }
    return hits;
  }

  // Brace languages (ts/js/go/rust/java/…).
  const headerRe =
    /(?:function\s+([A-Za-z_$][\w$]*)|([A-Za-z_$][\w$]*)\s*(?:=\s*(?:async\s*)?\(|\([^)]*\)\s*(?::[^={]+)?=>|\([^)]*\)\s*\{))/;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (!line.includes("{")) continue;
    const m = headerRe.exec(line);
    if (!m) continue;
    const name = m[1] ?? m[2] ?? "anonymous";
    // The `NAME(...) {` branch also matches control-flow blocks (`if (…) {`,
    // `for (…) {`). Those are not functions — skip reserved keywords.
    if (CONTROL_KEYWORDS.has(name)) continue;
    // Walk brace depth from the first `{` on this line, ignoring braces that live
    // inside strings and comments (otherwise a `}` in a string or comment closes the
    // function early and the reported length is nonsense).
    let depth = 0;
    let started = false;
    let end = i;
    let inBlockComment = false;
    outer: for (let j = i; j < lines.length; j++) {
      const stripped = stripNonCode(lines[j]!, inBlockComment);
      inBlockComment = stripped.inBlockComment;
      for (const ch of stripped.code) {
        if (ch === "{") {
          depth++;
          started = true;
        } else if (ch === "}") {
          depth--;
          if (started && depth === 0) {
            end = j;
            break outer;
          }
        }
      }
    }
    const length = end - i + 1;
    if (started && length > LONG_FUNCTION_LINES) hits.push({ name, line: i + 1, length });
  }
  return hits;
}

function leadingSpaces(s: string): number {
  const m = /^(\s*)/.exec(s);
  return m ? m[1]!.length : 0;
}

/**
 * Return a copy of `line` with the contents of string literals (`'`, `"`, `` ` ``),
 * line comments (`//…`) and block comments (`/* … *\/`) removed, so brace counting
 * only sees structural braces. `inBlockComment` carries block-comment state across
 * lines. Regex literals are left as-is (rare enough to accept as approximation).
 */
export function stripNonCode(
  line: string,
  inBlockComment: boolean,
): { code: string; inBlockComment: boolean } {
  let code = "";
  let quote: string | null = null;
  let i = 0;
  while (i < line.length) {
    const ch = line[i]!;
    const next = line[i + 1];
    if (inBlockComment) {
      if (ch === "*" && next === "/") {
        inBlockComment = false;
        i += 2;
      } else {
        i++;
      }
      continue;
    }
    if (quote) {
      if (ch === "\\") {
        i += 2; // skip the escaped character
        continue;
      }
      if (ch === quote) quote = null;
      i++;
      continue;
    }
    if (ch === "/" && next === "/") break; // line comment: nothing structural after it
    if (ch === "/" && next === "*") {
      inBlockComment = true;
      i += 2;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      quote = ch;
      i++;
      continue;
    }
    code += ch;
    i++;
  }
  return { code, inBlockComment };
}
