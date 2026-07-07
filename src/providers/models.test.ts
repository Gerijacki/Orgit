import { describe, it, expect } from "vitest";
import { resolveModel, DEFAULT_MODEL } from "./models.js";

describe("resolveModel", () => {
  it("expands known aliases (case-insensitive)", () => {
    expect(resolveModel("opus")).toBe("claude-opus-4-8");
    expect(resolveModel("Sonnet")).toBe("claude-sonnet-5");
    expect(resolveModel("HAIKU")).toBe("claude-haiku-4-5-20251001");
  });

  it("passes unknown ids through unchanged (trimmed)", () => {
    expect(resolveModel("claude-experimental-9")).toBe("claude-experimental-9");
    expect(resolveModel("  claude-opus-4-8  ")).toBe("claude-opus-4-8");
  });

  it("falls back to the default when empty/undefined", () => {
    expect(resolveModel()).toBe(DEFAULT_MODEL);
    expect(resolveModel("")).toBe(DEFAULT_MODEL);
  });
});
