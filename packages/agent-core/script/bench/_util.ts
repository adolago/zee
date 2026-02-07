export function msNow(): number {
  return performance.now();
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function percentile(sortedAsc: number[], p: number): number {
  if (sortedAsc.length === 0) return 0;
  const clamped = Math.max(0, Math.min(1, p));
  const idx = Math.round(clamped * (sortedAsc.length - 1));
  return sortedAsc[idx] ?? sortedAsc[sortedAsc.length - 1] ?? 0;
}

export function summarizeLatenciesMs(latenciesMs: number[]): {
  count: number;
  mean: number;
  min: number;
  max: number;
  p50: number;
  p90: number;
  p99: number;
} {
  if (latenciesMs.length === 0) {
    return { count: 0, mean: 0, min: 0, max: 0, p50: 0, p90: 0, p99: 0 };
  }

  const sorted = [...latenciesMs].sort((a, b) => a - b);
  const min = sorted[0] ?? 0;
  const max = sorted[sorted.length - 1] ?? 0;
  const sum = latenciesMs.reduce((s, v) => s + v, 0);
  const mean = sum / latenciesMs.length;

  return {
    count: latenciesMs.length,
    mean,
    min,
    max,
    p50: percentile(sorted, 0.5),
    p90: percentile(sorted, 0.9),
    p99: percentile(sorted, 0.99),
  };
}

export async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const workers = Math.max(1, Math.floor(concurrency));
  const results: R[] = new Array(items.length);
  let next = 0;

  await Promise.all(
    Array.from({ length: workers }, async () => {
      while (true) {
        const idx = next++;
        if (idx >= items.length) return;
        results[idx] = await fn(items[idx] as T, idx);
      }
    }),
  );

  return results;
}

export async function runLoad(options: {
  durationMs: number;
  concurrency: number;
  fn: (iteration: number) => Promise<void>;
}): Promise<{
  durationMs: number;
  ops: number;
  errors: number;
  latenciesMs: number[];
}> {
  const startedAt = msNow();
  const deadline = startedAt + Math.max(0, options.durationMs);
  const concurrency = Math.max(1, Math.floor(options.concurrency));

  const latenciesMs: number[] = [];
  let ops = 0;
  let errors = 0;

  await Promise.all(
    Array.from({ length: concurrency }, async (_, worker) => {
      let iter = 0;
      while (msNow() < deadline) {
        const n = worker * 1_000_000_000 + iter++;
        const t0 = msNow();
        try {
          await options.fn(n);
        } catch {
          errors++;
        } finally {
          const t1 = msNow();
          latenciesMs.push(t1 - t0);
          ops++;
        }
      }
    }),
  );

  const finishedAt = msNow();
  return {
    durationMs: finishedAt - startedAt,
    ops,
    errors,
    latenciesMs,
  };
}

