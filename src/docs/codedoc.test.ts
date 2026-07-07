import { describe, it, expect, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { generateChangeDoc, buildChangeDoc, writeChangeDocs, DOC_LEVELS } from "./codedoc.js";
import type { ClaudeProvider, CompleteOptions } from "../providers/types.js";
import type { Workspace } from "../config/workspace.js";

class DocProvider implements ClaudeProvider {
  readonly kind = "cli" as const;
  public prompts: string[] = [];
  public calls: CompleteOptions[] = [];
  constructor(private readonly text: string) {}
  describe() {
    return "doc";
  }
  async healthCheck() {
    return { ok: true, detail: "doc" };
  }
  async complete(opts: CompleteOptions) {
    this.prompts.push(opts.prompt);
    this.calls.push(opts);
    return this.text;
  }
}

let dir: string | undefined;
afterEach(async () => {
  if (dir) await fs.rm(dir, { recursive: true, force: true });
  dir = undefined;
});

describe("generateChangeDoc", () => {
  it("sends the file contents to Claude and returns trimmed Markdown", async () => {
    const p = new DocProvider("  ## util.ts\n\nAdds two numbers.  ");
    const md = await generateChangeDoc(p, "Simplify util", [
      { path: "src/util.ts", content: "export const add = (a, b) => a + b;" },
    ]);
    expect(md).toBe("## util.ts\n\nAdds two numbers.");
    expect(p.prompts[0]).toContain("src/util.ts");
    expect(p.prompts[0]).toContain("Simplify util");
  });

  it("maps each doc level to its own system prompt and token budget", async () => {
    const files = [{ path: "src/util.ts", content: "export const add = (a, b) => a + b;" }];

    const min = new DocProvider("x");
    await generateChangeDoc(min, "t", files, "minimal");
    expect(min.calls[0]!.maxTokens).toBe(DOC_LEVELS.minimal.maxTokens);
    expect(min.calls[0]!.system).toContain("single short paragraph");

    const det = new DocProvider("x");
    await generateChangeDoc(det, "t", files, "detailed");
    expect(det.calls[0]!.maxTokens).toBe(DOC_LEVELS.detailed.maxTokens);
    expect(det.calls[0]!.system).toContain("usage example");

    // Higher levels get a bigger budget than lower ones.
    expect(DOC_LEVELS.detailed.maxTokens).toBeGreaterThan(DOC_LEVELS.minimal.maxTokens);
    expect(DOC_LEVELS.standard.maxTokens).toBeGreaterThan(DOC_LEVELS.minimal.maxTokens);
  });
});

describe("buildChangeDoc", () => {
  it("reads changed files from disk and builds an entry", async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "orgit-doc-"));
    await fs.mkdir(path.join(dir, "src"), { recursive: true });
    await fs.writeFile(path.join(dir, "src", "a.ts"), "export const a = 1;\n");
    const p = new DocProvider("Documents a.");
    const entry = await buildChangeDoc(p, dir, "task-001", "Improve a", ["src/a.ts"]);
    expect(entry).not.toBeNull();
    expect(entry!.taskId).toBe("task-001");
    expect(entry!.title).toBe("Improve a");
    expect(entry!.markdown).toBe("Documents a.");
  });

  it("returns null when no changed file is readable", async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "orgit-doc-"));
    const p = new DocProvider("x");
    expect(await buildChangeDoc(p, dir, "t", "t", ["missing.ts"])).toBeNull();
  });
});

describe("writeChangeDocs", () => {
  it("writes a doc per entry plus an index, into the workspace by default", async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "orgit-docs-"));
    const ws = { reportsDir: path.join(dir, "reports") } as unknown as Workspace;
    await fs.mkdir(ws.reportsDir, { recursive: true });
    const { baseDir, files } = await writeChangeDocs(
      dir,
      ws,
      [{ taskId: "task-001", title: "Improve a", files: ["src/a.ts"], markdown: "Docs." }],
      { toRepo: false, dir: "docs/orgit" },
    );
    expect(baseDir).toBe(path.join(ws.reportsDir, "docs"));
    expect(files.length).toBe(2); // one doc + index
    const doc = await fs.readFile(path.join(baseDir, "task-001.md"), "utf8");
    expect(doc).toContain("# Improve a");
    expect(doc).toContain("`src/a.ts`");
    const index = await fs.readFile(path.join(baseDir, "README.md"), "utf8");
    expect(index).toContain("[Improve a](task-001.md)");
  });

  it("writes into the repo dir when toRepo is true", async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "orgit-docs-"));
    const ws = { reportsDir: path.join(dir, "reports") } as unknown as Workspace;
    const { baseDir } = await writeChangeDocs(
      dir,
      ws,
      [{ taskId: "t", title: "T", files: ["a.ts"], markdown: "d" }],
      { toRepo: true, dir: "docs/orgit" },
    );
    expect(baseDir).toBe(path.join(dir, "docs/orgit"));
  });
});
