import type { OrchestrationVisualEvent } from "./types";

export interface VisualOrchestrationSink {
  emit(event: OrchestrationVisualEvent): Promise<void>;
  flush?(): Promise<void>;
  close?(): Promise<void>;
}

export class NoopVisualOrchestrationSink implements VisualOrchestrationSink {
  async emit(_event: OrchestrationVisualEvent): Promise<void> {
    // Intentionally empty.
  }

  async flush(): Promise<void> {
    // Intentionally empty.
  }

  async close(): Promise<void> {
    // Intentionally empty.
  }
}

export const NOOP_VISUAL_SINK = new NoopVisualOrchestrationSink();
