import { describe, it, expect } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadConfig, DEFAULT_CONFIG, ConfigSchema } from "./config.js";

describe("config", () => {
  it("provides sensible defaults", () => {
    expect(DEFAULT_CONFIG.provider).toBe("auto");
    expect(DEFAULT_CONFIG.model).toBe("claude-opus-4-8");
    expect(DEFAULT_CONFIG.chunkLines).toBeGreaterThan(DEFAULT_CONFIG.chunkOverlap);
  });

  it("returns defaults when no config file exists", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "orgit-cfg-"));
    const cfg = await loadConfig(dir);
    expect(cfg).toEqual(DEFAULT_CONFIG);
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("merges a config file over defaults", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "orgit-cfg-"));
    await fs.writeFile(
      path.join(dir, "orgit.config.json"),
      JSON.stringify({ provider: "api", maxTasksPerPlan: 3 }),
    );
    const cfg = await loadConfig(dir);
    expect(cfg.provider).toBe("api");
    expect(cfg.maxTasksPerPlan).toBe(3);
    expect(cfg.model).toBe("claude-opus-4-8"); // default preserved
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("rejects invalid provider values", () => {
    expect(() => ConfigSchema.parse({ provider: "nonsense" })).toThrow();
  });
});
