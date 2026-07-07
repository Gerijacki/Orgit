import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { BackendAvailability } from "./detect.js";
import type { OrgitConfig } from "../config/config.js";

// Controllable backend availability shared with the mock below.
const backends: BackendAvailability = { cli: { available: false }, api: { available: false } };
vi.mock("./detect.js", () => ({ detectBackends: async () => backends }));

const { createProvider } = await import("./factory.js");

function cfg(provider: OrgitConfig["provider"]): OrgitConfig {
  return { provider, model: "claude-opus-4-8" } as OrgitConfig;
}

describe("createProvider", () => {
  const origEnv = { ...process.env };

  beforeEach(() => {
    backends.cli = { available: false };
    backends.api = { available: false };
    delete process.env.ORGIT_PROVIDER;
    delete process.env.ORGIT_MODEL;
    delete process.env.ANTHROPIC_API_KEY;
  });
  afterEach(() => {
    process.env = { ...origEnv };
  });

  it("prefers the subscription CLI in auto mode when both are available", async () => {
    backends.cli = { available: true };
    backends.api = { available: true };
    process.env.ANTHROPIC_API_KEY = "test-key";
    const p = await createProvider(cfg("auto"));
    expect(p.kind).toBe("cli");
  });

  it("falls back to the API in auto mode when only the API is available", async () => {
    backends.api = { available: true };
    process.env.ANTHROPIC_API_KEY = "test-key";
    const p = await createProvider(cfg("auto"));
    expect(p.kind).toBe("api");
  });

  it("lets ORGIT_PROVIDER override the config", async () => {
    backends.cli = { available: true };
    process.env.ORGIT_PROVIDER = "cli";
    const p = await createProvider(cfg("api"));
    expect(p.kind).toBe("cli");
  });

  it("throws an actionable error when 'cli' is requested but missing", async () => {
    await expect(createProvider(cfg("cli"))).rejects.toThrow(/claude` CLI/);
  });

  it("throws an actionable error when 'api' is requested but no key is set", async () => {
    await expect(createProvider(cfg("api"))).rejects.toThrow(/ANTHROPIC_API_KEY/);
  });

  it("throws when auto mode finds no backend at all", async () => {
    await expect(createProvider(cfg("auto"))).rejects.toThrow(/No Claude backend/);
  });

  it("uses ORGIT_MODEL over the config model, resolving aliases", async () => {
    backends.cli = { available: true };
    process.env.ORGIT_MODEL = "sonnet";
    const p = await createProvider(cfg("cli"));
    expect(p.describe()).toContain("claude-sonnet-5");
  });

  it("falls back to the config model when ORGIT_MODEL is unset", async () => {
    backends.cli = { available: true };
    const p = await createProvider(cfg("cli"));
    expect(p.describe()).toContain("claude-opus-4-8");
  });
});
