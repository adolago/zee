/**
 * Daemon orchestration control plane.
 *
 * Centralizes task queueing, worker spawning, lifecycle events, and status tracking.
 */

import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import { resolveDaemonAgent } from "../daemon/types";
import type {
  DaemonAgent,
  ListEventsResult,
  RunTaskParams,
  SpawnDroneParams,
  SubmitTaskParams,
  TaskInfo,
  TaskRunResult,
  WorkerInfo,
} from "../daemon/types";
import type { OrchestrationEvent } from "./events";
import { Queen } from "./queen";
import { TaskQueue } from "./queue";
import type { QueueSettings, QueuedTask } from "./queue";
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

interface OrchestratorTask extends QueuedTask {
  agent: DaemonAgent;
  status: "pending" | "running" | "completed" | "failed" | "aborted";
  workerId?: string;
  timeoutMs: number;
  parentSessionId?: string;
  parentMessageId?: string;
  attempt: number;
  error?: string;
  createdAt: number;
  startedAt?: number;
  endedAt?: number;
  lastHeartbeatAt?: number;
}

export interface OrchestratorOptions {
  maxWorkers?: number;
  defaultTimeoutMs?: number;
  queue?: QueueSettings;
  panes?: boolean;
  maxEventHistory?: number;
  visual?: OrchestrationVisualConfig;
  visualSink?: VisualOrchestrationSink;
}

export interface OrchestratorSnapshot {
  queueDepth: number;
  activeWorkers: number;
  workers: number;
  tasks: number;
  draining: boolean;
}

export class Orchestrator extends EventEmitter {
  private readonly queen: Queen;
  private readonly queue: TaskQueue<QueuedTask>;
  private readonly maxWorkers: number;
  private readonly defaultTimeoutMs: number;
  private readonly maxEventHistory: number;
  private readonly visualConfig: ResolvedOrchestrationVisualConfig;
  private readonly visualSink: VisualOrchestrationSink;

  private readonly tasks = new Map<string, OrchestratorTask>();
  private readonly workerToTask = new Map<string, string>();
  private events: OrchestrationEvent[] = [];
  private eventID = 0;

  private draining = false;
  private drainScheduled = false;

  constructor(options: OrchestratorOptions = {}) {
    super();
    this.maxWorkers = options.maxWorkers ?? 8;
    this.defaultTimeoutMs = options.defaultTimeoutMs ?? 300_000;
    this.maxEventHistory = Math.max(200, options.maxEventHistory ?? 2_000);
    this.visualConfig = resolveVisualConfig(options.visual);
    this.visualSink = options.visualSink ?? (
      this.visualConfig.enabled && this.visualConfig.mode === "events"
        ? new EventStreamVisualOrchestrationSink({
            onEvent: (event) => {
              this.emit("visual:event", event);
            },
          })
        : NOOP_VISUAL_SINK
    );

    this.queen = new Queen({
      maxWorkers: this.maxWorkers,
      panes: options.panes ?? false,
      timeout: this.defaultTimeoutMs,
      visual: this.visualConfig,
      visualSink: this.visualSink,
    });
    this.queue = new TaskQueue<QueuedTask>({
      mode: options.queue?.mode ?? "parallel",
      cap: options.queue?.cap ?? 20,
      dropPolicy: options.queue?.dropPolicy ?? "summarize",
      dedupeMode: options.queue?.dedupeMode ?? "task-id",
      summaryLimit: options.queue?.summaryLimit ?? 20,
    });

    this.bindQueenEvents();
  }

  async spawnDrone(params: SpawnDroneParams): Promise<WorkerInfo> {
    const existingTask = params.taskId ? this.tasks.get(params.taskId.trim()) : undefined;
    const task = this.getOrCreateTask({
      taskId: params.taskId,
      agent: resolveDaemonAgent(params) ?? "zee",
      description: params.description,
      prompt: params.prompt,
      parentSessionId: params.parentSessionId,
      parentMessageId: params.parentMessageId,
      timeoutMs: params.timeoutMs,
      priority: params.priority,
    });

    if (existingTask && task.workerId && task.status === "running") {
      const existing = this.getWorkerInfo(task.workerId);
      if (existing) return existing;
    }

    if (this.queen.getActiveWorkerCount() >= this.maxWorkers) {
      throw new Error(
        `No worker capacity available (${this.queen.getActiveWorkerCount()}/${this.maxWorkers})`,
      );
    }

    await this.startTask(task);
    if (!task.workerId) {
      throw new Error(`Failed to spawn worker for task ${task.id}`);
    }

    const worker = this.getWorkerInfo(task.workerId);
    if (!worker) {
      throw new Error(`Spawned worker ${task.workerId} is not available`);
    }
    return worker;
  }

