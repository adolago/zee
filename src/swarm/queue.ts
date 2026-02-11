/**
 * Bounded task queue with dedupe + drop policy semantics inspired by OpenClaw.
 */

export type QueueDropPolicy = "summarize" | "old" | "new";
export type QueueDedupeMode = "task-id" | "prompt" | "none";
export type QueueMode = "serial" | "parallel" | "collect";

export interface QueueSettings {
  mode?: QueueMode;
  cap?: number;
  dropPolicy?: QueueDropPolicy;
  dedupeMode?: QueueDedupeMode;
  summaryLimit?: number;
}

export interface QueuedTask {
  id: string;
  description: string;
  prompt: string;
  priority: number;
  enqueuedAt: number;
}

export interface QueueState<T> {
  mode: QueueMode;
  cap: number;
  dropPolicy: QueueDropPolicy;
  dedupeMode: QueueDedupeMode;
  items: T[];
  droppedCount: number;
  summaryLines: string[];
}

export interface EnqueueResult<T> {
  enqueued: boolean;
  dropped: T[];
  deduped: boolean;
}

const DEFAULT_CAP = 20;
const DEFAULT_DROP_POLICY: QueueDropPolicy = "summarize";
const DEFAULT_DEDUPE_MODE: QueueDedupeMode = "task-id";
const DEFAULT_MODE: QueueMode = "parallel";
const DEFAULT_SUMMARY_LIMIT = 20;

export function elideQueueText(text: string, limit = 140): string {
  if (text.length <= limit) return text;
  return `${text.slice(0, Math.max(0, limit - 1)).trimEnd()}...`;
}

export function buildQueueSummaryLine(text: string, limit = 160): string {
  return elideQueueText(text.replace(/\s+/g, " ").trim(), limit);
}

export class TaskQueue<T extends QueuedTask> {
  readonly state: QueueState<T>;
  private summaryLimit: number;

  constructor(settings: QueueSettings = {}) {
    this.state = {
      mode: settings.mode ?? DEFAULT_MODE,
      cap:
        typeof settings.cap === "number" && settings.cap > 0
          ? Math.floor(settings.cap)
          : DEFAULT_CAP,
      dropPolicy: settings.dropPolicy ?? DEFAULT_DROP_POLICY,
      dedupeMode: settings.dedupeMode ?? DEFAULT_DEDUPE_MODE,
      items: [],
      droppedCount: 0,
      summaryLines: [],
    };
    this.summaryLimit = Math.max(1, settings.summaryLimit ?? DEFAULT_SUMMARY_LIMIT);
  }

  get size(): number {
    return this.state.items.length;
  }

  isEmpty(): boolean {
    return this.state.items.length === 0;
  }

  clear(): T[] {
    const drained = [...this.state.items];
    this.state.items.length = 0;
    this.state.droppedCount = 0;
    this.state.summaryLines = [];
    return drained;
  }

  enqueue(item: T): EnqueueResult<T> {
    if (this.isDuplicate(item)) {
      return { enqueued: false, dropped: [], deduped: true };
    }

    const dropped: T[] = [];
    if (this.state.cap > 0 && this.state.items.length >= this.state.cap) {
      if (this.state.dropPolicy === "new") {
        return { enqueued: false, dropped: [], deduped: false };
      }

      const dropCount = this.state.items.length - this.state.cap + 1;
      for (let i = 0; i < dropCount; i++) {
        const removed = this.state.items.shift();
        if (!removed) break;
        dropped.push(removed);
        if (this.state.dropPolicy === "summarize") {
          this.state.droppedCount += 1;
          this.state.summaryLines.push(
            buildQueueSummaryLine(removed.description || removed.prompt),
          );
        }
      }

      if (this.state.summaryLines.length > this.summaryLimit) {
        this.state.summaryLines = this.state.summaryLines.slice(-this.summaryLimit);
      }
    }

    this.state.items.push(item);
    this.state.items.sort((a, b) => {
      if (b.priority !== a.priority) return b.priority - a.priority;
      return a.enqueuedAt - b.enqueuedAt;
    });

    return { enqueued: true, dropped, deduped: false };
  }

  dequeue(): T | undefined {
    return this.state.items.shift();
  }

  consumeSummary(noun = "task"): string | undefined {
    if (this.state.dropPolicy !== "summarize" || this.state.droppedCount <= 0) {
      return undefined;
    }
    const lines: string[] = [
      `[Queue overflow] Dropped ${this.state.droppedCount} ${noun}${this.state.droppedCount === 1 ? "" : "s"} due to cap.`,
    ];
    if (this.state.summaryLines.length > 0) {
      lines.push("Summary:");
      for (const line of this.state.summaryLines) {
        lines.push(`- ${line}`);
      }
    }

    this.state.droppedCount = 0;
    this.state.summaryLines = [];
    return lines.join("\n");
  }

  private isDuplicate(item: T): boolean {
    if (this.state.dedupeMode === "none") return false;
    if (this.state.dedupeMode === "task-id") {
      return this.state.items.some((existing) => existing.id === item.id);
    }
    return this.state.items.some((existing) => existing.prompt === item.prompt);
  }
}
