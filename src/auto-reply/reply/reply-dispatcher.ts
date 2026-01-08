import { stripHeartbeatToken } from "../heartbeat.js";
import { HEARTBEAT_TOKEN, SILENT_REPLY_TOKEN } from "../tokens.js";
import type { GetReplyOptions, ReplyPayload } from "../types.js";
import type { TypingController } from "./typing.js";

export type ReplyDispatchKind = "tool" | "block" | "final";

type ReplyDispatchErrorHandler = (
  err: unknown,
  info: { kind: ReplyDispatchKind },
) => void;

type ReplyDispatchDeliverer = (
  payload: ReplyPayload,
  info: { kind: ReplyDispatchKind },
) => Promise<void>;

/** Human-like delay configuration for natural message rhythm. */
export type HumanDelayConfig = {
  enabled?: boolean;
  minMs?: number;
  maxMs?: number;
};

const DEFAULT_HUMAN_DELAY_MIN_MS = 800;
const DEFAULT_HUMAN_DELAY_MAX_MS = 2500;

/** Generate a random delay within the configured range. */
function getHumanDelay(config: HumanDelayConfig | undefined): number {
  if (!config?.enabled) return 0;
  const min = config.minMs ?? DEFAULT_HUMAN_DELAY_MIN_MS;
  const max = config.maxMs ?? DEFAULT_HUMAN_DELAY_MAX_MS;
  if (max <= min) return min;
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/** Sleep for a given number of milliseconds. */
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export type ReplyDispatcherOptions = {
  deliver: ReplyDispatchDeliverer;
  responsePrefix?: string;
  onHeartbeatStrip?: () => void;
  onIdle?: () => void;
  onError?: ReplyDispatchErrorHandler;
  /** Human-like delay between block replies for natural rhythm. */
  humanDelay?: HumanDelayConfig;
};

type ReplyDispatcherWithTypingOptions = Omit<
  ReplyDispatcherOptions,
  "onIdle"
> & {
  onReplyStart?: () => Promise<void> | void;
  onIdle?: () => void;
};

type ReplyDispatcherWithTypingResult = {
  dispatcher: ReplyDispatcher;
  replyOptions: Pick<GetReplyOptions, "onReplyStart" | "onTypingController">;
  markDispatchIdle: () => void;
};

export type ReplyDispatcher = {
  sendToolResult: (payload: ReplyPayload) => boolean;
  sendBlockReply: (payload: ReplyPayload) => boolean;
  sendFinalReply: (payload: ReplyPayload) => boolean;
  waitForIdle: () => Promise<void>;
  getQueuedCounts: () => Record<ReplyDispatchKind, number>;
};

function normalizeReplyPayload(
  payload: ReplyPayload,
  opts: Pick<ReplyDispatcherOptions, "responsePrefix" | "onHeartbeatStrip">,
): ReplyPayload | null {
  const hasMedia = Boolean(
    payload.mediaUrl || (payload.mediaUrls?.length ?? 0) > 0,
  );
  const trimmed = payload.text?.trim() ?? "";
  if (!trimmed && !hasMedia) return null;

  // Avoid sending the explicit silent token when no media is attached.
  if (trimmed === SILENT_REPLY_TOKEN && !hasMedia) return null;

  let text = payload.text ?? undefined;
  if (text && !trimmed) {
    // Keep empty text when media exists so media-only replies still send.
    text = "";
  }
  if (text?.includes(HEARTBEAT_TOKEN)) {
    const stripped = stripHeartbeatToken(text, { mode: "message" });
    if (stripped.didStrip) opts.onHeartbeatStrip?.();
    if (stripped.shouldSkip && !hasMedia) return null;
    text = stripped.text;
  }

  if (
    opts.responsePrefix &&
    text &&
    text.trim() !== HEARTBEAT_TOKEN &&
    !text.startsWith(opts.responsePrefix)
  ) {
    text = `${opts.responsePrefix} ${text}`;
  }

  return { ...payload, text };
}

export function createReplyDispatcher(
  options: ReplyDispatcherOptions,
): ReplyDispatcher {
  let sendChain: Promise<void> = Promise.resolve();
  // Track in-flight deliveries so we can emit a reliable "idle" signal.
  let pending = 0;
  // Track whether we've sent a block reply (for human delay - skip delay on first block).
  let sentFirstBlock = false;
  // Serialize outbound replies to preserve tool/block/final order.
  const queuedCounts: Record<ReplyDispatchKind, number> = {
    tool: 0,
    block: 0,
    final: 0,
  };

  const enqueue = (kind: ReplyDispatchKind, payload: ReplyPayload) => {
    const normalized = normalizeReplyPayload(payload, options);
    if (!normalized) return false;
    queuedCounts[kind] += 1;
    pending += 1;

    // Determine if we should add human-like delay (only for block replies after the first).
    const shouldDelay = kind === "block" && sentFirstBlock;
    if (kind === "block") sentFirstBlock = true;

    sendChain = sendChain
      .then(async () => {
        // Add human-like delay between block replies for natural rhythm.
        if (shouldDelay) {
          const delayMs = getHumanDelay(options.humanDelay);
          if (delayMs > 0) await sleep(delayMs);
        }
        await options.deliver(normalized, { kind });
      })
      .catch((err) => {
        options.onError?.(err, { kind });
      })
      .finally(() => {
        pending -= 1;
        if (pending === 0) {
          options.onIdle?.();
        }
      });
    return true;
  };

  return {
    sendToolResult: (payload) => enqueue("tool", payload),
    sendBlockReply: (payload) => enqueue("block", payload),
    sendFinalReply: (payload) => enqueue("final", payload),
    waitForIdle: () => sendChain,
    getQueuedCounts: () => ({ ...queuedCounts }),
  };
}

export function createReplyDispatcherWithTyping(
  options: ReplyDispatcherWithTypingOptions,
): ReplyDispatcherWithTypingResult {
  const { onReplyStart, onIdle, ...dispatcherOptions } = options;
  let typingController: TypingController | undefined;
  const dispatcher = createReplyDispatcher({
    ...dispatcherOptions,
    onIdle: () => {
      typingController?.markDispatchIdle();
      onIdle?.();
    },
  });

  return {
    dispatcher,
    replyOptions: {
      onReplyStart,
      onTypingController: (typing) => {
        typingController = typing;
      },
    },
    markDispatchIdle: () => {
      typingController?.markDispatchIdle();
      onIdle?.();
    },
  };
}