  async runTask(params: RunTaskParams): Promise<TaskRunResult> {
    const worker = await this.spawnDrone(params);
    const taskId = worker.taskId ?? params.taskId;
    if (!taskId) {
      throw new Error("run_task could not resolve task id");
    }

    const timeoutMs = params.waitTimeoutMs ?? params.timeoutMs ?? this.defaultTimeoutMs;
    const task = await this.waitForTaskTerminal(taskId, timeoutMs);
    const taskInfo = this.toTaskInfo(task);
    const output = this.buildTaskOutput(task);

    if (task.status === "failed" || task.status === "aborted") {
      throw new Error(
        `Task ${task.id} finished with status "${task.status}"${task.error ? `: ${task.error}` : ""}`,
      );
    }

    return {
      task: taskInfo,
      output,
    };
  }

  async submitTask(params: SubmitTaskParams): Promise<TaskInfo> {
    const existingTask = params.taskId ? this.tasks.get(params.taskId.trim()) : undefined;
    const task = this.getOrCreateTask({
      taskId: params.taskId,
      agent: resolveDaemonAgent(params) ?? "zee",
      description: params.description,
      prompt: params.prompt,
      parentSessionId: params.parentSessionId,
      parentMessageId: params.parentMessageId,
      timeoutMs: params.timeoutMs,
      priority: params.priority,
    });

    if (existingTask && (task.status === "running" || task.status === "pending")) {
      return this.toTaskInfo(task);
    }

    task.status = "pending";
    task.enqueuedAt = Date.now();
    task.startedAt = undefined;
    task.endedAt = undefined;
    task.error = undefined;
    task.workerId = undefined;

    const enqueueResult = this.queue.enqueue({
      id: task.id,
      description: task.description,
      prompt: task.prompt,
      priority: task.priority,
      enqueuedAt: task.enqueuedAt,
    });

    for (const dropped of enqueueResult.dropped) {
      const droppedTask = this.tasks.get(dropped.id);
      if (!droppedTask) continue;
      droppedTask.status = "failed";
      droppedTask.error = "Dropped due to queue cap";
      droppedTask.endedAt = Date.now();
    }

    if (enqueueResult.dropped.length > 0) {
      this.emitOrchestrationEvent("queue_overflow", {
        details: {
          droppedTaskIds: enqueueResult.dropped.map((item) => item.id),
          droppedCount: enqueueResult.dropped.length,
          summary: this.queue.consumeSummary("task"),
        },
      });
      this.emitVisualEvent("queue_overflow", {
        swarmId: this.queen.id,
        taskId: task.id,
        details: {
          droppedTaskIds: enqueueResult.dropped.map((item) => item.id),
          droppedCount: enqueueResult.dropped.length,
        },
      });
    }

    if (!enqueueResult.enqueued && !enqueueResult.deduped) {
      task.status = "failed";
      task.error = "Queue is full and drop policy is set to reject new tasks";
      task.endedAt = Date.now();
      this.emitOrchestrationEvent("queue_overflow", {
        taskId: task.id,
        details: { reason: "new-task-rejected", cap: this.queue.state.cap },
      });
      this.emitVisualEvent("queue_overflow", {
        swarmId: this.queen.id,
        taskId: task.id,
        details: { reason: "new-task-rejected", cap: this.queue.state.cap },
      });
      return this.toTaskInfo(task);
    }

    this.emitOrchestrationEvent("message_start", {
      taskId: task.id,
      details: { description: task.description, priority: task.priority },
    });
    this.emitVisualEvent("task_enqueued", {
      swarmId: this.queen.id,
      taskId: task.id,
      details: {
        description: task.description,
        priority: task.priority,
        enqueued: enqueueResult.enqueued,
        deduped: enqueueResult.deduped,
      },
    });
    this.scheduleDrain();
    return this.toTaskInfo(task);
  }

  listWorkers(): WorkerInfo[] {
    const workers = this.queen
      .getWorkerStates()
      .map((state) => {
        const taskId = this.workerToTask.get(state.id) ?? state.taskId;
        if (!taskId) return undefined;
        const task = this.tasks.get(taskId);
        if (!task) return undefined;
        return this.toWorkerInfo(state.id, task, state.pid);
      })
      .filter((item): item is WorkerInfo => Boolean(item));

    workers.sort((a, b) => {
      const aStarted = a.startedAt ? Date.parse(a.startedAt) : 0;
      const bStarted = b.startedAt ? Date.parse(b.startedAt) : 0;
      return bStarted - aStarted;
    });
    return workers;
  }

