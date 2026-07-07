import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { simpleGit } from "simple-git";
import { Git } from "./git.js";

/**
 * Exercises the rollback primitive against a real temporary git repo — the safety
 * guarantee the executor depends on (a failed task must leave the tree exactly as
 * it was).
 */
describe("Git rollback", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "orgit-git-"));
    const g = simpleGit(dir);
    await g.init();
    await g.addConfig("user.email", "test@example.com");
    await g.addConfig("user.name", "Test");
    // Keep line endings byte-exact so the rollback assertion isn't defeated by
    // git's autocrlf normalisation on Windows.
    await g.addConfig("core.autocrlf", "false");
    await fs.writeFile(path.join(dir, "a.txt"), "original\n");
    await g.add(["-A"]);
    await g.commit("init");
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("restores modified and untracked files to a known-good ref", async () => {
    const git = new Git(dir);
    const base = await git.headSha();

    // Simulate a task's edits: modify a file and add a new one.
    await fs.writeFile(path.join(dir, "a.txt"), "changed\n");
    await fs.writeFile(path.join(dir, "b.txt"), "new file\n");

    await git.rollbackTo(base);

    expect(await fs.readFile(path.join(dir, "a.txt"), "utf8")).toBe("original\n");
    await expect(fs.stat(path.join(dir, "b.txt"))).rejects.toThrow();
    expect(await git.isClean()).toBe(true);
    expect(await git.headSha()).toBe(base);
  });

  it("reports repo and clean status", async () => {
    const git = new Git(dir);
    expect(await git.isRepo()).toBe(true);
    expect(await git.isClean()).toBe(true);
    await fs.writeFile(path.join(dir, "a.txt"), "dirty\n");
    expect(await git.isClean()).toBe(false);
  });
});
