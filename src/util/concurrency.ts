/**
 * Run an async mapper over items with a bounded number of workers in flight.
 * Results are returned in input order. Used to fan out the slow, independent part of
 * evolution — asking Claude to generate each task's edit — across parallel workers,
 * so a plan of N tasks doesn't pay N sequential round-trips.
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const n = items.length;
  const results = new Array<R>(n);
  const workers = Math.max(1, Math.min(limit, n));
  let next = 0;

  async function worker(): Promise<void> {
    while (true) {
      const i = next++;
      if (i >= n) return;
      results[i] = await fn(items[i]!, i);
    }
  }

  await Promise.all(Array.from({ length: workers }, () => worker()));
  return results;
}