  listTasks(): TaskInfo[] {
    return Array.from(this.tasks.values())
      .map((task) => this.toTaskInfo(task))
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  }

  async killWorker(workerId: string): Promise<boolean> {
    const worker = this.queen.getWorker(workerId);
    if (!worker) return false;

    const taskId = this.workerToTask.get(workerId);
    if (taskId) {
      const task = this.tasks.get(taskId);
      if (task && task.status === "running") {
        task.status = "aborted";
        task.error = "Worker aborted by daemon command";
        task.endedAt = Date.now();
      }
    }

    await this.queen.abort(workerId);
    this.activeCleanup(workerId);
    this.scheduleDrain();
    this.emitOrchestrationEvent("interrupt", {
      taskId: taskId,
      workerId,
      details: { source: "kill_worker" },
    });
    this.emitVisualEvent("interrupt", {
      swarmId: this.queen.id,
      taskId,
      workerId,
      details: { source: "kill_worker" },
    });
    return true;
  }

  listEvents(cursor = 0, limit = 100): ListEventsResult {
    const safeLimit = Math.max(1, Math.min(limit, 1000));
    const events = this.events
      .filter((event) => event.id > cursor)
      .slice(0, safeLimit);
    const nextCursor = events.length > 0 ? events[events.length - 1].id : cursor;
    return { events, nextCursor };
  }

  getSnapshot(): OrchestratorSnapshot {
    return {
      queueDepth: this.queue.size,
      activeWorkers: this.queen.getActiveWorkerCount(),
      workers: this.queen.getWorkerStates().length,
      tasks: this.tasks.size,
      draining: this.draining,
    };
  }

  async shutdown(): Promise<void> {
    await this.queen.abortAll();
    const drained = this.queue.clear();
    for (const item of drained) {
      const task = this.tasks.get(item.id);
      if (!task) continue;
      task.status = "aborted";
      task.error = "Daemon shutdown";
      task.endedAt = Date.now();
    }
    this.emitOrchestrationEvent("interrupt", { details: { source: "shutdown" } });
    this.emitVisualEvent("shutdown", {
      swarmId: this.queen.id,
      details: { source: "shutdown" },
    });
  }

  private bindQueenEvents(): void {
    this.queen.on("worker:heartbeat", (msg: { workerId: string }) => {
      const taskId = this.workerToTask.get(msg.workerId);
      if (!taskId) return;
      const task = this.tasks.get(taskId);
      if (!task) return;
      task.lastHeartbeatAt = Date.now();
      this.emitOrchestrationEvent("worker_heartbeat", {
        taskId,
        workerId: msg.workerId,
      });
    });

    this.queen.on("worker:status", (msg: { workerId: string; data: string }) => {
      if (msg.data !== "aborted") return;
      const taskId = this.workerToTask.get(msg.workerId);
      if (!taskId) return;
      const task = this.tasks.get(taskId);
      if (!task) return;
      task.status = "aborted";
      task.error = task.error ?? "Worker aborted";
      task.endedAt = Date.now();
      this.emitOrchestrationEvent("interrupt", {
        taskId,
        workerId: msg.workerId,
      });
      this.emitVisualEvent("task_finished", {
        swarmId: this.queen.id,
        taskId,
        workerId: msg.workerId,
        details: { status: "aborted", error: task.error },
      });
    });

    this.queen.on("worker:error", (msg: { workerId: string; data: string }) => {
      const taskId = this.workerToTask.get(msg.workerId);
      if (!taskId) return;
      const task = this.tasks.get(taskId);
      if (!task) return;
      task.status = "failed";
      task.error = msg.data;
      task.endedAt = Date.now();
      this.activeCleanup(msg.workerId);
      this.emitOrchestrationEvent("turn_end", {
        taskId,
        workerId: msg.workerId,
        details: { status: "failed", error: msg.data },
      });
      this.emitOrchestrationEvent("agent_end", {
        taskId,
        workerId: msg.workerId,
        details: { status: "failed" },
      });
      this.emitVisualEvent("task_finished", {
        swarmId: this.queen.id,
        taskId,
        workerId: msg.workerId,
        details: { status: "failed", error: msg.data },
      });
      this.scheduleDrain();
    });

    this.queen.on("worker:complete", (msg: { workerId: string }) => {
      const taskId = this.workerToTask.get(msg.workerId);
      if (!taskId) return;
      const task = this.tasks.get(taskId);
      if (!task) return;

      if (task.status !== "aborted" && task.status !== "failed") {
        task.status = "completed";
      }
      task.endedAt = Date.now();
      this.activeCleanup(msg.workerId);
      this.emitOrchestrationEvent("turn_end", {
        taskId,
        workerId: msg.workerId,
        details: { status: task.status },
      });
      this.emitOrchestrationEvent("agent_end", {
        taskId,
        workerId: msg.workerId,
        details: { status: task.status },
      });
      this.emitVisualEvent("task_finished", {
        swarmId: this.queen.id,
        taskId,
        workerId: msg.workerId,
        details: { status: task.status },
      });
      this.scheduleDrain();
    });
  }

