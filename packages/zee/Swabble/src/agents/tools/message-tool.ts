import { Type } from "@sinclair/typebox";
import {
  listChannelMessageActions,
  supportsChannelMessageButtons,
  supportsChannelMessageCards,
} from "../../channels/plugins/message-actions.js";
import {
  CHANNEL_MESSAGE_ACTION_NAMES,
  type ChannelMessageActionName,
} from "../../channels/plugins/types.js";
import type { ZeeConfig } from "../../config/config.js";
import { loadConfig } from "../../config/config.js";
import { GATEWAY_CLIENT_IDS, GATEWAY_CLIENT_MODES } from "../../gateway/protocol/client-info.js";
import { normalizeTargetForProvider } from "../../infra/outbound/target-normalization.js";
import { getToolResult, runMessageAction } from "../../infra/outbound/message-action-runner.js";
import { resolveSessionAgentId } from "../agent-scope.js";
import { normalizeAccountId } from "../../routing/session-key.js";
import { channelTargetSchema, channelTargetsSchema, stringEnum } from "../schema/typebox.js";
import { listChannelSupportedActions } from "../channel-tools.js";
import { normalizeMessageChannel } from "../../utils/message-channel.js";
import { recordSessionHandoff } from "../../config/sessions.js";
import type { AnyAgentTool } from "./common.js";
import { jsonResult, readNumberParam, readStringParam } from "./common.js";

const AllMessageActions = CHANNEL_MESSAGE_ACTION_NAMES;
function buildRoutingSchema() {
  return {
    channel: Type.Optional(Type.String()),
    target: Type.Optional(channelTargetSchema({ description: "Target channel/user id or name." })),
    targets: Type.Optional(channelTargetsSchema()),
    accountId: Type.Optional(Type.String()),
    dryRun: Type.Optional(Type.Boolean()),
    handoff: Type.Optional(
      Type.Boolean({
        description:
          "If true, route the next inbound DM from this target back to the current session (handoff).",
      }),
    ),
    handoffTtlMinutes: Type.Optional(
      Type.Number({
        description: "How long the handoff stays active (minutes). Default: 360.",
        minimum: 1,
      }),
    ),
  };
}

function buildSendSchema(options: { includeButtons: boolean; includeCards: boolean }) {
  const props: Record<string, unknown> = {
    message: Type.Optional(Type.String()),
    effectId: Type.Optional(
      Type.String({
        description: "Message effect name/id for sendWithEffect (e.g., invisible ink).",
      }),
    ),
    effect: Type.Optional(
      Type.String({ description: "Alias for effectId (e.g., invisible-ink, balloons)." }),
    ),
    media: Type.Optional(Type.String()),
    filename: Type.Optional(Type.String()),
    buffer: Type.Optional(
      Type.String({
        description: "Base64 payload for attachments (optionally a data: URL).",
      }),
    ),
    contentType: Type.Optional(Type.String()),
    mimeType: Type.Optional(Type.String()),
    caption: Type.Optional(Type.String()),
    path: Type.Optional(Type.String()),
    filePath: Type.Optional(Type.String()),
    replyTo: Type.Optional(Type.String()),
    threadId: Type.Optional(Type.String()),
    asVoice: Type.Optional(Type.Boolean()),
    silent: Type.Optional(Type.Boolean()),
    quoteText: Type.Optional(
      Type.String({ description: "Quote text for replies when supported by the channel." }),
    ),
    bestEffort: Type.Optional(Type.Boolean()),
    gifPlayback: Type.Optional(Type.Boolean()),
    buttons: Type.Optional(
      Type.Array(
        Type.Array(
          Type.Object({
            text: Type.String(),
            callback_data: Type.String(),
          }),
        ),
        {
          description: "Inline keyboard buttons as JSON (array of button rows) when supported by the channel.",
        },
      ),
    ),
    card: Type.Optional(
      Type.Object(
        {},
        {
          additionalProperties: true,
          description: "Adaptive Card JSON object (when supported by the channel)",
        },
      ),
    ),
  };
  if (!options.includeButtons) delete props.buttons;
  if (!options.includeCards) delete props.card;
  return props;
}

