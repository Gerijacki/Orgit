import { describe, it, expect, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { resolveWorkspace, ensureWorkspace, workspaceExists } from "./workspace.js";

let dir: string | undefined;
afterEach(async () => {
  if (dir) await fs.rm(dir, { recursive: true, force: true });
  dir = undefined;
});

describe("workspace", () => {
  it("resolves paths under .orgit", () => {
    const ws = resolveWorkspace("/repo");
    expect(ws.dir).toBe(path.join("/repo", ".orgit"));
    expect(ws.memoryDir).toBe(path.join("/repo", ".orgit", "memory"));
    expect(ws.reportsDir).toBe(path.join("/repo", ".orgit", "reports"));
  });

  it("ensureWorkspace creates the tree and a self-ignore, idempotently", async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "orgit-ws-"));
    expect(await workspaceExists(dir)).toBe(false);

    const ws = await ensureWorkspace(dir);
    expect(await workspaceExists(dir)).toBe(true);
    expect((await fs.stat(ws.memoryDir)).isDirectory()).toBe(true);
    expect((await fs.stat(ws.reportsDir)).isDirectory()).toBe(true);
    expect(await fs.readFile(path.join(ws.dir, ".gitignore"), "utf8")).toContain("*");

    // Second call must not throw.
    await expect(ensureWorkspace(dir)).resolves.toBeDefined();
  });
});
