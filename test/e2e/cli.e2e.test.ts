import { describe, it, expect, afterEach } from "vitest";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { execa } from "execa";
import { makeTempGitRepo, type TempRepo } from "../helpers.js";

/**
 * End-to-end tests that drive the real CLI as a subprocess (through the `tsx` loader),
 * exercising argument parsing, command wiring, and process exit codes. These cover the
 * commands that need no Claude backend and no embeddings, so they run offline in CI.
 */

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const cliEntry = path.join(projectRoot, "src/cli/index.ts");

function orgit(args: string[]) {
  return execa("node", ["--import", "tsx", cliEntry, ...args], {
    cwd: projectRoot,
    reject: false,
    all: true,
    timeout: 60_000,
  });
}

let repo: TempRepo | undefined;
afterEach(async () => {
  await repo?.cleanup();
  repo = undefined;
});

describe("cli e2e (offline commands)", () => {
  it("prints help", async () => {
    const r = await orgit(["--help"]);
    expect(r.exitCode).toBe(0);
    expect(r.all).toContain("Autonomous repository evolution engine");
    expect(r.all).toContain("evolve");
  });

  it("prints version", async () => {
    const r = await orgit(["--version"]);
    expect(r.exitCode).toBe(0);
    expect(r.all).toContain("0.1.0");
  });

  it("runs doctor and reports environment", async () => {
    const r = await orgit(["doctor"]);
    // Exit code depends on whether a backend is present, so don't assert it here.
    expect(r.all).toContain("Orgit doctor");
    expect(r.all).toContain("Node:");
    expect(r.all).toMatch(/Embedding model:/);
  });

  it("status reports an uninitialised workspace on a fresh repo", async () => {
    repo = await makeTempGitRepo({ "readme.md": "# hi\n" });
    const r = await orgit(["-C", repo.root, "status"]);
    expect(r.exitCode).toBe(0);
    expect(r.all).toMatch(/No \.orgit workspace/i);
  });

  it("rejects an invalid --max with a clear error and non-zero exit", async () => {
    const r = await orgit(["evolve", "--max", "abc"]);
    expect(r.exitCode).toBe(1);
    expect(r.all).toContain("--max must be a positive integer");
  });
});