function buildReactionSchema() {
  return {
    messageId: Type.Optional(Type.String()),
    emoji: Type.Optional(Type.String()),
    remove: Type.Optional(Type.Boolean()),
    targetAuthor: Type.Optional(Type.String()),
    targetAuthorUuid: Type.Optional(Type.String()),
    groupId: Type.Optional(Type.String()),
  };
}

function buildFetchSchema() {
  return {
    limit: Type.Optional(Type.Number()),
    before: Type.Optional(Type.String()),
    after: Type.Optional(Type.String()),
    around: Type.Optional(Type.String()),
    fromMe: Type.Optional(Type.Boolean()),
    includeArchived: Type.Optional(Type.Boolean()),
  };
}

function buildPollSchema() {
  return {
    pollQuestion: Type.Optional(Type.String()),
    pollOption: Type.Optional(Type.Array(Type.String())),
    pollDurationHours: Type.Optional(Type.Number()),
    pollMulti: Type.Optional(Type.Boolean()),
  };
}

function buildChannelTargetSchema() {
  return {
    channelId: Type.Optional(
      Type.String({ description: "Channel id filter (search/thread list/event create)." }),
    ),
    channelIds: Type.Optional(
      Type.Array(Type.String({ description: "Channel id filter (repeatable)." })),
    ),
    guildId: Type.Optional(Type.String()),
    userId: Type.Optional(Type.String()),
    authorId: Type.Optional(Type.String()),
    authorIds: Type.Optional(Type.Array(Type.String())),
    roleId: Type.Optional(Type.String()),
    roleIds: Type.Optional(Type.Array(Type.String())),
    participant: Type.Optional(Type.String()),
  };
}

function buildStickerSchema() {
  return {
    emojiName: Type.Optional(Type.String()),
    stickerId: Type.Optional(Type.Array(Type.String())),
    stickerName: Type.Optional(Type.String()),
    stickerDesc: Type.Optional(Type.String()),
    stickerTags: Type.Optional(Type.String()),
  };
}

function buildThreadSchema() {
  return {
    threadName: Type.Optional(Type.String()),
    autoArchiveMin: Type.Optional(Type.Number()),
  };
}

function buildEventSchema() {
  return {
    query: Type.Optional(Type.String()),
    eventName: Type.Optional(Type.String()),
    eventType: Type.Optional(Type.String()),
    startTime: Type.Optional(Type.String()),
    endTime: Type.Optional(Type.String()),
    desc: Type.Optional(Type.String()),
    location: Type.Optional(Type.String()),
    durationMin: Type.Optional(Type.Number()),
    until: Type.Optional(Type.String()),
  };
}

function buildModerationSchema() {
  return {
    reason: Type.Optional(Type.String()),
    deleteDays: Type.Optional(Type.Number()),
  };
}

function buildGatewaySchema() {
  return {
    gatewayUrl: Type.Optional(Type.String()),
    gatewayToken: Type.Optional(Type.String()),
    timeoutMs: Type.Optional(Type.Number()),
  };
}

function buildChannelManagementSchema() {
  return {
    name: Type.Optional(Type.String()),
    type: Type.Optional(Type.Number()),
    parentId: Type.Optional(Type.String()),
    topic: Type.Optional(Type.String()),
    position: Type.Optional(Type.Number()),
    nsfw: Type.Optional(Type.Boolean()),
    rateLimitPerUser: Type.Optional(Type.Number()),
    categoryId: Type.Optional(Type.String()),
    clearParent: Type.Optional(
      Type.Boolean({
        description: "Clear the parent/category when supported by the provider.",
      }),
    ),
  };
}

function buildMessageToolSchemaProps(options: { includeButtons: boolean; includeCards: boolean }) {
  return {
    ...buildRoutingSchema(),
    ...buildSendSchema(options),
    ...buildReactionSchema(),
    ...buildFetchSchema(),
    ...buildPollSchema(),
    ...buildChannelTargetSchema(),
    ...buildStickerSchema(),
    ...buildThreadSchema(),
    ...buildEventSchema(),
    ...buildModerationSchema(),
    ...buildGatewaySchema(),
    ...buildChannelManagementSchema(),
  };
}

