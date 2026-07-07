import { describe, it, expect } from "vitest";
import { mapWithConcurrency } from "./concurrency.js";

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("mapWithConcurrency", () => {
  it("preserves input order regardless of completion order", async () => {
    const out = await mapWithConcurrency([30, 10, 20], 3, async (ms, i) => {
      await delay(ms);
      return i;
    });
    expect(out).toEqual([0, 1, 2]);
  });

  it("never exceeds the concurrency limit", async () => {
    let active = 0;
    let peak = 0;
    await mapWithConcurrency(
      Array.from({ length: 10 }, (_, i) => i),
      3,
      async () => {
        active++;
        peak = Math.max(peak, active);
        await delay(5);
        active--;
        return 0;
      },
    );
    expect(peak).toBeLessThanOrEqual(3);
    expect(peak).toBeGreaterThan(1);
  });

  it("runs sequentially when the limit is 1", async () => {
    const order: number[] = [];
    await mapWithConcurrency([0, 1, 2], 1, async (_, i) => {
      order.push(i);
      await delay(1);
      return i;
    });
    expect(order).toEqual([0, 1, 2]);
  });

  it("handles an empty input", async () => {
    expect(await mapWithConcurrency([], 4, async () => 1)).toEqual([]);
  });

  it("actually parallelizes (faster than sequential)", async () => {
    const start = Date.now();
    await mapWithConcurrency([20, 20, 20, 20], 4, async (ms) => {
      await delay(ms);
      return ms;
    });
    // 4×20ms in parallel should finish well under the 80ms sequential total.
    expect(Date.now() - start).toBeLessThan(70);
  });
});
