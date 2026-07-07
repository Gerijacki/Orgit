import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { startServer, type ServerHandle } from "./server.js";

let dir: string;
let handle: ServerHandle | undefined;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "orgit-server-"));
  await fs.mkdir(path.join(dir, "src"), { recursive: true });
  await fs.writeFile(path.join(dir, "src", "a.ts"), "export const a = 1;\n");
});
afterEach(async () => {
  if (handle) await handle.close();
  handle = undefined;
  await fs.rm(dir, { recursive: true, force: true });
});

describe("startServer", () => {
  it("serves the dashboard page, the state API, and 404s unknown routes", async () => {
    handle = await startServer(dir, { port: 0 });
    expect(handle.url).toContain("127.0.0.1");

    const page = await fetch(handle.url + "/");
    expect(page.status).toBe(200);
    expect(await page.text()).toContain("Orgit dashboard");

    const state = await fetch(handle.url + "/api/state");
    expect(state.status).toBe(200);
    const snap = await state.json();
    expect(snap.totals.files).toBe(1);
    expect(snap.health).toBeDefined();

    const missing = await fetch(handle.url + "/api/nope");
    expect(missing.status).toBe(404);
  });

  it("rejects a report request with path traversal or a non-md name", async () => {
    handle = await startServer(dir, { port: 0 });
    const bad = await fetch(handle.url + "/api/report?name=../../secret.txt");
    expect(bad.status).toBe(400);
  });
});
