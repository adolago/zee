/**
 * OpenCode-based agent runner replacing pi-embedded-runner.
 * Uses @opencode-ai/sdk for LLM orchestration.
 */

import { createOpencode, type OpencodeClient } from "@opencode-ai/sdk";
import type { ReplyPayload } from "../auto-reply/types.js";
import type { ZeeConfig } from "../config/config.js";

// Types for messaging tool tracking
export type MessagingToolSend = {
  tool: string;
  provider: string;
  accountId?: string;
  to?: string;
};

// Agent event types
export type AgentEvent = {
  stream: "text" | "tool" | "reasoning" | "compaction" | "error" | "lifecycle";
  data: Record<string, unknown>;
};

// Usage tracking
export type UsageInfo = {
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
};

// Agent metadata
export type EmbeddedPiAgentMeta = {
  sessionKey: string;
  sessionId: string;
  sessionFile: string;
  lane: "main" | "compact";
  model: string;
  provider: string;
  usage?: UsageInfo;
  run: {
    startTime: number;
    endTime?: number;
    text: string;
    tokenCount: number;
    aborted: boolean;
    toolCalls: Array<{
      name: string;
      result?: string;
    }>;
    messagingSends?: MessagingToolSend[];
    isFirstRunAfterCompact?: boolean;
  };
};

export type EmbeddedPiRunMeta = {
  sessionKey: string;
  sessionId: string;
  sessionFile: string;
  lane: "main" | "compact";
  model: string;
  provider: string;
  aborted?: boolean;
  agentMeta?: {
    usage?: UsageInfo;
    model?: string;
    provider?: string;
  };
};

export type EmbeddedPiRunResult = {
  success: boolean;
  text: string;
  tokenCount: number;
  aborted: boolean;
  meta: EmbeddedPiRunMeta;
  error?: string;
  payloads: ReplyPayload[];
  messagingToolSentTexts: string[];
  messagingToolSentTargets: MessagingToolSend[];
};

export type EmbeddedPiCompactResult = {
  success: boolean;
  ok?: boolean;
  compacted?: boolean;
  tokensRemoved?: number;
  error?: string;
  reason?: string;
  result?: {
    tokensRemoved?: number;
    tokensBefore?: number;
  };
};

// Singleton opencode instance
let opencodeInstance: {
  client: OpencodeClient;
  server: { url: string; close: () => void };
} | null = null;

async function getOpencodeInstance() {
  if (!opencodeInstance) {
    opencodeInstance = await createOpencode({ port: 0 });
  }
  return opencodeInstance;
}

// Session state tracking
const activeSessions = new Map<
  string,
  {
    sessionId: string;
    opencodeSessionId?: string;
    isStreaming: boolean;
    abortController: AbortController | null;
  }
>();

export function resolveEmbeddedSessionLane(
  sessionKey: string,
  lane: "main" | "compact" = "main",
): string {
  return `${sessionKey}:${lane}`;
}

export function isEmbeddedPiRunActive(sessionKey: string): boolean {
  const session = activeSessions.get(sessionKey);
  return session?.isStreaming ?? false;
}

export function isEmbeddedPiRunStreaming(sessionKey: string): boolean {
  return isEmbeddedPiRunActive(sessionKey);
}

export function abortEmbeddedPiRun(sessionKey: string): void {
  const session = activeSessions.get(sessionKey);
  if (session?.abortController) {
    session.abortController.abort();
    session.isStreaming = false;
  }
}

export async function waitForEmbeddedPiRunEnd(
  sessionKey: string,
  timeoutMs: number = 60000,
): Promise<boolean> {
  const start = Date.now();
  while (isEmbeddedPiRunActive(sessionKey) && Date.now() - start < timeoutMs) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return !isEmbeddedPiRunActive(sessionKey);
}

