/**
 * Swarm Queen
 * Coordinator that spawns workers, streams their output, and manages the swarm
 */

import { EventEmitter } from "events";
import { randomUUID } from "node:crypto";
import { Worker } from "./worker";
import type { SwarmConfig, SwarmResult, WorkerConfig, WorkerMessage, WorkerState } from "./types";
import {
  EventStreamVisualOrchestrationSink,
  NOOP_VISUAL_SINK,
  resolveVisualConfig,
} from "../orchestration-visual";
import type {
  OrchestrationVisualConfig,
  OrchestrationVisualEvent,
  ResolvedOrchestrationVisualConfig,
  VisualOrchestrationSink,
} from "../orchestration-visual";

export interface QueenConfig extends SwarmConfig {
  id?: string;
  name?: string;
  consensus?: ConsensusConfig;
  visual?: OrchestrationVisualConfig;
  visualSink?: VisualOrchestrationSink;
}

export interface ConsensusConfig {
  threshold?: number; // 0-1, default 0.6 (60% agreement)
  timeout?: number; // ms to wait for votes
}

export interface ConsensusResult {
  approved: boolean;
  votes: Map<string, boolean>;
  threshold: number;
  agreement: number;
}

export class Queen extends EventEmitter {
  readonly id: string;
  readonly name: string;
  readonly config: SwarmConfig;

  private workers: Map<string, Worker> = new Map();
  private startedAt?: Date;
  private completedAt?: Date;
  private readonly visualConfig: ResolvedOrchestrationVisualConfig;
  private readonly visualSink: VisualOrchestrationSink;

  constructor(config: QueenConfig = {}) {
    super();
    this.id = config.id ?? randomUUID();
    this.name = config.name ?? `Swarm-${this.id.slice(0, 8)}`;
    this.config = {
      maxWorkers: config.maxWorkers ?? 8,
      timeout: config.timeout ?? 600000, // 10 minutes
      panes: config.panes ?? true, // Deprecated in visual mode; kept for compatibility.
      sharedMemory: config.sharedMemory ?? true,
    };
    this.visualConfig = resolveVisualConfig(config.visual);
    this.visualSink = config.visualSink ?? (
      this.visualConfig.enabled && this.visualConfig.mode === "events"
        ? new EventStreamVisualOrchestrationSink({
            onEvent: (event) => {
              this.emit("visual:event", event);
            },
          })
        : NOOP_VISUAL_SINK
    );
  }

  private registerWorker(worker: Worker): Worker {
    worker.on("output", (msg: WorkerMessage) => {
      this.emit("worker:output", msg);
      this.emitVisualEvent("worker_output", {
        swarmId: this.id,
        taskId: worker.taskId,
        workerId: worker.id,
        details: { data: msg.data },
      });
    });
    worker.on("complete", (msg) => {
      this.emit("worker:complete", msg);
      this.emitVisualEvent("worker_completed", {
        swarmId: this.id,
        taskId: worker.taskId,
        workerId: worker.id,
        details: { name: worker.name, persona: worker.persona },
      });
    });
    worker.on("error", (msg) => {
      this.emit("worker:error", msg);
      this.emitVisualEvent("worker_failed", {
        swarmId: this.id,
        taskId: worker.taskId,
        workerId: worker.id,
        details: { error: msg.data },
      });
    });
    worker.on("status", (msg) => {
      this.emit("worker:status", msg);
      this.emitVisualEvent("worker_status", {
        swarmId: this.id,
        taskId: worker.taskId,
        workerId: worker.id,
        details: { status: msg.data },
      });
      if (msg.data === "running") {
        this.emitVisualEvent("worker_started", {
          swarmId: this.id,
          taskId: worker.taskId,
          workerId: worker.id,
          details: { name: worker.name, persona: worker.persona },
        });
      }
    });
    worker.on("heartbeat", (msg) => {
      this.emit("worker:heartbeat", msg);
      this.emitVisualEvent("worker_heartbeat", {
        swarmId: this.id,
        taskId: worker.taskId,
        workerId: worker.id,
      });
    });

    this.workers.set(worker.id, worker);
    return worker;
  }

  /**
   * Spawn one worker without resetting queen state.
   * Used by the daemon orchestration control plane.
   */
  async spawnWorker(config: WorkerConfig): Promise<Worker> {
    const active = Array.from(this.workers.values()).filter(
      (worker) => worker.getState().status === "running",
    ).length;
    if (active >= (this.config.maxWorkers ?? 8)) {
      throw new Error(
        `Worker capacity reached (${active}/${this.config.maxWorkers ?? 8})`,
      );
    }

    const worker = this.registerWorker(
      new Worker({
        ...config,
        id: config.id ?? `${this.id}-worker-${Date.now()}`,
      }),
    );
    await worker.start();
    return worker;
  }

