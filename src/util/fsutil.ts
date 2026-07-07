import { promises as fs } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import fg from "fast-glob";
import ignore, { type Ignore } from "ignore";

/** SHA-256 of a string, hex-encoded. Used for content-hash based incremental indexing. */
export function sha256(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

/** Map a file extension to a coarse language label. */
export function languageOf(file: string): string {
  const ext = path.extname(file).toLowerCase();
  const map: Record<string, string> = {
    ".ts": "ts",
    ".tsx": "ts",
    ".js": "js",
    ".jsx": "js",
    ".mjs": "js",
    ".cjs": "js",
    ".py": "py",
    ".go": "go",
    ".rs": "rust",
    ".java": "java",
    ".rb": "ruby",
    ".php": "php",
    ".cs": "csharp",
    ".md": "md",
    ".json": "json",
    ".yml": "yaml",
    ".yaml": "yaml",
    ".css": "css",
    ".html": "html",
  };
  return map[ext] ?? "other";
}

/** Common binary / vendored / generated paths we never want to analyse. */
const HARD_EXCLUDES = [
  "**/node_modules/**",
  "**/.git/**",
  "**/.orgit/**",
  "**/dist/**",
  "**/build/**",
  "**/out/**",
  "**/.next/**",
  "**/coverage/**",
  "**/vendor/**",
  // Generated / lockfiles.
  "**/*.min.js",
  "**/*.min.css",
  "**/*.map",
  "**/*.snap",
  "**/*.lock",
  "**/package-lock.json",
  "**/pnpm-lock.yaml",
  // Images / fonts / media.
  "**/*.png",
  "**/*.jpg",
  "**/*.jpeg",
  "**/*.gif",
  "**/*.svg",
  "**/*.ico",
  "**/*.webp",
  "**/*.bmp",
  "**/*.woff*",
  "**/*.ttf",
  "**/*.otf",
  "**/*.eot",
  "**/*.mp3",
  "**/*.mp4",
  "**/*.mov",
  "**/*.webm",
  // Archives / binaries / data blobs.
  "**/*.pdf",
  "**/*.zip",
  "**/*.gz",
  "**/*.tgz",
  "**/*.tar",
  "**/*.7z",
  "**/*.rar",
  "**/*.wasm",
  "**/*.node",
  "**/*.exe",
  "**/*.dll",
  "**/*.so",
  "**/*.dylib",
  "**/*.class",
  "**/*.jar",
  "**/*.bin",
  "**/*.db",
  "**/*.sqlite",
  "**/*.parquet",
];

/**
 * Files larger than this are almost always generated data or vendored blobs, not source.
 * Reading them wastes memory and pollutes the mental model, so we skip them.
 */
const MAX_TEXT_BYTES = 1_500_000;

/** Load the repo's .gitignore into an `ignore` matcher (best-effort). */
async function loadGitignore(root: string): Promise<Ignore> {
  const ig = ignore();
  try {
    const content = await fs.readFile(path.join(root, ".gitignore"), "utf8");
    ig.add(content);
  } catch {
    /* no .gitignore — fine */
  }
  return ig;
}

/**
 * Walk the repository, honouring .gitignore and a hard exclude list, plus any
 * user-provided extra excludes. Returns repo-relative POSIX paths, sorted.
 */
export async function walkRepo(root: string, extraExcludes: string[] = []): Promise<string[]> {
  const entries = await fg("**/*", {
    cwd: root,
    dot: false,
    onlyFiles: true,
    followSymbolicLinks: false,
    ignore: [...HARD_EXCLUDES, ...extraExcludes],
  });

  const ig = await loadGitignore(root);
  const kept = entries.filter((rel) => !ig.ignores(rel));
  return kept.sort();
}

/**
 * Read a repo file as text, or return `null` when it should be skipped: missing,
 * not a regular file, larger than {@link MAX_TEXT_BYTES}, or binary (a NUL byte in the
 * first 8 KB). Callers already treat `null` as "skip this file", so oversized/binary
 * content never reaches memory, the mental model, or the embedder.
 */
export async function readFileSafe(root: string, rel: string): Promise<string | null> {
  try {
    const abs = path.join(root, rel);
    const stat = await fs.stat(abs);
    if (!stat.isFile() || stat.size > MAX_TEXT_BYTES) return null;
    const buf = await fs.readFile(abs);
    if (buf.subarray(0, 8192).includes(0)) return null; // binary sniff
    return buf.toString("utf8");
  } catch {
    return null;
  }
}

export async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.stat(p);
    return true;
  } catch {
    return false;
  }
}