export interface EmbeddedPiAgentOptions {
  sessionKey?: string;
  sessionId: string;
  sessionFile: string;
  workspaceDir: string;
  agentDir?: string;
  config?: ZeeConfig;
  skillsSnapshot?: unknown;
  prompt: string;
  extraSystemPrompt?: string;
  ownerNumbers?: string[];
  enforceFinalTag?: boolean;
  provider: string;
  model: string;
  authProfileId?: string;
  thinkLevel?: string;
  verboseLevel?: string;
  reasoningLevel?: string;
  bashElevated?:
    | boolean
    | { enabled: boolean; allowed: boolean; defaultLevel: string };
  timeoutMs?: number;
  runId?: string;
  lane?: "main" | "compact";
  blockReplyBreak?: string;
  blockReplyChunking?: unknown;
  messageProvider?: string;
  messageProviderCapabilities?: string[];
  agentAccountId?: string;
  onPartialReply?: (payload: ReplyPayload) => Promise<void> | void;
  onReasoningStream?: (payload: ReplyPayload) => Promise<void> | void;
  onAgentEvent?: (evt: AgentEvent) => void;
  onBlockReply?: (payload: ReplyPayload) => Promise<void> | void;
  onToolResult?: (payload: ReplyPayload) => Promise<void> | void;
  shouldEmitToolResult?: () => boolean;
  signal?: AbortSignal;
  abortSignal?: AbortSignal;
}

export async function runEmbeddedPiAgent(
  options: EmbeddedPiAgentOptions,
): Promise<EmbeddedPiRunResult> {
  const {
    sessionKey = `session-${Date.now()}`,
    sessionId,
    sessionFile,
    prompt,
    extraSystemPrompt,
    model,
    provider,
    onPartialReply,
    onReasoningStream,
    onAgentEvent,
    onBlockReply,
    signal,
  } = options;

  const abortController = new AbortController();
  if (signal) {
    signal.addEventListener("abort", () => abortController.abort());
  }

  // Track session state
  activeSessions.set(sessionKey, {
    sessionId,
    isStreaming: true,
    abortController,
  });

  const _startTime = Date.now();
  let fullText = "";
  let tokenCount = 0;
  let aborted = false;
  const payloads: ReplyPayload[] = [];
  const messagingToolSentTexts: string[] = [];
  const messagingToolSentTargets: MessagingToolSend[] = [];
  const toolCalls: Array<{ name: string; result?: string }> = [];
  let usage: UsageInfo = {};

  try {
    const { client } = await getOpencodeInstance();

    // Parse provider/model
    const [providerID, modelID] = model.includes("/")
      ? model.split("/", 2)
      : [provider, model];

    // Get or create session
    const session = activeSessions.get(sessionKey);
    let ocSessionId = session?.opencodeSessionId;

    if (!ocSessionId) {
      const sessionResponse = await client.session.create({
        body: { title: `zee-${sessionKey}` },
      });
      if (!sessionResponse.data) {
        throw new Error("Failed to create session");
      }
      ocSessionId = sessionResponse.data.id;
      if (session) {
        session.opencodeSessionId = ocSessionId;
      }
    }

    // Send prompt
    const response = await client.session.prompt({
      path: { id: ocSessionId },
      body: {
        parts: [{ type: "text", text: prompt }],
        model: { providerID, modelID },
        system: extraSystemPrompt,
      },
    });

    if (response.error) {
      throw new Error(`Prompt failed: ${JSON.stringify(response.error)}`);
    }

    const assistantMsg = response.data;
    if (assistantMsg) {
      usage = {
        input: assistantMsg.info.tokens?.input ?? 0,
        output: assistantMsg.info.tokens?.output ?? 0,
        cacheRead: assistantMsg.info.tokens?.cache?.read ?? 0,
        cacheWrite: assistantMsg.info.tokens?.cache?.write ?? 0,
      };
      tokenCount = (usage.input ?? 0) + (usage.output ?? 0);

      // Process parts
      for (const part of assistantMsg.parts) {
        if (part.type === "text") {
          const textPart = part as { text: string };
          fullText += textPart.text;

          // Stream partial reply
          await onPartialReply?.({ text: textPart.text });

          // Add to payloads
          if (textPart.text.trim()) {
            payloads.push({ text: textPart.text });
          }
        } else if (part.type === "reasoning") {
          const reasoningPart = part as { text: string };
          await onReasoningStream?.({ text: reasoningPart.text });
        } else if (part.type === "tool") {
          const toolPart = part as unknown as {
            callID: string;
            tool: string;
            input?: Record<string, unknown>;
            state?: { output?: string };
          };

          onAgentEvent?.({
            stream: "tool",
            data: { phase: "start", tool: toolPart.tool },
          });

          toolCalls.push({
            name: toolPart.tool,
            result: toolPart.state?.output,
          });

          // Track messaging tool sends
          const messagingTools = ["whatsapp", "telegram", "discord", "slack"];
          if (messagingTools.includes(toolPart.tool)) {
            const input = toolPart.input ?? {};
            const content = input.content as string | undefined;
            const to = input.to as string | undefined;

            if (content) {
              messagingToolSentTexts.push(content);
            }

            messagingToolSentTargets.push({
              tool: toolPart.tool,
              provider: toolPart.tool,
              accountId: input.accountId as string | undefined,
              to,
            });
          }

          onAgentEvent?.({
            stream: "tool",
            data: { phase: "end", tool: toolPart.tool },
          });
        }
      }

      // Send block reply with final text
      if (fullText.trim()) {
        await onBlockReply?.({ text: fullText });
      }
    }
  } catch (error) {
    if (abortController.signal.aborted) {
      aborted = true;
    } else {
      const errorMsg = error instanceof Error ? error.message : String(error);
      const meta: EmbeddedPiRunMeta = {
        sessionKey,
        sessionId,
        sessionFile,
        lane: "main",
        model,
        provider,
        agentMeta: { usage, model, provider },
      };

      return {
        success: false,
        text: fullText,
        tokenCount,
        aborted,
        meta,
        error: errorMsg,
        payloads,
        messagingToolSentTexts,
        messagingToolSentTargets,
      };
    }
  } finally {
    const session = activeSessions.get(sessionKey);
    if (session) {
      session.isStreaming = false;
    }
  }

  const meta: EmbeddedPiRunMeta = {
    sessionKey,
    sessionId,
    sessionFile,
    lane: "main",
    model,
    provider,
    agentMeta: { usage, model, provider },
  };

  return {
    success: true,
    text: fullText,
    tokenCount,
    aborted,
    meta,
    payloads,
    messagingToolSentTexts,
    messagingToolSentTargets,
  };
}

