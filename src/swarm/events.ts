/**
 * Structured orchestration events inspired by pi-agent loop lifecycle events.
 * These events are emitted by the daemon orchestration control plane.
 */

export type OrchestrationEventType =
  | "agent_start"
  | "turn_start"
  | "message_start"
  | "tool_execution_update"
  | "turn_end"
  | "agent_end"
  | "retry"
  | "interrupt"
  | "queue_overflow"
  | "worker_heartbeat";

export interface OrchestrationEvent {
  id: number;
  type: OrchestrationEventType;
  timestamp: number;
  runId?: string;
  sessionId?: string;
  taskId?: string;
  workerId?: string;
  details?: Record<string, unknown>;
}
