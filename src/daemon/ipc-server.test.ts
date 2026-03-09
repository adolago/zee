import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { requestDaemon } from "./ipc-client";
import { DaemonServer } from "./ipc-server";
import { resolveDaemonAgent } from "./types";
import type {
  ListEventsResult,
  RunTaskParams,
  SpawnDroneParams,
  SubmitTaskParams,
  TaskInfo,
  TaskRunResult,
  WorkerInfo,
} from "./types";

class FakeOrchestrator {
  workers: WorkerInfo[] = [];
  tasks: TaskInfo[] = [];
  events: ListEventsResult["events"] = [];
  shutdownCalls = 0;
  lastSpawn?: SpawnDroneParams;
  lastSubmit?: SubmitTaskParams;

  async spawnDrone(params: SpawnDroneParams): Promise<WorkerInfo> {
    this.lastSpawn = params;
    const worker: WorkerInfo = {
      id: "worker-1",
      name: "zee-test",
      agent: resolveDaemonAgent(params) ?? "zee",
      taskId: params.taskId ?? "task-1",
      pid: 12345,
      attempt: 1,
      status: "running",
      startedAt: new Date().toISOString(),
      lastHeartbeatAt: new Date().toISOString(),
    };
    this.workers = [worker];
    return worker;
  }

  async submitTask(params: SubmitTaskParams): Promise<TaskInfo> {
    this.lastSubmit = params;
    const task: TaskInfo = {
      id: params.taskId ?? "task-1",
      description: params.description,
      agent: resolveDaemonAgent(params) ?? "zee",
      status: "pending",
      priority: params.priority ?? 0,
      attempt: 0,
      createdAt: new Date().toISOString(),
      enqueuedAt: new Date().toISOString(),
    };
    this.tasks = [task];
    return task;
  }

  async runTask(params: RunTaskParams): Promise<TaskRunResult> {
    const task = await this.submitTask({
      ...params,
      description: params.description ?? "run task",
    });
    const completed: TaskInfo = {
      ...task,
      status: "completed",
      attempt: 1,
      workerId: "worker-1",
      startedAt: new Date().toISOString(),
      endedAt: new Date().toISOString(),
    };
    this.tasks = [completed];
    return {
      task: completed,
      output: [
        `session_id: ${completed.id}`,
        "",
        "<task_result>",
        "done",
        "</task_result>",
      ].join("\n"),
    };
  }

  listWorkers(): WorkerInfo[] {
    return this.workers;
  }

  listTasks(): TaskInfo[] {
    return this.tasks;
  }

  async killWorker(workerId: string): Promise<boolean> {
    this.workers = this.workers.map((worker) =>
      worker.id === workerId
        ? {
            ...worker,
            status: "aborted",
            completedAt: new Date().toISOString(),
          }
        : worker,
    );
    return true;
  }

  listEvents(cursor = 0, limit = 100): ListEventsResult {
    const events = this.events
      .filter((event) => event.id > cursor)
      .slice(0, limit);
    return {
      events,
      nextCursor: events.length > 0 ? events[events.length - 1].id : cursor,
    };
  }

  getSnapshot() {
    return {
      queueDepth: 2,
      activeWorkers: this.workers.filter((worker) => worker.status === "running").length,
      workers: this.workers.length,
      tasks: this.tasks.length,
      draining: false,
    };
  }

  async shutdown(): Promise<void> {
    this.shutdownCalls += 1;
  }
}

describe("DaemonServer IPC orchestration handlers", () => {
  let socketDir = "";
  let socketPath = "";
  let server: DaemonServer;
  let orchestrator: FakeOrchestrator;

  beforeEach(async () => {
    socketDir = await mkdtemp(join(tmpdir(), "zee-daemon-test-"));
    socketPath = join(socketDir, "daemon.sock");
    orchestrator = new FakeOrchestrator();
    orchestrator.events = [
      {
        id: 1,
        type: "agent_start",
        timestamp: Date.now(),
        taskId: "task-1",
      },
      {
        id: 2,
        type: "turn_end",
        timestamp: Date.now(),
        taskId: "task-1",
      },
    ];
    server = new DaemonServer({
      socketPath,
      orchestrator,
      version: "test-version",
    });
    await server.start();
  });

  afterEach(async () => {
    await server.stop();
    await rm(socketDir, { recursive: true, force: true });
  });

  test("status includes orchestration snapshot fields", async () => {
    const status = await requestDaemon<undefined, {
      version: string;
      queueDepth: number;
      activeWorkers: number;
      workers: number;
      tasks: number;
      draining: boolean;
    }>("status", undefined, { socketPath });

    expect(status.version).toBe("test-version");
    expect(status.queueDepth).toBe(2);
    expect(status.activeWorkers).toBe(0);
    expect(status.workers).toBe(0);
    expect(status.tasks).toBe(0);
    expect(status.draining).toBe(false);
  });

  test("spawn_drone delegates to orchestrator", async () => {
    const worker = await requestDaemon<SpawnDroneParams, WorkerInfo>(
      "spawn_drone",
      {
        agent: "zee",
        description: "Run a quick check",
        prompt: "Say hello",
      },
      { socketPath },
    );

    expect(worker.id).toBe("worker-1");
    expect(worker.taskId).toBe("task-1");
    expect(orchestrator.lastSpawn?.description).toBe("Run a quick check");
  });

  test("submit_task, list_tasks, kill_worker and list_events are wired", async () => {
    const task = await requestDaemon<SubmitTaskParams, TaskInfo>(
      "submit_task",
      {
        agent: "zee",
        description: "Portfolio check",
        prompt: "Analyze holdings",
        priority: 5,
      },
      { socketPath },
    );
    expect(task.description).toBe("Portfolio check");
    expect(task.priority).toBe(5);
    expect(task.agent).toBe("zee");

    const tasks = await requestDaemon<undefined, TaskInfo[]>(
      "list_tasks",
      undefined,
      { socketPath },
    );
    expect(tasks).toHaveLength(1);
    expect(tasks[0].agent).toBe("zee");

    await requestDaemon<SpawnDroneParams, WorkerInfo>(
      "spawn_drone",
      {
        agent: "zee",
        description: "Spawn for kill test",
        prompt: "noop",
      },
      { socketPath },
    );

    const kill = await requestDaemon<{ workerId: string }, { killed: boolean }>(
      "kill_worker",
      { workerId: "worker-1" },
      { socketPath },
    );
    expect(kill.killed).toBe(true);

    const workers = await requestDaemon<undefined, WorkerInfo[]>(
      "list_workers",
      undefined,
      { socketPath },
    );
    expect(workers[0].status).toBe("aborted");

    const events = await requestDaemon<{ cursor: number; limit: number }, ListEventsResult>(
      "list_events",
      { cursor: 0, limit: 10 },
      { socketPath },
    );
    expect(events.events).toHaveLength(2);
    expect(events.nextCursor).toBe(2);
  });

  test("run_task returns completed task output", async () => {
    const run = await requestDaemon<RunTaskParams, TaskRunResult>(
      "run_task",
      {
        agent: "zee",
        description: "Teach concept",
        prompt: "Explain compounding",
      },
      { socketPath },
    );

    expect(run.task.status).toBe("completed");
    expect(run.task.attempt).toBe(1);
    expect(run.output).toContain("<task_result>");
    expect(orchestrator.lastSubmit?.description).toBe("Teach concept");
  });
});