  private activeCleanup(workerId: string): void {
    this.workerToTask.delete(workerId);
  }

  private scheduleDrain(): void {
    if (this.drainScheduled) return;
    this.drainScheduled = true;
    setImmediate(() => {
      this.drainScheduled = false;
      void this.drainQueue();
    });
  }

  private async drainQueue(): Promise<void> {
    if (this.draining) return;
    this.draining = true;

    try {
      while (
        this.queue.size > 0 &&
        this.queen.getActiveWorkerCount() < this.maxWorkers
      ) {
        const next = this.queue.dequeue();
        if (!next) break;
        const task = this.tasks.get(next.id);
        if (!task || task.status !== "pending") continue;
        try {
          await this.startTask(task);
        } catch (error) {
          this.emit("error", error);
        }
      }
    } finally {
      this.draining = false;
      if (this.queue.size > 0 && this.queen.getActiveWorkerCount() < this.maxWorkers) {
        this.scheduleDrain();
      }
    }
  }

  private async startTask(task: OrchestratorTask): Promise<void> {
    task.attempt += 1;
    task.status = "running";
    task.startedAt = Date.now();
    task.endedAt = undefined;
    task.error = undefined;

    const workerId = `worker-${task.id}-${task.attempt}`;
    task.workerId = workerId;

    this.emitOrchestrationEvent("agent_start", {
      taskId: task.id,
      workerId,
      sessionId: task.parentSessionId,
      details: { agent: task.agent, attempt: task.attempt },
    });
    this.emitOrchestrationEvent("turn_start", {
      taskId: task.id,
      workerId,
      sessionId: task.parentSessionId,
    });
    this.emitVisualEvent("task_started", {
      swarmId: this.queen.id,
      taskId: task.id,
      workerId,
      details: {
        agent: task.agent,
        attempt: task.attempt,
        description: task.description,
      },
    });

    try {
      const worker = await this.queen.spawnWorker({
        id: workerId,
        name: `${task.agent}-${task.description}`,
        prompt: task.prompt,
        agent: task.agent,
        taskId: task.id,
        timeoutMs: task.timeoutMs,
        attempt: task.attempt,
      });
      this.workerToTask.set(worker.id, task.id);
      task.workerId = worker.id;
      task.lastHeartbeatAt = Date.now();
      this.emitOrchestrationEvent("tool_execution_update", {
        taskId: task.id,
        workerId: worker.id,
        details: { status: "running" },
      });
    } catch (error) {
      task.status = "failed";
      task.error = error instanceof Error ? error.message : String(error);
      task.endedAt = Date.now();
      this.emitOrchestrationEvent("turn_end", {
        taskId: task.id,
        workerId,
        details: { status: "failed", error: task.error },
      });
      this.emitOrchestrationEvent("agent_end", {
        taskId: task.id,
        workerId,
        details: { status: "failed" },
      });
      this.emitVisualEvent("task_finished", {
        swarmId: this.queen.id,
        taskId: task.id,
        workerId,
        details: { status: "failed", error: task.error },
      });
      throw error;
    }
  }

  private getOrCreateTask(input: {
    taskId?: string;
    agent: DaemonAgent;
    description?: string;
    prompt: string;
    parentSessionId?: string;
    parentMessageId?: string;
    timeoutMs?: number;
    priority?: number;
  }): OrchestratorTask {
    const now = Date.now();
    const taskId = input.taskId?.trim() || randomUUID();
    const existing = this.tasks.get(taskId);
    const description = this.normalizeDescription(input.description);
    const priority = Number.isFinite(input.priority) ? Number(input.priority) : 0;

    if (existing) {
      // Rehydrate for a resumed attempt.
      if (existing.status === "completed" || existing.status === "failed" || existing.status === "aborted") {
        existing.status = "pending";
      }
      existing.description = description || existing.description;
      existing.prompt = input.prompt || existing.prompt;
      existing.agent = input.agent ?? existing.agent;
      existing.parentSessionId = input.parentSessionId ?? existing.parentSessionId;
      existing.parentMessageId = input.parentMessageId ?? existing.parentMessageId;
      existing.priority = priority;
      existing.timeoutMs = input.timeoutMs ?? existing.timeoutMs;
      existing.enqueuedAt = now;
      existing.endedAt = undefined;
      existing.error = undefined;
      return existing;
    }

    const created: OrchestratorTask = {
      id: taskId,
      agent: input.agent,
      description,
      prompt: input.prompt,
      priority,
      enqueuedAt: now,
      createdAt: now,
      timeoutMs: input.timeoutMs ?? this.defaultTimeoutMs,
      parentSessionId: input.parentSessionId,
      parentMessageId: input.parentMessageId,
      status: "pending",
      attempt: 0,
    };
    this.tasks.set(created.id, created);
    return created;
  }

