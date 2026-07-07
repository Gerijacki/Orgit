import path from "node:path";
import type { MentalModel, RepoFile, RepoSignals } from "../core/types.js";
import type { OrgitConfig } from "../config/config.js";
import { walkRepo, readFileSafe, sha256, languageOf, fileExists } from "../util/fsutil.js";

/**
 * Build the repository's "mental model" — the understanding Orgit forms *before*
 * touching anything (the "understanding before modification" principle). This is
 * pure, deterministic inspection: no LLM, no writes.
 */
export async function buildMentalModel(root: string, config: OrgitConfig): Promise<MentalModel> {
  const rels = await walkRepo(root, config.exclude);
  const files: RepoFile[] = [];
  const languages: Record<string, number> = {};
  const modules: Record<string, string[]> = {};
  let totalLines = 0;
  let totalBytes = 0;

  for (const rel of rels) {
    const content = await readFileSafe(root, rel);
    if (content === null) continue;
    const lines = content.length === 0 ? 0 : content.split(/\r?\n/).length;
    const language = languageOf(rel);
    const file: RepoFile = {
      path: rel,
      hash: sha256(content),
      size: Buffer.byteLength(content, "utf8"),
      lines,
      language,
    };
    files.push(file);
    languages[language] = (languages[language] ?? 0) + 1;
    totalLines += lines;
    totalBytes += file.size;

    const top = rel.includes("/") ? rel.split("/")[0]! : "(root)";
    (modules[top] ??= []).push(rel);
  }

  const signals = await detectSignals(root, files);

  return {
    root,
    generatedAt: new Date().toISOString(),
    files,
    totals: { files: files.length, lines: totalLines, bytes: totalBytes },
    languages,
    modules,
    signals,
  };
}

/**
 * Detect ecosystem and build/test/lint entry points from repo manifests.
 *
 * Manifests and lock files are checked directly on disk rather than via the mental
 * model, because the file walk excludes `.git/` and lock files (`*.lock`) — reading
 * them from `model.files` would miss git and yarn.
 */
export async function detectSignals(root: string, _files: RepoFile[]): Promise<RepoSignals> {
  const onDisk = (rel: string) => fileExists(path.join(root, rel));
  const hasGit = await onDisk(".git");

  if (await onDisk("package.json")) {
    const pkgRaw = await readFileSafe(root, "package.json");
    let scripts: Record<string, string> = {};
    try {
      scripts = (JSON.parse(pkgRaw ?? "{}").scripts as Record<string, string>) ?? {};
    } catch {
      /* malformed package.json — treat as no scripts */
    }
    const pm: RepoSignals["packageManager"] = (await onDisk("pnpm-lock.yaml"))
      ? "pnpm"
      : (await onDisk("yarn.lock"))
        ? "yarn"
        : "npm";
    return {
      ecosystem: "node",
      packageManager: pm,
      scripts: {
        build: scripts.build ? `${pm} run build` : undefined,
        test: scripts.test ? `${pm} test` : undefined,
        lint: scripts.lint ? `${pm} run lint` : undefined,
      },
      hasGit,
    };
  }

  if (
    (await onDisk("pyproject.toml")) ||
    (await onDisk("requirements.txt")) ||
    (await onDisk("setup.py"))
  ) {
    return { ecosystem: "python", scripts: {}, hasGit };
  }

  return { ecosystem: "unknown", scripts: {}, hasGit };
}

/** Summarise the mental model as a compact string for LLM prompts (token-thrifty). */
export function summariseModel(model: MentalModel): string {
  const langs = Object.entries(model.languages)
    .sort((a, b) => b[1] - a[1])
    .map(([l, n]) => `${l}:${n}`)
    .join(", ");
  const mods = Object.entries(model.modules)
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, 20)
    .map(([m, fs]) => `${m} (${fs.length})`)
    .join(", ");
  const rel = (p: string) => path.posix.normalize(p);
  const biggest = [...model.files]
    .sort((a, b) => b.lines - a.lines)
    .slice(0, 10)
    .map((f) => `${rel(f.path)} (${f.lines}L)`)
    .join(", ");

  return [
    `Root: ${model.root}`,
    `Files: ${model.totals.files}, Lines: ${model.totals.lines}`,
    `Ecosystem: ${model.signals.ecosystem}${
      model.signals.packageManager ? ` (${model.signals.packageManager})` : ""
    }`,
    `Languages: ${langs}`,
    `Top modules: ${mods}`,
    `Largest files: ${biggest}`,
  ].join("\n");
}
