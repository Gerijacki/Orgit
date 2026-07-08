import { describe, it, expect, vi, afterEach } from "vitest";
import { log, subscribeToLog, type LogEvent } from "./log.js";

// Keep the test output clean; we only care about what sinks receive.
afterEach(() => vi.restoreAllMocks());

describe("log sinks", () => {
  it("delivers plain, ANSI-stripped text to subscribers (web UI contract)", () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const events: LogEvent[] = [];
    const unsub = subscribeToLog((e) => events.push(e));

    log.info("\x1b[2mPlan has 20 tasks\x1b[22m"); // dim
    log.success("\x1b[32mdone\x1b[39m"); // green
    unsub();
    log.info("after-unsub");

    expect(events).toHaveLength(2);
    expect(events[0]).toEqual({ level: "info", message: "Plan has 20 tasks" });
    expect(events[1]).toEqual({ level: "success", message: "done" });
    expect(events.some((e) => e.message === "after-unsub")).toBe(false);
  });

  it("does not alter plain messages", () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const events: LogEvent[] = [];
    const unsub = subscribeToLog((e) => events.push(e));
    log.step("Understand — building repository mental model");
    unsub();
    expect(events[0]!.message).toBe("Understand — building repository mental model");
  });
});
