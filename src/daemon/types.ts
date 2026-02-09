/**
 * Daemon IPC Types
 *
 * Message types for client-daemon communication over Unix socket.
 */

/** Available daemon commands */
export type DaemonCommand =
  | "status"
  | "shutdown"
  | "spawn_drone"
  | "submit_task"
  | "list_workers"
  | "list_tasks"
  | "kill_worker";

/** Generic IPC request wrapper */
export interface DaemonRequest<T = unknown> {
  id: string;
  command: DaemonCommand;
  params?: T;
  timestamp: number;
}

/** Generic IPC response wrapper */
export interface DaemonResponse<T = unknown> {
  id: string;
  success: boolean;
  data?: T;
  error?: string;
  timestamp: number;
}

// Command-specific parameter types

export interface SpawnDroneParams {
  persona: "zee" | "stanley" | "johny";
  task: string;
  prompt: string;
}

export interface SubmitTaskParams {
  persona: "zee" | "stanley" | "johny";
  description: string;
  prompt: string;
}

export interface KillWorkerParams {
  workerId: string;
}

// Response data types

export interface DaemonStatus {
  running: boolean;
  pid: number;
  uptime: number;
  workers: number;
  tasks: number;
  version: string;
}

export interface WorkerInfo {
  id: string;
  name: string;
  persona: "zee" | "stanley" | "johny";
  status: "idle" | "running" | "completed" | "failed" | "aborted";
  startedAt?: string;
  completedAt?: string;
}

export interface TaskInfo {
  id: string;
  description: string;
  persona: "zee" | "stanley" | "johny";
  status: "pending" | "running" | "completed" | "failed";
  workerId?: string;
  createdAt: string;
}

/** IPC client options */
export interface IPCClientOptions {
  socketPath?: string;
  timeoutMs?: number;
}

/** Default socket path */
export const DEFAULT_SOCKET_PATH = (() => {
  const home = process.env.HOME || process.env.USERPROFILE || "/tmp";
  const stateHome = process.env.XDG_STATE_HOME || `${home}/.local/state`;
  return `${stateHome}/zee/daemon.sock`;
})();
