import { EventEmitter } from "node:events";

import type { AgentMessage, AgentTool } from "@mariozechner/pi-agent-core";
import type { TSchema } from "@sinclair/typebox";
import type { SessionManager } from "@mariozechner/pi-coding-agent";

import { registerUnhandledRejectionHandler } from "../../infra/unhandled-rejections.js";
import {
  downgradeOpenAIReasoningBlocks,
  isCompactionFailureError,
  isGoogleModelApi,
  sanitizeGoogleTurnOrdering,
  sanitizeSessionMessagesImages,
} from "../pi-embedded-helpers.js";
import { sanitizeToolUseResultPairing } from "../session-transcript-repair.js";
import { log } from "./logger.js";
import { describeUnknownError } from "./utils.js";
import { cleanToolSchemaForGemini } from "../pi-tools.schema.js";
import type { TranscriptPolicy } from "../transcript-policy.js";
import { resolveTranscriptPolicy } from "../transcript-policy.js";

const GOOGLE_TURN_ORDERING_CUSTOM_TYPE = "google-turn-ordering-bootstrap";

/**
 * OpenAI-compatible providers (e.g. Kimi) require `reasoning_content` on ALL assistant messages
 * when thinking is enabled. The AI SDK parses reasoning_content into `type: "reasoning"` parts
 * but does NOT reconstruct the field when converting back to API format. It DOES, however, spread
 * `providerOptions.openaiCompatible` into the message body via getOpenAIMetadata().
 *
 * This function injects `providerOptions.openaiCompatible.reasoning_content` on every assistant
 * message so the field survives the round-trip. Only activates when the history already contains
 * thinking blocks (i.e. thinking was previously enabled).
 */
export function injectOpenAIReasoningContent(messages: AgentMessage[]): AgentMessage[] {
  // Only activate if at least one assistant message has a thinking block.
  const hasThinking = messages.some((msg) => {
    if (!msg || typeof msg !== "object" || msg.role !== "assistant") return false;
    const assistant = msg as Extract<AgentMessage, { role: "assistant" }>;
    if (!Array.isArray(assistant.content)) return false;
    return assistant.content.some(
      (block: any) => block && typeof block === "object" && block.type === "thinking",
    );
  });
  if (!hasThinking) return messages;

  let touched = false;
  const out: AgentMessage[] = [];
  for (const msg of messages) {
    if (!msg || typeof msg !== "object" || msg.role !== "assistant") {
      out.push(msg);
      continue;
    }
    const assistant = msg as Extract<AgentMessage, { role: "assistant" }>;
    if (!Array.isArray(assistant.content)) {
      out.push(msg);
      continue;
    }
    // Extract reasoning text from thinking blocks.
    const reasoningText = assistant.content
      .filter((block: any) => block && typeof block === "object" && block.type === "thinking")
      .map((block: any) => (typeof block.thinking === "string" ? block.thinking : ""))
      .join("");

    const existing = (assistant as any).providerOptions?.openaiCompatible;
    const alreadySet =
      existing && typeof existing === "object" && "reasoning_content" in existing;
    if (alreadySet) {
      out.push(msg);
      continue;
    }
    touched = true;
    out.push({
      ...assistant,
      providerOptions: {
        ...((assistant as any).providerOptions ?? {}),
        openaiCompatible: {
          ...(existing && typeof existing === "object" ? existing : {}),
          reasoning_content: reasoningText || "",
        },
      },
    } as AgentMessage);
  }
  return touched ? out : messages;
}
const GOOGLE_SCHEMA_UNSUPPORTED_KEYWORDS = new Set([
  "patternProperties",
  "additionalProperties",
  "$schema",
  "$id",
  "$ref",
  "$defs",
  "definitions",
  "examples",
  "minLength",
  "maxLength",
  "minimum",
  "maximum",
  "multipleOf",
  "pattern",
  "format",
  "minItems",
  "maxItems",
  "uniqueItems",
  "minProperties",
  "maxProperties",
]);
const ANTIGRAVITY_SIGNATURE_RE = /^[A-Za-z0-9+/]+={0,2}$/;

