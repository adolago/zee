import { spawn } from "node:child_process";
import { appendFile, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { OrchestrationVisualEvent } from "./types";
import type { VisualOrchestrationSink } from "./sink";

export interface TmuxVisualOrchestrationOptions {
  /**
   * Explicit tmux socket path. Defaults to an isolated Zee-specific socket.
   * This intentionally avoids the tmux skill socket convention so both can coexist.
   */
  socketPath?: string;
  /**
   * tmux session name used for orchestration panes.
   */
  sessionName?: string;
  /**
   * Base directory for visual logs + socket.
   */
  baseDir?: string;
  /**
   * Maximum worker panes to create in tmux.
   */
  maxWorkerPanes?: number;
  /**
   * Whether to kill the orchestration session on close.
   * Defaults to true.
   */
  cleanupSessionOnClose?: boolean;
  /**
   * Whether to remove the visual state directory on close.
   * Defaults to false to preserve logs for inspection.
   */
  cleanupFilesOnClose?: boolean;
  /**
   * Optional test hook for tmux command execution.
   */
  commandRunner?: TmuxCommandRunner;
}

export interface TmuxCommandResult {
  code: number;
  stdout: string;
  stderr: string;
}

export type TmuxCommandRunner = (args: string[]) => Promise<TmuxCommandResult>;

const DEFAULT_MAX_WORKER_PANES = 8;

function resolveStateHome(): string {
  const home = process.env.HOME || process.env.USERPROFILE || tmpdir();
  return process.env.XDG_STATE_HOME || join(home, ".local", "state");
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function safeJSON(value: Record<string, unknown> | undefined): string {
  if (!value) return "";
  try {
    const text = JSON.stringify(value);
    if (text.length <= 600) return text;
    return `${text.slice(0, 597)}...`;
  } catch {
    return '"[unserializable-details]"';
  }
}

export class TmuxVisualOrchestrationSink implements VisualOrchestrationSink {
  readonly socketPath: string;
  readonly sessionName: string;
  readonly baseDir: string;
  readonly mainLogPath: string;

  private readonly maxWorkerPanes: number;
  private readonly cleanupSessionOnClose: boolean;
  private readonly cleanupFilesOnClose: boolean;
  private readonly runCommand: TmuxCommandRunner;
  private readonly workerPaneById = new Map<string, string>();
  private readonly workerLogById = new Map<string, string>();

  private disabled = false;
  private initialized = false;
  private initPromise: Promise<void> | null = null;
  private readonly windowName = "orchestration";

  constructor(options: TmuxVisualOrchestrationOptions = {}) {
    this.baseDir = options.baseDir ?? join(resolveStateHome(), "zee", "orchestration", "tmux");
    this.socketPath = options.socketPath ?? join(this.baseDir, "orchestration.sock");
    this.sessionName = options.sessionName ?? `zee-orch-${process.pid}`;
    this.mainLogPath = join(this.baseDir, "main.log");
    this.maxWorkerPanes = Math.max(1, options.maxWorkerPanes ?? DEFAULT_MAX_WORKER_PANES);
    this.cleanupSessionOnClose = options.cleanupSessionOnClose ?? true;
    this.cleanupFilesOnClose = options.cleanupFilesOnClose ?? false;
    this.runCommand = options.commandRunner ?? this.defaultCommandRunner;
  }

  async emit(event: OrchestrationVisualEvent): Promise<void> {
    await this.ensureInitialized();
    if (this.disabled) return;

    const line = this.formatLine(event);
    await this.appendLine(this.mainLogPath, line);

    if (event.workerId) {
      const workerLogPath = await this.ensureWorkerLog(event.workerId);
      await this.appendLine(workerLogPath, line);
      await this.ensureWorkerPane(event.workerId, workerLogPath);
    }
  }

  async flush(): Promise<void> {
    // Writes are append-only and immediate.
  }

  async close(): Promise<void> {
    if (this.disabled) return;
    if (!this.initialized) return;

    if (this.cleanupSessionOnClose) {
      const hasSession = await this.tmux(["has-session", "-t", this.sessionName], true);
      if (hasSession.code === 0) {
        await this.tmux(["kill-session", "-t", this.sessionName], true);
      }
    }

    if (this.cleanupFilesOnClose) {
      await rm(this.baseDir, { recursive: true, force: true }).catch(() => {});
    }
  }

  private async ensureInitialized(): Promise<void> {
    if (this.initialized || this.disabled) return;
    if (this.initPromise) {
      await this.initPromise;
      return;
    }

    this.initPromise = this.initialize();
    try {
      await this.initPromise;
    } finally {
      this.initPromise = null;
    }
  }

  private async initialize(): Promise<void> {
    const version = await this.runCommand(["-V"]).catch(() => ({
      code: 1,
      stdout: "",
      stderr: "",
    }));
    if (version.code !== 0) {
      this.disabled = true;
      return;
    }

    await mkdir(this.baseDir, { recursive: true });
    await mkdir(dirname(this.socketPath), { recursive: true });
    await this.appendLine(this.mainLogPath, `[${new Date().toISOString()}] visual backend initialized`);

    const hasSession = await this.tmux(["has-session", "-t", this.sessionName], true);
    if (hasSession.code !== 0) {
      const tailMain = `tail -n +1 -F ${shellQuote(this.mainLogPath)}`;
      const create = await this.tmux([
        "new-session",
        "-d",
        "-s",
        this.sessionName,
        "-n",
        this.windowName,
        tailMain,
      ], true);

      if (create.code !== 0) {
        this.disabled = true;
        return;
      }
    }

    this.initialized = true;
    await this.appendLine(
      this.mainLogPath,
      `[${new Date().toISOString()}] tmux socket=${this.socketPath} session=${this.sessionName}`,
    );
  }

  private async ensureWorkerLog(workerId: string): Promise<string> {
    const existing = this.workerLogById.get(workerId);
    if (existing) return existing;

    const path = join(this.baseDir, `${workerId}.log`);
    this.workerLogById.set(workerId, path);
    await this.appendLine(path, `[${new Date().toISOString()}] worker log created`);
    return path;
  }

  private async ensureWorkerPane(workerId: string, workerLogPath: string): Promise<void> {
    if (this.workerPaneById.has(workerId)) return;
    if (this.workerPaneById.size >= this.maxWorkerPanes) return;

    const target = `${this.sessionName}:${this.windowName}`;
    const tailWorker = `tail -n +1 -F ${shellQuote(workerLogPath)}`;
    const split = await this.tmux([
      "split-window",
      "-t",
      target,
      "-P",
      "-F",
      "#{pane_id}",
      tailWorker,
    ], true);
    if (split.code !== 0) return;

    const paneId = split.stdout.trim();
    if (!paneId) return;

    this.workerPaneById.set(workerId, paneId);
    await this.tmux(["select-layout", "-t", target, "tiled"], true);
  }

  private async appendLine(path: string, line: string): Promise<void> {
    await mkdir(dirname(path), { recursive: true });
    await appendFile(path, `${line}\n`, "utf8");
  }

  private formatLine(event: OrchestrationVisualEvent): string {
    const ts = new Date(event.timestamp).toISOString();
    const swarm = event.swarmId ? ` swarm=${event.swarmId}` : "";
    const task = event.taskId ? ` task=${event.taskId}` : "";
    const worker = event.workerId ? ` worker=${event.workerId}` : "";
    const details = safeJSON(event.details);
    return `[${ts}] ${event.type}${swarm}${task}${worker}${details ? ` ${details}` : ""}`;
  }

  private async tmux(args: string[], allowFailure = false): Promise<TmuxCommandResult> {
    const result = await this.runCommand(["-S", this.socketPath, ...args]);
    if (!allowFailure && result.code !== 0) {
      throw new Error(`tmux command failed (${args.join(" ")}): ${result.stderr || result.stdout}`);
    }
    return result;
  }

  private readonly defaultCommandRunner: TmuxCommandRunner = async (args) => {
    return new Promise<TmuxCommandResult>((resolve) => {
      const proc = spawn("tmux", args, { stdio: ["ignore", "pipe", "pipe"] });
      let stdout = "";
      let stderr = "";
      proc.stdout.on("data", (chunk) => {
        stdout += chunk.toString();
      });
      proc.stderr.on("data", (chunk) => {
        stderr += chunk.toString();
      });
      proc.on("error", (error) => {
        resolve({
          code: 1,
          stdout,
          stderr: stderr ? `${stderr}\n${error.message}` : error.message,
        });
      });
      proc.on("close", (code) => {
        resolve({
          code: typeof code === "number" ? code : 1,
          stdout,
          stderr,
        });
      });
    });
  };
}
