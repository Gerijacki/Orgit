import { describe, it, expect } from "vitest";
import { z } from "zod";
import { completeJson } from "./factory.js";
import type { ClaudeProvider, CompleteOptions } from "./types.js";

/** Minimal in-test provider: returns queued responses in order. */
class QueueProvider implements ClaudeProvider {
  readonly kind = "cli" as const;
  public calls = 0;
  constructor(private readonly responses: string[]) {}
  describe() {
    return "queue";
  }
  async healthCheck() {
    return { ok: true, detail: "queue" };
  }
  async complete(_opts: CompleteOptions) {
    return this.responses[this.calls++] ?? "";
  }
}

const Schema = z.object({ name: z.string(), count: z.number() });

describe("completeJson", () => {
  it("parses clean JSON on the first try", async () => {
    const p = new QueueProvider(['{"name":"a","count":2}']);
    const out = await completeJson(p, Schema, { prompt: "x" });
    expect(out).toEqual({ name: "a", count: 2 });
    expect(p.calls).toBe(1);
  });

  it("extracts JSON embedded in prose / code fences", async () => {
    const p = new QueueProvider(['Sure:\n```json\n{"name":"b","count":5}\n```\nDone']);
    const out = await completeJson(p, Schema, { prompt: "x" });
    expect(out).toEqual({ name: "b", count: 5 });
  });

  it("retries once, then succeeds", async () => {
    const p = new QueueProvider(["not json at all", '{"name":"c","count":1}']);
    const out = await completeJson(p, Schema, { prompt: "x" });
    expect(out.name).toBe("c");
    expect(p.calls).toBe(2);
  });

  it("throws after two invalid responses", async () => {
    const p = new QueueProvider(["nope", "still nope"]);
    await expect(completeJson(p, Schema, { prompt: "x" })).rejects.toThrow(/valid JSON/i);
    expect(p.calls).toBe(2);
  });

  it("sends the cacheable prefix only on the first attempt, and repairs cheaply on retry", async () => {
    const seen: CompleteOptions[] = [];
    const provider: ClaudeProvider = {
      kind: "cli",
      describe: () => "capture",
      healthCheck: async () => ({ ok: true, detail: "x" }),
      complete: async (opts) => {
        seen.push(opts);
        return seen.length === 1 ? "not json" : '{"name":"ok","count":1}';
      },
    };
    const out = await completeJson(provider, Schema, {
      prompt: "ORIGINAL BIG PROMPT",
      cacheableContext: "STABLE PREFIX",
    });
    expect(out.name).toBe("ok");
    // First attempt carries the cacheable prefix and the original prompt.
    expect(seen[0]!.cacheableContext).toBe("STABLE PREFIX");
    expect(seen[0]!.prompt).toBe("ORIGINAL BIG PROMPT");
    // Repair attempt drops the prefix and does not re-send the original prompt.
    expect(seen[1]!.cacheableContext).toBeUndefined();
    expect(seen[1]!.prompt).not.toContain("ORIGINAL BIG PROMPT");
    expect(seen[1]!.prompt).toMatch(/corrected JSON/i);
  });
});
