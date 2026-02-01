/**
 * Swarm Worker
 * Persistent worker that receives tasks and streams output
 */

import { spawn, ChildProcess } from "child_process";
import { EventEmitter } from "events";
import { WorkerConfig, WorkerState, WorkerStatus, WorkerMessage } from "./types";

export class Worker extends EventEmitter {
  readonly id: string;
  readonly name: string;
  readonly prompt: string;
  readonly persona: "zee" | "stanley" | "johny";

  private process: ChildProcess | null = null;
  private output: string[] = [];
  private status: WorkerStatus = "idle";
  private startedAt?: Date;
  private completedAt?: Date;
  private error?: string;

  constructor(config: WorkerConfig) {
    super();
    this.id = config.id;
    this.name = config.name;
    this.prompt = config.prompt;
    this.persona = config.persona ?? "zee";
  }

  /**
   * Start the worker with the configured prompt
   */
  async start(): Promise<void> {
    if (this.status === "running") {
      throw new Error(`Worker ${this.id} is already running`);
    }

    this.status = "running";
    this.startedAt = new Date();
    this.output = [];
    this.error = undefined;

    // Spawn agent-core with the prompt
    // Uses daemon API to create a session and stream output
    // Persona identity flows to subagent (mini-persona pattern)
    this.process = spawn(
      "agent-core",
      ["prompt", "--agent", this.persona, "--no-tui", this.prompt],
      {
        stdio: ["pipe", "pipe", "pipe"],
        env: {
          ...process.env,
          AGENT_CORE_WORKER_ID: this.id,
          AGENT_CORE_WORKER_NAME: this.name,
          AGENT_CORE_PERSONA: this.persona,
          // Subagent inherits parent persona identity
          AGENT_CORE_IS_SUBAGENT: "true",
        },
      }
    );

    this.process.stdout?.on("data", (data) => {
      const text = data.toString();
      this.output.push(text);
      this.emit("output", this.createMessage("output", text));
    });

    this.process.stderr?.on("data", (data) => {
      const text = data.toString();
      this.output.push(`[stderr] ${text}`);
      this.emit("output", this.createMessage("output", `[stderr] ${text}`));
    });

    this.process.on("close", (code) => {
      this.completedAt = new Date();

      // Preserve aborted status - don't overwrite with completed/failed
      if (this.status === "aborted") {
        this.emit("complete", this.createMessage("complete", this.output.join("")));
        return;
      }

      if (code === 0) {
        this.status = "completed";
        this.emit("complete", this.createMessage("complete", this.output.join("")));
      } else {
        this.status = "failed";
        this.error = `Process exited with code ${code}`;
        this.emit("error", this.createMessage("error", this.error));
      }
    });

    this.process.on("error", (err) => {
      this.status = "failed";
      this.error = err.message;
      this.completedAt = new Date();
      this.emit("error", this.createMessage("error", err.message));
    });

    this.emit("status", this.createMessage("status", "running"));
  }

  /**
   * Abort the worker.
   * Returns a promise that resolves when the process actually terminates.
   */
  async abort(): Promise<void> {
    if (!this.process || this.status !== "running") {
      return;
    }

    this.status = "aborted";
    this.emit("status", this.createMessage("status", "aborted"));

    const proc = this.process;

    return new Promise<void>((resolve) => {
      const onClose = () => {
        clearTimeout(forceKillTimer);
        resolve();
      };

      proc.once("close", onClose);
      proc.kill("SIGTERM");

      // Force kill after 5s if SIGTERM doesn't work
      const forceKillTimer = setTimeout(() => {
        if (!proc.killed) {
          proc.kill("SIGKILL");
        }
      }, 5000);
    });
  }

  /**
   * Get current state
   */
  getState(): WorkerState {
    return {
      id: this.id,
      status: this.status,
      output: this.output,
      startedAt: this.startedAt,
      completedAt: this.completedAt,
      error: this.error,
    };
  }

  /**
   * Check if worker is done
   */
  isDone(): boolean {
    return ["completed", "failed", "aborted"].includes(this.status);
  }

  /**
   * Wait for worker to complete.
   * Resolves on complete, error, or abort.
   */
  async wait(): Promise<WorkerState> {
    if (this.isDone()) {
      return this.getState();
    }

    return new Promise((resolve) => {
      const handler = () => {
        cleanup();
        resolve(this.getState());
      };

      const statusHandler = (msg: WorkerMessage) => {
        if (msg.data === "aborted") {
          handler();
        }
      };

      const cleanup = () => {
        this.removeListener("complete", handler);
        this.removeListener("error", handler);
        this.removeListener("status", statusHandler);
        if (this.process) {
          this.process.removeListener("close", handler);
        }
      };

      this.on("complete", handler);
      this.on("error", handler);
      this.on("status", statusHandler);
      // Also listen on process close as a fallback
      this.process?.once("close", handler);
    });
  }

  private createMessage(type: WorkerMessage["type"], data: string): WorkerMessage {
    return {
      type,
      workerId: this.id,
      data,
      timestamp: new Date(),
    };
  }
}