function buildMessageToolSchemaFromActions(
  actions: readonly string[],
  options: { includeButtons: boolean; includeCards: boolean },
) {
  const props = buildMessageToolSchemaProps(options);
  return Type.Object({
    action: stringEnum(actions),
    ...props,
  });
}

const MessageToolSchema = buildMessageToolSchemaFromActions(AllMessageActions, {
  includeButtons: true,
  includeCards: true,
});

type MessageToolOptions = {
  agentAccountId?: string;
  agentSessionKey?: string;
  config?: ZeeConfig;
  currentChannelId?: string;
  currentChannelProvider?: string;
  currentThreadTs?: string;
  replyToMode?: "off" | "first" | "all";
  hasRepliedRef?: { value: boolean };
};

function buildMessageToolSchema(cfg: ZeeConfig) {
  const actions = listChannelMessageActions(cfg);
  const includeButtons = supportsChannelMessageButtons(cfg);
  const includeCards = supportsChannelMessageCards(cfg);
  return buildMessageToolSchemaFromActions(actions.length > 0 ? actions : ["send"], {
    includeButtons,
    includeCards,
  });
}

function resolveAgentAccountId(value?: string): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  return normalizeAccountId(trimmed);
}

function readBooleanParam(params: Record<string, unknown>, key: string): boolean | undefined {
  const raw = params[key];
  if (typeof raw === "boolean") return raw;
  if (typeof raw === "string") {
    const trimmed = raw.trim().toLowerCase();
    if (trimmed === "true") return true;
    if (trimmed === "false") return false;
  }
  return undefined;
}

function filterActionsForContext(params: {
  actions: ChannelMessageActionName[];
  channel?: string;
  currentChannelId?: string;
}): ChannelMessageActionName[] {
  return params.actions;
}

function buildMessageToolDescription(options?: {
  config?: ZeeConfig;
  currentChannel?: string;
  currentChannelId?: string;
}): string {
  const baseDescription = "Send, delete, and manage messages via channel plugins.";

  // If we have a current channel, show only its supported actions
  if (options?.currentChannel) {
    const channelActions = filterActionsForContext({
      actions: listChannelSupportedActions({
        cfg: options.config,
        channel: options.currentChannel,
      }),
      channel: options.currentChannel,
      currentChannelId: options.currentChannelId,
    });
    if (channelActions.length > 0) {
      // Always include "send" as a base action
      const allActions = new Set(["send", ...channelActions]);
      const actionList = Array.from(allActions).sort().join(", ");
      return `${baseDescription} Current channel (${options.currentChannel}) supports: ${actionList}.`;
    }
  }

  // Fallback to generic description with all configured actions
  if (options?.config) {
    const actions = listChannelMessageActions(options.config);
    if (actions.length > 0) {
      return `${baseDescription} Supports actions: ${actions.join(", ")}.`;
    }
  }

  return `${baseDescription} Supports actions: send, delete, react, poll, pin, threads, and more.`;
}

