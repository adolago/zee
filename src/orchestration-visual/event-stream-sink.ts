import type { OrchestrationVisualEvent } from "./types";
import type { VisualOrchestrationSink } from "./sink";

export interface EventStreamSinkOptions {
  onEvent?: (event: OrchestrationVisualEvent) => void | Promise<void>;
}

export class EventStreamVisualOrchestrationSink implements VisualOrchestrationSink {
  constructor(private readonly options: EventStreamSinkOptions = {}) {}

  async emit(event: OrchestrationVisualEvent): Promise<void> {
    await this.options.onEvent?.(event);
  }

  async flush(): Promise<void> {
    // No buffered state to flush in event-stream mode.
  }
}
