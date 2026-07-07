import { describe, it, expect, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  deriveConventions,
  addNote,
  renderConventions,
  loadConventions,
  saveConventions,
  type Conventions,
} from "./conventions.js";
import { buildMentalModel } from "../analysis/model.js";
import { DEFAULT_CONFIG } from "../config/config.js";
import { resolveWorkspace, ensureWorkspace } from "../config/workspace.js";

let dir: string | undefined;
afterEach(async () => {
  if (dir) await fs.rm(dir, { recursive: true, force: true });
  dir = undefined;
});

const EMPTY: Conventions = {
  indent: "unknown",
  indentSize: 2,
  quotes: "unknown",
  semicolons: "unknown",
  notes: [],
  updatedAt: new Date(0).toISOString(),
};

describe("deriveConventions", () => {
  it("detects 2-space indent, double quotes, semicolons, and the test framework", async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "orgit-conv-"));
    await fs.writeFile(
      path.join(dir, "package.json"),
      JSON.stringify({ scripts: { test: "vitest run" } }),
    );
    await fs.writeFile(path.join(dir, "vitest.config.ts"), "export default {};\n");
    await fs.mkdir(path.join(dir, "src"), { recursive: true });
    await fs.writeFile(
      path.join(dir, "src", "a.ts"),
      // Deliberately 2-space indent, double quotes, semicolons.
      'export function greet(name) {\n  const msg = "hi " + name;\n  return msg;\n}\n',
    );

    const model = await buildMentalModel(dir, DEFAULT_CONFIG);
    const conv = await deriveConventions(model, EMPTY);
    expect(conv.indent).toBe("space");
    expect(conv.indentSize).toBe(2);
    expect(conv.quotes).toBe("double");
    expect(conv.semicolons).toBe(true);
    expect(conv.testFramework).toBe("vitest");
  });
});

describe("addNote", () => {
  it("prepends, deduplicates, and caps notes", () => {
    let conv = EMPTY;
    conv = addNote(conv, "prefer helpers");
    conv = addNote(conv, "prefer helpers"); // dup ignored
    conv = addNote(conv, "avoid magic numbers");
    expect(conv.notes).toEqual(["avoid magic numbers", "prefer helpers"]);
    for (let i = 0; i < 60; i++) conv = addNote(conv, `note ${i}`);
    expect(conv.notes.length).toBeLessThanOrEqual(50);
  });
});

describe("renderConventions", () => {
  it("renders learned conventions compactly", () => {
    const conv: Conventions = {
      indent: "space",
      indentSize: 2,
      quotes: "double",
      semicolons: true,
      testFramework: "vitest",
      notes: ["prefer small functions"],
      updatedAt: "now",
    };
    const out = renderConventions(conv);
    expect(out).toContain("2 spaces");
    expect(out).toContain("double");
    expect(out).toContain("required");
    expect(out).toContain("vitest");
    expect(out).toContain("prefer small functions");
  });

  it("handles the empty case", () => {
    expect(renderConventions(EMPTY)).toBe("No conventions learned yet.");
  });
});

describe("load/save round-trip", () => {
  it("persists and reloads conventions", async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "orgit-conv-io-"));
    await ensureWorkspace(dir);
    const ws = resolveWorkspace(dir);
    const conv: Conventions = { ...EMPTY, indent: "tab", quotes: "single" };
    await saveConventions(ws, conv);
    const loaded = await loadConventions(ws);
    expect(loaded.indent).toBe("tab");
    expect(loaded.quotes).toBe("single");
  });

  it("returns defaults when no file exists", async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "orgit-conv-none-"));
    const ws = resolveWorkspace(dir);
    const loaded = await loadConventions(ws);
    expect(loaded.indent).toBe("unknown");
  });
});
