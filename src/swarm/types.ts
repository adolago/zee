/**
 * Swarm Types
 * Minimal types for queen/worker coordination
 */

export type WorkerStatus = "idle" | "running" | "completed" | "failed" | "aborted";
export type Persona = "zee" | "stanley" | "johny";

export interface WorkerConfig {
  id: string;
  name: string;
  prompt: string;
  persona?: Persona;
  taskId?: string;
  timeoutMs?: number;
  attempt?: number;
  env?: Record<string, string>;
  pane?: boolean; // Open in WezTerm pane
  /** Permission scope override. Passed as ZEE_PERMISSION_SCOPE env var.
   *  Values: "full" (default) | "readonly" | "explore" */
  permissionScope?: "full" | "readonly" | "explore";
}

export interface WorkerState {
  id: string;
  name: string;
  persona: Persona;
  taskId?: string;
  pid?: number;
  attempt: number;
  status: WorkerStatus;
  output: string[];
  startedAt?: Date;
  completedAt?: Date;
  lastHeartbeatAt?: Date;
  error?: string;
}

export interface SwarmConfig {
  maxWorkers?: number;
  timeout?: number; // ms
  panes?: boolean; // Show workers in WezTerm panes
  sharedMemory?: boolean; // Enable memory MCP for cross-worker state
}

export interface SwarmResult {
  id: string;
  workers: WorkerState[];
  duration: number;
  success: boolean;
}

export interface WorkerMessage {
  type: "output" | "complete" | "error" | "status" | "heartbeat";
  workerId: string;
  data: string;
  timestamp: Date;
}
