import { describe, it, expect, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildMentalModel, detectSignals, summariseModel } from "./model.js";
import { DEFAULT_CONFIG } from "../config/config.js";

let dir: string | undefined;
afterEach(async () => {
  if (dir) await fs.rm(dir, { recursive: true, force: true });
  dir = undefined;
});

async function seed(files: Record<string, string>): Promise<string> {
  const d = await fs.mkdtemp(path.join(os.tmpdir(), "orgit-model-"));
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(d, rel);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, content, "utf8");
  }
  return d;
}

describe("buildMentalModel", () => {
  it("captures files, languages, modules, and totals", async () => {
    dir = await seed({
      "package.json": JSON.stringify({ scripts: { build: "tsc", test: "vitest" } }),
      "src/a.ts": "export const a = 1;\n",
      "src/b.ts": "export const b = 2;\n",
      "README.md": "# hi\n",
    });
    const model = await buildMentalModel(dir, DEFAULT_CONFIG);
    expect(model.totals.files).toBe(4);
    expect(model.languages.ts).toBe(2);
    expect(model.modules.src).toEqual(["src/a.ts", "src/b.ts"]);
    expect(model.files.every((f) => f.hash.length === 64)).toBe(true);
  });
});

describe("detectSignals", () => {
  it("detects a node project and its scripts from package.json", async () => {
    dir = await seed({
      "package.json": JSON.stringify({
        scripts: { build: "tsc", test: "vitest", lint: "eslint ." },
      }),
      "pnpm-lock.yaml": "lockfileVersion: '9.0'\n",
    });
    const signals = await detectSignals(dir, []);
    expect(signals.ecosystem).toBe("node");
    expect(signals.packageManager).toBe("pnpm");
    expect(signals.scripts.build).toBe("pnpm run build");
    expect(signals.scripts.test).toBe("pnpm test");
    expect(signals.scripts.lint).toBe("pnpm run lint");
  });

  it("detects a python project", async () => {
    dir = await seed({ "pyproject.toml": "[project]\nname='x'\n" });
    const signals = await detectSignals(dir, []);
    expect(signals.ecosystem).toBe("python");
  });

  it("falls back to unknown ecosystem", async () => {
    dir = await seed({ "main.c": "int main(){}\n" });
    const signals = await detectSignals(dir, []);
    expect(signals.ecosystem).toBe("unknown");
  });

  it("survives malformed package.json without scripts", async () => {
    dir = await seed({ "package.json": "{ not json" });
    const signals = await detectSignals(dir, []);
    expect(signals.ecosystem).toBe("node");
    expect(signals.scripts.build).toBeUndefined();
  });
});

describe("summariseModel", () => {
  it("produces a compact, token-thrifty summary", async () => {
    dir = await seed({
      "package.json": JSON.stringify({ scripts: {} }),
      "src/a.ts": "export const a = 1;\n",
    });
    const model = await buildMentalModel(dir, DEFAULT_CONFIG);
    const summary = summariseModel(model);
    expect(summary).toContain("Ecosystem: node");
    expect(summary).toContain("Files:");
    expect(summary).toContain("Languages:");
  });
});