function isValidAntigravitySignature(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (trimmed.length % 4 !== 0) return false;
  return ANTIGRAVITY_SIGNATURE_RE.test(trimmed);
}

function sanitizeAntigravityThinkingBlocks(messages: AgentMessage[]): AgentMessage[] {
  let touched = false;
  const out: AgentMessage[] = [];
  for (const msg of messages) {
    if (!msg || typeof msg !== "object" || msg.role !== "assistant") {
      out.push(msg);
      continue;
    }
    const assistant = msg as Extract<AgentMessage, { role: "assistant" }>;
    if (!Array.isArray(assistant.content)) {
      out.push(msg);
      continue;
    }
    type AssistantContentBlock = Extract<AgentMessage, { role: "assistant" }>["content"][number];
    const nextContent: AssistantContentBlock[] = [];
    let contentChanged = false;
    for (const block of assistant.content) {
      if (
        !block ||
        typeof block !== "object" ||
        (block as { type?: unknown }).type !== "thinking"
      ) {
        nextContent.push(block);
        continue;
      }
      const rec = block as {
        thinkingSignature?: unknown;
        signature?: unknown;
        thought_signature?: unknown;
        thoughtSignature?: unknown;
      };
      const candidate =
        rec.thinkingSignature ?? rec.signature ?? rec.thought_signature ?? rec.thoughtSignature;
      if (!isValidAntigravitySignature(candidate)) {
        contentChanged = true;
        continue;
      }
      if (rec.thinkingSignature !== candidate) {
        const nextBlock = {
          ...(block as unknown as Record<string, unknown>),
          thinkingSignature: candidate,
        } as AssistantContentBlock;
        nextContent.push(nextBlock);
        contentChanged = true;
      } else {
        nextContent.push(block);
      }
    }
    if (contentChanged) {
      touched = true;
    }
    if (nextContent.length === 0) {
      touched = true;
      continue;
    }
    out.push(contentChanged ? { ...assistant, content: nextContent } : msg);
  }
  return touched ? out : messages;
}

function findUnsupportedSchemaKeywords(schema: unknown, path: string): string[] {
  if (!schema || typeof schema !== "object") return [];
  if (Array.isArray(schema)) {
    return schema.flatMap((item, index) =>
      findUnsupportedSchemaKeywords(item, `${path}[${index}]`),
    );
  }
  const record = schema as Record<string, unknown>;
  const violations: string[] = [];
  const properties =
    record.properties && typeof record.properties === "object" && !Array.isArray(record.properties)
      ? (record.properties as Record<string, unknown>)
      : undefined;
  if (properties) {
    for (const [key, value] of Object.entries(properties)) {
      violations.push(...findUnsupportedSchemaKeywords(value, `${path}.properties.${key}`));
    }
  }
  for (const [key, value] of Object.entries(record)) {
    if (key === "properties") continue;
    if (GOOGLE_SCHEMA_UNSUPPORTED_KEYWORDS.has(key)) {
      violations.push(`${path}.${key}`);
    }
    if (value && typeof value === "object") {
      violations.push(...findUnsupportedSchemaKeywords(value, `${path}.${key}`));
    }
  }
  return violations;
}

export function sanitizeToolsForGoogle<
  TSchemaType extends TSchema = TSchema,
  TResult = unknown,
>(params: {
  tools: AgentTool<TSchemaType, TResult>[];
  provider: string;
}): AgentTool<TSchemaType, TResult>[] {
  if (params.provider !== "google-antigravity" && params.provider !== "google-gemini-cli") {
    return params.tools;
  }
  return params.tools.map((tool) => {
    if (!tool.parameters || typeof tool.parameters !== "object") return tool;
    return {
      ...tool,
      parameters: cleanToolSchemaForGemini(
        tool.parameters as Record<string, unknown>,
      ) as TSchemaType,
    };
  });
}

