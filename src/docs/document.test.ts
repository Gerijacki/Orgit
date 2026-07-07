import { describe, it, expect, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { renderArchitecture, writeArchitectureDoc } from "./document.js";
import type { MentalModel } from "../core/types.js";
import type { Workspace } from "../config/workspace.js";

const model = {
  root: "/repo",
  totals: { files: 5, lines: 200, bytes: 4000 },
  languages: { ts: 4, md: 1 },
  modules: { src: ["src/a.ts", "src/b.ts"], docs: ["docs/x.md"] },
  signals: {
    ecosystem: "node",
    packageManager: "pnpm",
    scripts: { build: "pnpm run build", test: "pnpm test" },
  },
} as unknown as MentalModel;

describe("renderArchitecture", () => {
  it("summarises languages, modules, and validation entry points", () => {
    const md = renderArchitecture(model);
    expect(md).toContain("# Architecture Overview");
    expect(md).toContain("Ecosystem:** node");
    expect(md).toContain("ts: 4 file(s)");
    expect(md).toContain("**src** — 2 file(s)");
    expect(md).toContain("Build: `pnpm run build`");
    expect(md).toContain("Lint: _none detected_");
  });
});

describe("writeArchitectureDoc", () => {
  let dir: string;
  afterEach(async () => {
    if (dir) await fs.rm(dir, { recursive: true, force: true });
  });

  it("writes to the reports dir by default", async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "orgit-doc-"));
    const ws = { root: dir, reportsDir: path.join(dir, "reports") } as unknown as Workspace;
    await fs.mkdir(ws.reportsDir, { recursive: true });
    const out = await writeArchitectureDoc(ws, model, false);
    expect(out).toBe(path.join(ws.reportsDir, "ARCHITECTURE.md"));
    expect(await fs.readFile(out, "utf8")).toContain("# Architecture Overview");
  });

  it("writes into the repo docs/ when requested", async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "orgit-doc-"));
    const ws = { root: dir, reportsDir: path.join(dir, "reports") } as unknown as Workspace;
    const out = await writeArchitectureDoc(ws, model, true);
    expect(out).toBe(path.join(dir, "docs", "ARCHITECTURE.md"));
    expect(await fileExists(out)).toBe(true);
  });
});

async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.stat(p);
    return true;
  } catch {
    return false;
  }
}