export function createMessageTool(options?: MessageToolOptions): AnyAgentTool {
  const agentAccountId = resolveAgentAccountId(options?.agentAccountId);
  const schema = options?.config ? buildMessageToolSchema(options.config) : MessageToolSchema;
  const description = buildMessageToolDescription({
    config: options?.config,
    currentChannel: options?.currentChannelProvider,
    currentChannelId: options?.currentChannelId,
  });

  return {
    label: "Message",
    name: "message",
    description,
    parameters: schema,
    execute: async (_toolCallId, args, signal) => {
      // Check if already aborted before doing any work
      if (signal?.aborted) {
        const err = new Error("Message send aborted");
        err.name = "AbortError";
        throw err;
      }
      const params = args as Record<string, unknown>;
      const cfg = options?.config ?? loadConfig();
      const action = readStringParam(params, "action", {
        required: true,
      }) as ChannelMessageActionName;

      const handoffValue = readBooleanParam(params, "handoff");
      const handoffTtlMinutes = readNumberParam(params, "handoffTtlMinutes", { integer: true });
      delete params.handoff;
      delete params.handoffTtlMinutes;

      const explicitTarget =
        typeof params.target === "string" ? params.target.trim() : "";
      const legacyTo = typeof params.to === "string" ? params.to.trim() : "";
      const legacyChannelId =
        typeof params.channelId === "string" ? params.channelId.trim() : "";
      const hasTarget = Boolean(explicitTarget || legacyTo || legacyChannelId);
      const rawChannel = typeof params.channel === "string" ? params.channel.trim() : "";
      const normalizedChannel = normalizeMessageChannel(rawChannel);
      const wantsWhatsApp = normalizedChannel
        ? normalizedChannel === "whatsapp"
        : Boolean(cfg.channels?.whatsapp);
      const userPhone = cfg.user?.phone?.trim();
      const normalizedUserTarget = userPhone
        ? normalizeTargetForProvider("whatsapp", userPhone) ?? userPhone
        : undefined;
      const normalizedExplicitTarget =
        explicitTarget && wantsWhatsApp
          ? normalizeTargetForProvider("whatsapp", explicitTarget) ?? explicitTarget
          : explicitTarget;
      const normalizedLegacyTarget =
        legacyTo && wantsWhatsApp
          ? normalizeTargetForProvider("whatsapp", legacyTo) ?? legacyTo
          : legacyTo;
      const normalizedLegacyChannelTarget =
        legacyChannelId && wantsWhatsApp
          ? normalizeTargetForProvider("whatsapp", legacyChannelId) ?? legacyChannelId
          : legacyChannelId;
      const resolvedTarget =
        normalizedExplicitTarget || normalizedLegacyTarget || normalizedLegacyChannelTarget;
      const isUserTarget =
        Boolean(normalizedUserTarget) &&
        Boolean(resolvedTarget) &&
        resolvedTarget === normalizedUserTarget;
      const shouldDefaultHandoff =
        handoffValue === undefined &&
        action === "send" &&
        wantsWhatsApp &&
        Boolean(userPhone) &&
        (!hasTarget || isUserTarget);
      const handoffRequested = handoffValue ?? shouldDefaultHandoff;

      if (handoffRequested && action === "send" && !hasTarget) {
        if (wantsWhatsApp && userPhone) {
          params.target = normalizedUserTarget ?? userPhone;
          if (!rawChannel) params.channel = "whatsapp";
        }
      }

      const accountId = readStringParam(params, "accountId") ?? agentAccountId;
      if (accountId) {
        params.accountId = accountId;
      }

      const gateway = {
        url: readStringParam(params, "gatewayUrl", { trim: false }),
        token: readStringParam(params, "gatewayToken", { trim: false }),
        timeoutMs: readNumberParam(params, "timeoutMs"),
        clientName: GATEWAY_CLIENT_IDS.GATEWAY_CLIENT,
        clientDisplayName: "agent",
        mode: GATEWAY_CLIENT_MODES.BACKEND,
      };

      const toolContext =
        options?.currentChannelId ||
        options?.currentChannelProvider ||
        options?.currentThreadTs ||
        options?.replyToMode ||
        options?.hasRepliedRef
          ? {
              currentChannelId: options?.currentChannelId,
              currentChannelProvider: options?.currentChannelProvider,
              currentThreadTs: options?.currentThreadTs,
              replyToMode: options?.replyToMode,
              hasRepliedRef: options?.hasRepliedRef,
              // Direct tool invocations should not add cross-context decoration.
              // The agent is composing a message, not forwarding from another chat.
              skipCrossContextDecoration: true,
            }
          : undefined;

      const result = await runMessageAction({
        cfg,
        action,
        params,
        defaultAccountId: accountId ?? undefined,
        gateway,
        toolContext,
        agentId: options?.agentSessionKey
          ? resolveSessionAgentId({ sessionKey: options.agentSessionKey, config: cfg })
          : undefined,
        abortSignal: signal,
      });

      if (
        handoffRequested &&
        result.kind === "send" &&
        !result.dryRun &&
        options?.agentSessionKey?.trim()
      ) {
        try {
          await recordSessionHandoff({
            channel: result.channel,
            accountId,
            target: result.to,
            sessionKey: options.agentSessionKey,
            ttlMinutes: handoffTtlMinutes ?? undefined,
          });
        } catch {
          // Best-effort only; handoff should not break message delivery.
        }
      }

      const toolResult = getToolResult(result);
      if (toolResult) return toolResult;
      return jsonResult(result.payload);
    },
  };
}
