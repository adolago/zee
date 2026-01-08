/**
 * Compatibility layer for pi-embedded.
 * Re-exports from opencode-runner.ts with the same interface.
 */
export type {
  AgentEvent,
  CompactSessionOptions,
  EmbeddedPiAgentMeta,
  EmbeddedPiAgentOptions,
  EmbeddedPiCompactResult,
  EmbeddedPiRunMeta,
  EmbeddedPiRunResult,
  MessagingToolSend,
  UsageInfo,
} from "./opencode-runner.js";

export {
  abortEmbeddedPiRun,
  compactEmbeddedPiSession,
  isEmbeddedPiRunActive,
  isEmbeddedPiRunStreaming,
  queueEmbeddedPiMessage,
  resolveEmbeddedSessionLane,
  runEmbeddedPiAgent,
  waitForEmbeddedPiRunEnd,
} from "./opencode-runner.js";
