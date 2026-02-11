/**
 * Simple Event Emitter
 *
 * Type-safe event emitter for internal communication.
 */

export class EventEmitter<Events extends Record<string, any>> {
  private handlers = new Map<keyof Events, Set<(data: any) => void>>();

  /**
   * Subscribe to an event.
   */
  on<K extends keyof Events>(event: K, handler: (data: Events[K]) => void): () => void {
    if (!this.handlers.has(event)) {
      this.handlers.set(event, new Set());
    }
    this.handlers.get(event)!.add(handler);

    return () => {
      this.handlers.get(event)?.delete(handler);
    };
  }

  /**
   * Emit an event.
   */
  emit<K extends keyof Events>(event: K, data: Events[K]): void {
    const handlers = this.handlers.get(event);
    if (!handlers) return;

    for (const handler of handlers) {
      try {
        handler(data);
      } catch (error) {
        // Handler errors should not break other handlers
        console.error(`Event handler error for ${String(event)}:`, error);
      }
    }
  }

  /**
   * Remove all handlers for an event.
   */
  off<K extends keyof Events>(event: K): void {
    this.handlers.delete(event);
  }

  /**
   * Remove all handlers.
   */
  clear(): void {
    this.handlers.clear();
  }

  /**
   * Get the events object for type inference.
   * This is a phantom property for type checking only.
   */
  readonly events!: Events;
}
