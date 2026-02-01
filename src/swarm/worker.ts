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
    this.process = spawn(
      "agent-core",
      ["prompt", "--agent", this.persona, "--no-tui", this.prompt],
      {
        stdio: ["pipe", "pipe", "pipe"],
        env: {
          ...process.env,
          AGENT_CORE_WORKER_ID: this.id,
          AGENT_CORE_WORKER_NAME: this.name,
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
   * Abort the worker
   */
  async abort(): Promise<void> {
    if (this.process && this.status === "running") {
      this.status = "aborted";
      this.process.kill("SIGTERM");
      
      // Force kill after 5s
      setTimeout(() => {
        if (this.process && !this.process.killed) {
          this.process.kill("SIGKILL");
        }
      }, 5000);
    }
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
   * Wait for worker to complete
   */
  async wait(): Promise<WorkerState> {
    if (this.isDone()) {
      return this.getState();
    }

    return new Promise((resolve) => {
      const handler = () => {
        this.removeListener("complete", handler);
        this.removeListener("error", handler);
        resolve(this.getState());
      };
      this.on("complete", handler);
      this.on("error", handler);
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
