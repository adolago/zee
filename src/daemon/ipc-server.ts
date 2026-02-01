/**
 * Daemon IPC Server
 *
 * Listens on Unix socket and handles incoming commands.
 */

import { createServer, Server, Socket } from "node:net";
import { mkdirSync, unlinkSync, existsSync } from "node:fs";
import { dirname } from "node:path";
import { EventEmitter } from "node:events";
import type {
  DaemonCommand,
  DaemonRequest,
  DaemonResponse,
  DaemonStatus,
  WorkerInfo,
  TaskInfo,
  SpawnDroneParams,
  SubmitTaskParams,
  KillWorkerParams,
} from "./types";
import { DEFAULT_SOCKET_PATH } from "./types";

type CommandHandler<TParams = unknown, TResult = unknown> = (
  params: TParams
) => Promise<TResult>;

/**
 * Daemon IPC Server
 *
 * Handles incoming connections and routes commands to handlers.
 */
export class DaemonServer extends EventEmitter {
  private server: Server | null = null;
  private socketPath: string;
  private startedAt: Date;
  private handlers: Map<DaemonCommand, CommandHandler> = new Map();

  constructor(socketPath?: string) {
    super();
    this.socketPath =
      socketPath || process.env.AGENT_CORE_IPC_SOCKET || DEFAULT_SOCKET_PATH;
    this.startedAt = new Date();

    // Register default handlers
    this.registerDefaultHandlers();
  }

  /**
   * Start listening on the Unix socket.
   */
  async start(): Promise<void> {
    // Ensure socket directory exists
    const socketDir = dirname(this.socketPath);
    mkdirSync(socketDir, { recursive: true });

    // Remove stale socket file
    if (existsSync(this.socketPath)) {
      try {
        unlinkSync(this.socketPath);
      } catch {
        // Ignore - might be in use
      }
    }

    return new Promise((resolve, reject) => {
      this.server = createServer((socket) => this.handleConnection(socket));

      this.server.on("error", (err) => {
        this.emit("error", err);
        reject(err);
      });

      this.server.listen(this.socketPath, () => {
        this.emit("listening", this.socketPath);
        resolve();
      });
    });
  }

  /**
   * Stop the server and cleanup.
   */
  async stop(): Promise<void> {
    return new Promise((resolve) => {
      if (!this.server) {
        resolve();
        return;
      }

      this.server.close(() => {
        // Clean up socket file
        try {
          if (existsSync(this.socketPath)) {
            unlinkSync(this.socketPath);
          }
        } catch {
          // Ignore cleanup errors
        }

        this.server = null;
        this.emit("closed");
        resolve();
      });
    });
  }

  /**
   * Register a command handler.
   */
  handle<TParams = unknown, TResult = unknown>(
    command: DaemonCommand,
    handler: CommandHandler<TParams, TResult>
  ): void {
    this.handlers.set(command, handler as CommandHandler);
  }

  /**
   * Handle incoming connection.
   */
  private handleConnection(socket: Socket): void {
    let buffer = "";

    socket.on("data", async (chunk) => {
      buffer += chunk.toString();

      // Process complete messages (newline-delimited)
      let newlineIdx: number;
      while ((newlineIdx = buffer.indexOf("\n")) >= 0) {
        const message = buffer.slice(0, newlineIdx);
        buffer = buffer.slice(newlineIdx + 1);

        try {
          const request: DaemonRequest = JSON.parse(message);
          const response = await this.processRequest(request);
          socket.write(JSON.stringify(response) + "\n");
        } catch (err) {
          const errorResponse: DaemonResponse = {
            id: "unknown",
            success: false,
            error: `Invalid request: ${(err as Error).message}`,
            timestamp: Date.now(),
          };
          socket.write(JSON.stringify(errorResponse) + "\n");
        }
      }
    });

    socket.on("error", (err) => {
      this.emit("connectionError", err);
    });
  }

  /**
   * Process a single request.
   */
  private async processRequest(
    request: DaemonRequest
  ): Promise<DaemonResponse> {
    const handler = this.handlers.get(request.command);

    if (!handler) {
      return {
        id: request.id,
        success: false,
        error: `Unknown command: ${request.command}`,
        timestamp: Date.now(),
      };
    }

    try {
      const data = await handler(request.params);
      return {
        id: request.id,
        success: true,
        data,
        timestamp: Date.now(),
      };
    } catch (err) {
      return {
        id: request.id,
        success: false,
        error: (err as Error).message,
        timestamp: Date.now(),
      };
    }
  }

  /**
   * Register default command handlers.
   */
  private registerDefaultHandlers(): void {
    // Status handler
    this.handle<undefined, DaemonStatus>("status", async () => {
      return {
        running: true,
        pid: process.pid,
        uptime: Date.now() - this.startedAt.getTime(),
        workers: 0, // Will be populated by Queen integration
        tasks: 0,
        version: "0.1.0",
      };
    });

    // Shutdown handler
    this.handle<undefined, { message: string }>("shutdown", async () => {
      // Schedule shutdown after response is sent
      setImmediate(() => {
        this.stop().then(() => {
          this.emit("shutdown");
          process.exit(0);
        });
      });
      return { message: "Shutdown initiated" };
    });

    // Placeholder handlers - will be implemented with Queen integration
    this.handle<SpawnDroneParams, WorkerInfo>("spawn_drone", async (params) => {
      throw new Error("spawn_drone not yet implemented - requires Queen integration");
    });

    this.handle<SubmitTaskParams, TaskInfo>("submit_task", async (params) => {
      throw new Error("submit_task not yet implemented - requires Queen integration");
    });

    this.handle<undefined, WorkerInfo[]>("list_workers", async () => {
      return []; // Will be populated by Queen integration
    });

    this.handle<undefined, TaskInfo[]>("list_tasks", async () => {
      return []; // Will be populated by Queen integration
    });

    this.handle<KillWorkerParams, { killed: boolean }>(
      "kill_worker",
      async (params) => {
        throw new Error("kill_worker not yet implemented - requires Queen integration");
      }
    );
  }
}