  private getWorkerInfo(workerId: string): WorkerInfo | undefined {
    const worker = this.queen.getWorker(workerId);
    if (!worker) return undefined;
    const state = worker.getState();
    const taskId = this.workerToTask.get(workerId) ?? state.taskId;
    if (!taskId) return undefined;
    const task = this.tasks.get(taskId);
    if (!task) return undefined;
    return this.toWorkerInfo(workerId, task, state.pid);
  }

  private toWorkerInfo(workerId: string, task: OrchestratorTask, pid?: number): WorkerInfo {
    const worker = this.queen.getWorker(workerId);
    const state = worker?.getState();
    const fallbackStatus =
      task.status === "pending" ? "idle" : task.status;
    return {
      id: workerId,
      name: worker?.name ?? `${task.agent}-${task.description}`,
      agent: task.agent,
      taskId: task.id,
      pid,
      attempt: task.attempt,
      status: state?.status ?? fallbackStatus,
      startedAt: task.startedAt ? new Date(task.startedAt).toISOString() : undefined,
      completedAt: task.endedAt ? new Date(task.endedAt).toISOString() : undefined,
      lastHeartbeatAt: task.lastHeartbeatAt
        ? new Date(task.lastHeartbeatAt).toISOString()
        : undefined,
    };
  }

  private toTaskInfo(task: OrchestratorTask): TaskInfo {
    return {
      id: task.id,
      description: task.description,
      agent: task.agent,
      status: task.status,
      priority: task.priority,
      attempt: task.attempt,
      error: task.error,
      workerId: task.workerId,
      parentSessionId: task.parentSessionId,
      parentMessageId: task.parentMessageId,
      createdAt: new Date(task.createdAt).toISOString(),
      enqueuedAt: new Date(task.enqueuedAt).toISOString(),
      startedAt: task.startedAt ? new Date(task.startedAt).toISOString() : undefined,
      endedAt: task.endedAt ? new Date(task.endedAt).toISOString() : undefined,
    };
  }

  private async waitForTaskTerminal(taskId: string, timeoutMs: number): Promise<OrchestratorTask> {
    const startedAt = Date.now();

    while (true) {
      const task = this.tasks.get(taskId);
      if (!task) {
        throw new Error(`Task ${taskId} no longer exists`);
      }
      if (task.status === "completed" || task.status === "failed" || task.status === "aborted") {
        return task;
      }
      if (Date.now() - startedAt > timeoutMs) {
        throw new Error(`Timed out waiting for task ${taskId} after ${timeoutMs}ms`);
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  private buildTaskOutput(task: OrchestratorTask): string {
    const workerOutput =
      task.workerId && this.queen.getWorker(task.workerId)
        ? this.queen.getWorker(task.workerId)!.getState().output.join("").trim()
        : "";

    const resultBody = workerOutput || task.error || "";
    return [
      `session_id: ${task.id}`,
      "",
      "<task_result>",
      resultBody,
      "</task_result>",
    ].join("\n");
  }

  private normalizeDescription(raw?: string): string {
    const text = raw?.trim();
    if (!text) return "ad-hoc task";
    return text.length > 80 ? `${text.slice(0, 77).trimEnd()}...` : text;
  }

  private emitOrchestrationEvent(
    type: OrchestrationEvent["type"],
    input: Omit<OrchestrationEvent, "id" | "type" | "timestamp"> = {},
  ): void {
    const event: OrchestrationEvent = {
      id: ++this.eventID,
      type,
      timestamp: Date.now(),
      runId: input.runId,
      sessionId: input.sessionId,
      taskId: input.taskId,
      workerId: input.workerId,
      details: input.details,
    };
    this.events.push(event);
    if (this.events.length > this.maxEventHistory) {
      this.events = this.events.slice(-this.maxEventHistory);
    }
    this.emit("event", event);
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
}