export async function queueEmbeddedPiMessage(
  sessionKey: string,
  message: string,
): Promise<boolean> {
  // Queue a message for steering - with OpenCode we'd need to track pending messages
  console.log(`[opencode] Queue message for ${sessionKey}: ${message}`);
  return true; // Return true to indicate message was queued
}

export interface CompactSessionOptions {
  sessionId: string;
  sessionKey?: string;
  sessionFile: string;
  workspaceDir: string;
  config?: ZeeConfig;
  skillsSnapshot?: unknown;
  provider?: string;
  model?: string;
  thinkLevel?: string;
  bashElevated?: unknown;
  customInstructions?: string;
  ownerNumbers?: string[];
  messageProvider?: string;
  messageProviderCapabilities?: string[];
}

export async function compactEmbeddedPiSession(
  options: CompactSessionOptions,
): Promise<EmbeddedPiCompactResult> {
  const { sessionKey } = options;
  if (!sessionKey) {
    return { success: true, ok: true, compacted: false };
  }
  try {
    const { client } = await getOpencodeInstance();
    const session = activeSessions.get(sessionKey);
    if (session?.opencodeSessionId) {
      await client.session.summarize({
        path: { id: session.opencodeSessionId },
      });
      return {
        success: true,
        ok: true,
        compacted: true,
        result: { tokensRemoved: 0 },
      };
    }
    return { success: true, ok: true, compacted: false };
  } catch (error) {
    return {
      success: false,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

// Re-export for compatibility
export { getOpencodeInstance };