  /**
   * Spawn multiple workers in parallel
   */
  async spawn(configs: WorkerConfig[]): Promise<SwarmResult> {
    if (configs.length > (this.config.maxWorkers ?? 8)) {
      throw new Error(`Cannot spawn ${configs.length} workers, max is ${this.config.maxWorkers}`);
    }

    // Reset state for fresh run (in case Queen is reused)
    this.workers.clear();

    this.startedAt = new Date();
    this.completedAt = undefined;
    this.emit("start", { swarmId: this.id, workerCount: configs.length });
    this.emitVisualEvent("swarm_started", {
      swarmId: this.id,
      details: { workerCount: configs.length, mode: this.visualConfig.mode },
    });

    // Create workers
    const workers: Worker[] = configs.map((cfg, index) =>
      this.registerWorker(
        new Worker({
          ...cfg,
          id: cfg.id ?? `${this.id}-worker-${index}`,
        }),
      ),
    );

    // Start all workers in parallel
    await Promise.all(workers.map((w) => w.start()));

    // Set up timeout with proper cleanup
    let timeoutTimer: NodeJS.Timeout | undefined;
    const timeoutPromise = new Promise<void>((_, reject) => {
      timeoutTimer = setTimeout(() => {
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
      // Timeout - abort all workers immediately.
      await this.abortAll();
      throw err;
    } finally {
      if (timeoutTimer) clearTimeout(timeoutTimer);
    }

    this.completedAt = new Date();
    const result = this.getResult();
    this.emit("complete", result);
    this.emitVisualEvent("swarm_completed", {
      swarmId: this.id,
      details: { success: result.success, duration: result.duration },
    });

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
    this.emitVisualEvent("interrupt", {
      swarmId: this.id,
      details: { source: "abort_all" },
    });
  }

  /**
   * Abort a specific worker
   */
  async abort(workerId: string): Promise<void> {
    const worker = this.workers.get(workerId);
    if (worker) {
      await worker.abort();
      this.emitVisualEvent("interrupt", {
        swarmId: this.id,
        taskId: worker.taskId,
        workerId: worker.id,
        details: { source: "abort_worker" },
      });
    }
  }

  private emitVisualEvent(
    type: OrchestrationVisualEvent["type"],
    event: Omit<OrchestrationVisualEvent, "type" | "timestamp">,
  ): void {
    if (!this.visualConfig.enabled) return;
    void this.visualSink.emit({
      type,
      timestamp: Date.now(),
      ...event,
    }).catch(() => {});
  }

  /**
   * Get worker by ID
   */
  getWorker(workerId: string): Worker | undefined {
    return this.workers.get(workerId);
  }

  /**
   * Remove worker from queen registry.
   */
  removeWorker(workerId: string): boolean {
    return this.workers.delete(workerId);
  }

  /**
   * Get all worker states
   */
  getWorkerStates(): WorkerState[] {
    return Array.from(this.workers.values()).map((w) => w.getState());
  }

  /**
   * Number of workers currently running.
   */
  getActiveWorkerCount(): number {
    return this.getWorkerStates().filter((state) => state.status === "running").length;
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

  /**
   * Run consensus vote among workers.
   * Each completed worker's output is considered as context for the vote.
   * Spawns new voter agents to decide on the proposal.
   */
  async consensus(
    proposal: string,
    config?: ConsensusConfig
  ): Promise<ConsensusResult> {
    const threshold = config?.threshold ?? 0.6;
    const timeout = config?.timeout ?? 30000;

    // Vote among all workers (not just non-done ones, as spawn() completes them all)
    const voters = Array.from(this.workers.values());
    if (voters.length === 0) {
      return {
        approved: false,
        votes: new Map(),
        threshold,
        agreement: 0,
      };
    }

    const votes = new Map<string, boolean>();

    // Collect votes with timeout
    const votePromises = voters.map(async (worker) => {
      const workerOutput = worker.getState().output.join("").slice(0, 2000);

      const votePrompt = `
CONSENSUS VOTE REQUIRED

Proposal: ${proposal}

Context from worker "${worker.name}":
${workerOutput}

Based on the context above, vote YES or NO on the proposal.
Respond with exactly one word: YES or NO

Your vote:`.trim();

      try {
        const queen = new Queen({ maxWorkers: 1, panes: false, timeout });
        const result = await queen.spawnOne({
          id: `vote-${worker.id}`,
          name: `Vote-${worker.name}`,
          prompt: votePrompt,
          persona: "zee",
        });

        const output = result.output.join("").trim().toLowerCase();
        // Strict match to avoid false positives like "yesterday"
        const vote = /^yes\b/.test(output);
        votes.set(worker.id, vote);
      } catch {
        votes.set(worker.id, false); // Timeout = no vote
      }
    });

    await Promise.all(votePromises);

    const yesCount = Array.from(votes.values()).filter((v) => v).length;
    const agreement = votes.size > 0 ? yesCount / votes.size : 0;
    const approved = agreement >= threshold;

    this.emit("consensus", { proposal, approved, agreement, votes });

    return {
      approved,
      votes,
      threshold,
      agreement,
    };
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
