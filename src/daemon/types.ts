/**
 * Daemon IPC Types
 *
 * Message types for client-daemon communication over Unix socket.
 */

import type { OrchestrationEvent } from "../swarm/events";

export type Persona = "zee" | "stanley" | "johny";

/** Available daemon commands */
export type DaemonCommand =
  | "status"
  | "shutdown"
  | "spawn_drone"
  | "submit_task"
  | "run_task"
  | "list_workers"
  | "list_tasks"
  | "kill_worker"
  | "list_events";

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
  persona: Persona;
  /** Short human-readable task description. */
  description?: string;
  /** Legacy alias retained for compatibility with older clients. */
  task?: string;
  prompt: string;
  parentSessionId?: string;
  parentMessageId?: string;
  timeoutMs?: number;
  priority?: number;
  taskId?: string;
}

export interface SubmitTaskParams {
  persona: Persona;
  description: string;
  prompt: string;
  parentSessionId?: string;
  parentMessageId?: string;
  timeoutMs?: number;
  priority?: number;
  taskId?: string;
}

export interface KillWorkerParams {
  workerId: string;
}

export interface ListEventsParams {
  cursor?: number;
  limit?: number;
}

export interface RunTaskParams extends SpawnDroneParams {
  /**
   * Optional override for how long the caller waits for the task to finish.
   * Defaults to the task timeout when omitted.
   */
  waitTimeoutMs?: number;
}

// Response data types

export interface DaemonStatus {
  running: boolean;
  pid: number;
  uptime: number;
  activeWorkers: number;
  workers: number;
  tasks: number;
  queueDepth: number;
  draining: boolean;
  version: string;
}

export interface WorkerInfo {
  id: string;
  name: string;
  persona: Persona;
  taskId?: string;
  pid?: number;
  attempt: number;
  status: "idle" | "running" | "completed" | "failed" | "aborted";
  startedAt?: string;
  completedAt?: string;
  lastHeartbeatAt?: string;
}

export interface TaskInfo {
  id: string;
  description: string;
  persona: Persona;
  status: "pending" | "running" | "completed" | "failed" | "aborted";
  priority: number;
  attempt: number;
  error?: string;
  workerId?: string;
  parentSessionId?: string;
  parentMessageId?: string;
  createdAt: string;
  enqueuedAt: string;
  startedAt?: string;
  endedAt?: string;
}

export interface ListEventsResult {
  events: OrchestrationEvent[];
  nextCursor: number;
}

export interface TaskRunResult {
  task: TaskInfo;
  output: string;
}

/** IPC client options */
export interface IPCClientOptions {
  socketPath?: string;
  timeoutMs?: number;
}

function resolveStateHome(): string {
  const home = process.env.HOME || process.env.USERPROFILE || "/tmp";
  return process.env.XDG_STATE_HOME || `${home}/.local/state`;
}

/** Legacy socket path kept for migration/cleanup compatibility. */
export const LEGACY_SOCKET_PATH = `${resolveStateHome()}/zee/daemon.sock`;

/** Default socket path (moved under daemon/ to avoid state-root file scanners). */
export const DEFAULT_SOCKET_PATH = `${resolveStateHome()}/zee/daemon/daemon.sock`;