export function logToolSchemasForGoogle(params: { tools: AgentTool[]; provider: string }) {
  if (params.provider !== "google-antigravity" && params.provider !== "google-gemini-cli") {
    return;
  }
  const toolNames = params.tools.map((tool, index) => `${index}:${tool.name}`);
  const tools = sanitizeToolsForGoogle(params);
  log.info("google tool schema snapshot", {
    provider: params.provider,
    toolCount: tools.length,
    tools: toolNames,
  });
  for (const [index, tool] of tools.entries()) {
    const violations = findUnsupportedSchemaKeywords(tool.parameters, `${tool.name}.parameters`);
    if (violations.length > 0) {
      log.warn("google tool schema has unsupported keywords", {
        index,
        tool: tool.name,
        violations: violations.slice(0, 12),
        violationCount: violations.length,
      });
    }
  }
}

// Event emitter for unhandled compaction failures that escape try-catch blocks.
// Listeners can use this to trigger session recovery with retry.
const compactionFailureEmitter = new EventEmitter();

export type CompactionFailureListener = (reason: string) => void;

/**
 * Register a listener for unhandled compaction failures.
 * Called when auto-compaction fails in a way that escapes the normal try-catch,
 * e.g., when the summarization request itself exceeds the model's token limit.
 * Returns an unsubscribe function.
 */
export function onUnhandledCompactionFailure(cb: CompactionFailureListener): () => void {
  compactionFailureEmitter.on("failure", cb);
  return () => compactionFailureEmitter.off("failure", cb);
}

registerUnhandledRejectionHandler((reason) => {
  const message = describeUnknownError(reason);
  if (!isCompactionFailureError(message)) return false;
  log.error(`Auto-compaction failed (unhandled): ${message}`);
  compactionFailureEmitter.emit("failure", message);
  return true;
});

type CustomEntryLike = { type?: unknown; customType?: unknown; data?: unknown };

type ModelSnapshotEntry = {
  timestamp: number;
  provider?: string;
  modelApi?: string | null;
  modelId?: string;
};

const MODEL_SNAPSHOT_CUSTOM_TYPE = "model-snapshot";

function readLastModelSnapshot(sessionManager: SessionManager): ModelSnapshotEntry | null {
  try {
    const entries = sessionManager.getEntries();
    for (let i = entries.length - 1; i >= 0; i--) {
      const entry = entries[i] as CustomEntryLike;
      if (entry?.type !== "custom" || entry?.customType !== MODEL_SNAPSHOT_CUSTOM_TYPE) continue;
      const data = entry?.data as ModelSnapshotEntry | undefined;
      if (data && typeof data === "object") {
        return data;
      }
    }
  } catch {
    return null;
  }
  return null;
}

function appendModelSnapshot(sessionManager: SessionManager, data: ModelSnapshotEntry): void {
  try {
    sessionManager.appendCustomEntry(MODEL_SNAPSHOT_CUSTOM_TYPE, data);
  } catch {
    // ignore persistence failures
  }
}

function isSameModelSnapshot(a: ModelSnapshotEntry, b: ModelSnapshotEntry): boolean {
  const normalize = (value?: string | null) => value ?? "";
  return (
    normalize(a.provider) === normalize(b.provider) &&
    normalize(a.modelApi) === normalize(b.modelApi) &&
    normalize(a.modelId) === normalize(b.modelId)
  );
}

function hasGoogleTurnOrderingMarker(sessionManager: SessionManager): boolean {
  try {
    return sessionManager
      .getEntries()
      .some(
        (entry) =>
          (entry as CustomEntryLike)?.type === "custom" &&
          (entry as CustomEntryLike)?.customType === GOOGLE_TURN_ORDERING_CUSTOM_TYPE,
      );
  } catch {
    return false;
  }
}

function markGoogleTurnOrderingMarker(sessionManager: SessionManager): void {
  try {
    sessionManager.appendCustomEntry(GOOGLE_TURN_ORDERING_CUSTOM_TYPE, {
      timestamp: Date.now(),
    });
  } catch {
    // ignore marker persistence failures
  }
}

