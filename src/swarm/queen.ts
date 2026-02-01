/**
 * Swarm Queen
 * Coordinator that spawns workers, streams their output, and manages the swarm
 */

import { EventEmitter } from "events";
import { v4 as uuidv4 } from "uuid";
import { Worker } from "./worker";
import { createWorkerPanes, closeAllPanes, PaneHandle } from "./panes";
import {
  SwarmConfig,
  SwarmResult,
  WorkerConfig,
  WorkerMessage,
  WorkerState,
} from "./types";

export interface QueenConfig extends SwarmConfig {
  id?: string;
  name?: string;
}

export class Queen extends EventEmitter {
  readonly id: string;
  readonly name: string;
  readonly config: SwarmConfig;

  private workers: Map<string, Worker> = new Map();
  private panes: Map<number, PaneHandle> = new Map();
  private startedAt?: Date;
  private completedAt?: Date;

  constructor(config: QueenConfig = {}) {
    super();
    this.id = config.id ?? uuidv4();
    this.name = config.name ?? `Swarm-${this.id.slice(0, 8)}`;
    this.config = {
      maxWorkers: config.maxWorkers ?? 8,
      timeout: config.timeout ?? 600000, // 10 minutes
      panes: config.panes ?? true,
      sharedMemory: config.sharedMemory ?? true,
    };
  }

  /**
   * Spawn multiple workers in parallel
   */
  async spawn(configs: WorkerConfig[]): Promise<SwarmResult> {
    if (configs.length > (this.config.maxWorkers ?? 8)) {
      throw new Error(`Cannot spawn ${configs.length} workers, max is ${this.config.maxWorkers}`);
    }

    this.startedAt = new Date();
    this.emit("start", { swarmId: this.id, workerCount: configs.length });

    // Create WezTerm panes if enabled
    if (this.config.panes) {
      this.panes = await createWorkerPanes(configs.length);
    }

    // Create workers
    const workers: Worker[] = configs.map((cfg, index) => {
      const worker = new Worker({
        ...cfg,
        id: cfg.id ?? `${this.id}-worker-${index}`,
      });

      // Stream output to pane if available
      const pane = this.panes.get(index);
      if (pane) {
        worker.on("output", (msg: WorkerMessage) => {
          pane.send(msg.data);
        });
      }

      // Forward all events to queen
      worker.on("output", (msg) => this.emit("worker:output", msg));
      worker.on("complete", (msg) => this.emit("worker:complete", msg));
      worker.on("error", (msg) => this.emit("worker:error", msg));
      worker.on("status", (msg) => this.emit("worker:status", msg));

      this.workers.set(worker.id, worker);
      return worker;
    });

    // Start all workers in parallel
    await Promise.all(workers.map((w) => w.start()));

    // Set up timeout
    const timeoutPromise = new Promise<void>((_, reject) => {
      setTimeout(() => {
        reject(new Error(`Swarm timeout after ${this.config.timeout}ms`));
      }, this.config.timeout);
    });

    // Wait for all workers to complete or timeout
    try {
      await Promise.race([
        Promise.all(workers.map((w) => w.wait())),
        timeoutPromise,
      ]);
    } catch (err) {
      // Timeout - abort all workers
      await this.abortAll();
      throw err;
    }

    this.completedAt = new Date();
    const result = this.getResult();
    this.emit("complete", result);

    // Close panes after short delay to show final output
    if (this.config.panes && this.panes.size > 0) {
      setTimeout(() => closeAllPanes(this.panes), 2000);
    }

    return result;
  }

  /**
   * Spawn a single worker
   */
  async spawnOne(config: WorkerConfig): Promise<WorkerState> {
    const result = await this.spawn([config]);
    return result.workers[0];
  }

  /**
   * Abort all workers
   */
  async abortAll(): Promise<void> {
    const promises = Array.from(this.workers.values()).map((w) => w.abort());
    await Promise.all(promises);
    this.emit("aborted", { swarmId: this.id });
  }

  /**
   * Abort a specific worker
   */
  async abort(workerId: string): Promise<void> {
    const worker = this.workers.get(workerId);
    if (worker) {
      await worker.abort();
    }
  }

  /**
   * Get worker by ID
   */
  getWorker(workerId: string): Worker | undefined {
    return this.workers.get(workerId);
  }

  /**
   * Get all worker states
   */
  getWorkerStates(): WorkerState[] {
    return Array.from(this.workers.values()).map((w) => w.getState());
  }

  /**
   * Get swarm result
   */
  getResult(): SwarmResult {
    const workers = this.getWorkerStates();
    const success = workers.every((w) => w.status === "completed");
    const duration = this.completedAt && this.startedAt
      ? this.completedAt.getTime() - this.startedAt.getTime()
      : 0;

    return {
      id: this.id,
      workers,
      duration,
      success,
    };
  }

  /**
   * Check if swarm is done
   */
  isDone(): boolean {
    return Array.from(this.workers.values()).every((w) => w.isDone());
  }
}

/**
 * Convenience function to run a parallel swarm
 */
export async function runSwarm(
  tasks: Array<{ name: string; prompt: string; persona?: "zee" | "stanley" | "johny" }>,
  config?: QueenConfig
): Promise<SwarmResult> {
  const queen = new Queen(config);

  const workerConfigs: WorkerConfig[] = tasks.map((task, i) => ({
    id: `worker-${i}`,
    name: task.name,
    prompt: task.prompt,
    persona: task.persona,
  }));

  return queen.spawn(workerConfigs);
}

/**
 * Fan-out pattern: run same prompt with different contexts
 */
export async function fanOut(
  prompt: string,
  contexts: string[],
  config?: QueenConfig
): Promise<SwarmResult> {
  const tasks = contexts.map((ctx, i) => ({
    name: `Context-${i}`,
    prompt: `${prompt}\n\nContext:\n${ctx}`,
  }));

  return runSwarm(tasks, config);
}

/**
 * Research pattern: multiple researchers, synthesize results
 */
export async function research(
  questions: string[],
  config?: QueenConfig
): Promise<SwarmResult> {
  const tasks = questions.map((q, i) => ({
    name: `Researcher-${i}`,
    prompt: `Research and answer this question thoroughly:\n\n${q}\n\nProvide detailed findings with sources.`,
  }));

  return runSwarm(tasks, config);
}
