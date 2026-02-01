/**
 * Swarm Types
 * Minimal types for queen/worker coordination
 */

export type WorkerStatus = "idle" | "running" | "completed" | "failed" | "aborted";

export interface WorkerConfig {
  id: string;
  name: string;
  prompt: string;
  persona?: "zee" | "stanley" | "johny";
  pane?: boolean; // Open in WezTerm pane
}

export interface WorkerState {
  id: string;
  status: WorkerStatus;
  output: string[];
  startedAt?: Date;
  completedAt?: Date;
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
  type: "output" | "complete" | "error" | "status";
  workerId: string;
  data: string;
  timestamp: Date;
}
