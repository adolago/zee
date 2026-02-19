/**
 * Terminal-agnostic visual orchestration contracts.
 *
 * Phase 1 uses event-stream mode only and intentionally does not bind
 * orchestration behavior to a specific terminal backend.
 */

export type OrchestrationVisualMode = "events" | "external";

export interface OrchestrationVisualConfig {
  enabled?: boolean;
  mode?: OrchestrationVisualMode;
  /**
   * Backend identifier reserved for future terminal integrations.
   * (e.g., "wezterm", "kitty", "tmux")
   */
  backend?: string;
}

export interface ResolvedOrchestrationVisualConfig {
  enabled: boolean;
  mode: OrchestrationVisualMode;
  backend?: string;
}

export interface OrchestrationVisualEventBase {
  type:
    | "swarm_started"
    | "swarm_completed"
    | "worker_started"
    | "worker_output"
    | "worker_status"
    | "worker_completed"
    | "worker_failed"
    | "worker_heartbeat"
    | "task_enqueued"
    | "task_started"
    | "task_finished"
    | "queue_overflow"
    | "interrupt"
    | "shutdown";
  timestamp: number;
  swarmId?: string;
  taskId?: string;
  workerId?: string;
  details?: Record<string, unknown>;
}

export type OrchestrationVisualEvent = OrchestrationVisualEventBase;

export function resolveVisualConfig(
  config?: OrchestrationVisualConfig,
): ResolvedOrchestrationVisualConfig {
  return {
    enabled: config?.enabled ?? true,
    mode: config?.mode ?? "events",
    backend: config?.backend,
  };
}