export function applyGoogleTurnOrderingFix(params: {
  messages: AgentMessage[];
  modelApi?: string | null;
  sessionManager: SessionManager;
  sessionId: string;
  warn?: (message: string) => void;
}): { messages: AgentMessage[]; didPrepend: boolean } {
  if (!isGoogleModelApi(params.modelApi)) {
    return { messages: params.messages, didPrepend: false };
  }
  const first = params.messages[0] as { role?: unknown; content?: unknown } | undefined;
  if (first?.role !== "assistant") {
    return { messages: params.messages, didPrepend: false };
  }
  const sanitized = sanitizeGoogleTurnOrdering(params.messages);
  const didPrepend = sanitized !== params.messages;
  if (didPrepend && !hasGoogleTurnOrderingMarker(params.sessionManager)) {
    const warn = params.warn ?? ((message: string) => log.warn(message));
    warn(`google turn ordering fixup: prepended user bootstrap (sessionId=${params.sessionId})`);
    markGoogleTurnOrderingMarker(params.sessionManager);
  }
  return { messages: sanitized, didPrepend };
}

export async function sanitizeSessionHistory(params: {
  messages: AgentMessage[];
  modelApi?: string | null;
  modelId?: string;
  provider?: string;
  sessionManager: SessionManager;
  sessionId: string;
  policy?: TranscriptPolicy;
}): Promise<AgentMessage[]> {
  // Keep docs/reference/transcript-hygiene.md in sync with any logic changes here.
  const policy =
    params.policy ??
    resolveTranscriptPolicy({
      modelApi: params.modelApi,
      provider: params.provider,
      modelId: params.modelId,
    });
  const sanitizedImages = await sanitizeSessionMessagesImages(params.messages, "session:history", {
    sanitizeMode: policy.sanitizeMode,
    sanitizeToolCallIds: policy.sanitizeToolCallIds,
    toolCallIdMode: policy.toolCallIdMode,
    preserveSignatures: policy.preserveSignatures,
    sanitizeThoughtSignatures: policy.sanitizeThoughtSignatures,
  });
  const sanitizedThinking = policy.normalizeAntigravityThinkingBlocks
    ? sanitizeAntigravityThinkingBlocks(sanitizedImages)
    : sanitizedImages;
  const repairedTools = policy.repairToolUseResultPairing
    ? sanitizeToolUseResultPairing(sanitizedThinking)
    : sanitizedThinking;

  // Inject reasoning_content for OpenAI-compatible providers that require it on all
  // assistant messages when thinking is enabled (e.g. Kimi). Must run before
  // downgradeOpenAIReasoningBlocks which may strip thinking blocks.
  const isGoogleApi = isGoogleModelApi(params.modelApi);
  const isAnthropicApi = params.modelApi === "anthropic-messages";
  const needsReasoningInjection = !isGoogleApi && !isAnthropicApi;
  const withReasoning = needsReasoningInjection
    ? injectOpenAIReasoningContent(repairedTools)
    : repairedTools;

  const isOpenAIResponsesApi =
    params.modelApi === "openai-responses" || params.modelApi === "openai-codex-responses";
  const hasSnapshot = Boolean(params.provider || params.modelApi || params.modelId);
  const priorSnapshot = hasSnapshot ? readLastModelSnapshot(params.sessionManager) : null;
  const modelChanged = priorSnapshot
    ? !isSameModelSnapshot(priorSnapshot, {
        timestamp: 0,
        provider: params.provider,
        modelApi: params.modelApi,
        modelId: params.modelId,
      })
    : false;
  const sanitizedOpenAI =
    isOpenAIResponsesApi && modelChanged
      ? downgradeOpenAIReasoningBlocks(withReasoning)
      : withReasoning;

  if (hasSnapshot && (!priorSnapshot || modelChanged)) {
    appendModelSnapshot(params.sessionManager, {
      timestamp: Date.now(),
      provider: params.provider,
      modelApi: params.modelApi,
      modelId: params.modelId,
    });
  }

  if (!policy.applyGoogleTurnOrdering) {
    return sanitizedOpenAI;
  }

  return applyGoogleTurnOrderingFix({
    messages: sanitizedOpenAI,
    modelApi: params.modelApi,
    sessionManager: params.sessionManager,
    sessionId: params.sessionId,
  }).messages;
}
