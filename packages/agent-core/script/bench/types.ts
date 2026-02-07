import type { MemoryBenchContext } from "./memory";

export interface BenchRunOptions {
  durationSeconds: number;
  concurrency: number;
  seedCount: number;
}

export interface BenchContext {
  memory?: MemoryBenchContext | null;
}

export type BenchResult =
  | {
      id: string;
      name: string;
      group: string;
      status: "ok";
      metrics: Record<string, unknown>;
    }
  | {
      id: string;
      name: string;
      group: string;
      status: "skipped";
      reason: string;
    }
  | {
      id: string;
      name: string;
      group: string;
      status: "error";
      error: string;
    };

export interface BenchCase {
  id: string;
  name: string;
  group: string;
  run: (ctx: BenchContext, opts: BenchRunOptions) => Promise<BenchResult>;
}

