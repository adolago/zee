import type { ZeeConfig } from "../config/config.js";
import { resolveWhatsAppAccount } from "../web/accounts.js";
import { normalizeWhatsAppTarget } from "../whatsapp/normalize.js";
import { requireActivePluginRegistry } from "../plugins/runtime.js";
import {
  resolveWhatsAppGroupRequireMention,
  resolveWhatsAppGroupToolPolicy,
} from "./plugins/group-mentions.js";
import type {
  ChannelCapabilities,
  ChannelCommandAdapter,
  ChannelElevatedAdapter,
  ChannelGroupAdapter,
  ChannelId,
  ChannelAgentPromptAdapter,
  ChannelMentionAdapter,
  ChannelPlugin,
  ChannelThreadingAdapter,
} from "./plugins/types.js";
import { CHAT_CHANNEL_ORDER, type ChatChannelId, getChatChannelMeta } from "./registry.js";

export type ChannelDock = {
  id: ChannelId;
  capabilities: ChannelCapabilities;
  commands?: ChannelCommandAdapter;
  outbound?: {
    textChunkLimit?: number;
  };
  streaming?: ChannelDockStreaming;
  elevated?: ChannelElevatedAdapter;
  config?: {
    resolveAllowFrom?: (params: {
      cfg: ZeeConfig;
      accountId?: string | null;
    }) => Array<string | number> | undefined;
    formatAllowFrom?: (params: {
      cfg: ZeeConfig;
      accountId?: string | null;
      allowFrom: Array<string | number>;
    }) => string[];
  };
  groups?: ChannelGroupAdapter;
  mentions?: ChannelMentionAdapter;
  threading?: ChannelThreadingAdapter;
  agentPrompt?: ChannelAgentPromptAdapter;
};

type ChannelDockStreaming = {
  blockStreamingCoalesceDefaults?: {
    minChars?: number;
    idleMs?: number;
  };
};

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Channel docks: lightweight channel metadata/behavior for shared code paths.
//
// Rules:
// - keep this module *light* (no monitors, probes, puppeteer/web login, etc)
// - OK: config readers, allowFrom formatting, mention stripping patterns, threading defaults
// - shared code should import from here (and from `src/channels/registry.ts`), not from the plugins registry
//
// Adding a channel:
// - add a new entry to `DOCKS`
// - keep it cheap; push heavy logic into `src/channels/plugins/<id>.ts` or channel modules
const DOCKS: Record<ChatChannelId, ChannelDock> = {
  whatsapp: {
    id: "whatsapp",
    capabilities: {
      chatTypes: ["direct", "group"],
      polls: true,
      reactions: true,
      media: true,
    },
    agentPrompt: {
      messageToolHints: () => [
        "- WhatsApp handoff: when you send a proactive WhatsApp message because the user asked to continue there, set `handoff: true` on the `message` tool send (one-time).",
        '- Treat these as explicit handoff phrases: "continue on WhatsApp", "switch to WhatsApp", "reply on WhatsApp".',
        "- If the user says reply on WhatsApp without a target, default to the configured user.phone.",
        "- Handoff is for WhatsApp DMs only; do not use it for groups.",
      ],
    },
    commands: {
      enforceOwnerForCommands: true,
      skipWhenConfigEmpty: true,
    },
    outbound: { textChunkLimit: 4000 },
    config: {
      resolveAllowFrom: ({ cfg, accountId }) =>
        resolveWhatsAppAccount({ cfg, accountId }).allowFrom ?? [],
      formatAllowFrom: ({ allowFrom }) =>
        allowFrom
          .map((entry) => String(entry).trim())
          .filter((entry): entry is string => Boolean(entry))
          .map((entry) => (entry === "*" ? entry : normalizeWhatsAppTarget(entry)))
          .filter((entry): entry is string => Boolean(entry)),
    },
    groups: {
      resolveRequireMention: resolveWhatsAppGroupRequireMention,
      resolveToolPolicy: resolveWhatsAppGroupToolPolicy,
      resolveGroupIntroHint: () =>
        "WhatsApp IDs: SenderId is the participant JID; [message_id: ...] is the message id for reactions (use SenderId as participant).",
    },
    mentions: {
      stripPatterns: ({ ctx }) => {
        const selfE164 = (ctx.To ?? "").replace(/^whatsapp:/, "");
        if (!selfE164) return [];
        const escaped = escapeRegExp(selfE164);
        return [escaped, `@${escaped}`];
      },
    },
    threading: {
      buildToolContext: ({ context, hasRepliedRef }) => {
        const channelId = context.From?.trim() || context.To?.trim() || undefined;
        return {
          currentChannelId: channelId,
          currentThreadTs: context.ReplyToId,
          hasRepliedRef,
        };
      },
    },
  },
};

function buildDockFromPlugin(plugin: ChannelPlugin): ChannelDock {
  return {
    id: plugin.id,
    capabilities: plugin.capabilities,
    commands: plugin.commands,
    outbound: plugin.outbound?.textChunkLimit
      ? { textChunkLimit: plugin.outbound.textChunkLimit }
      : undefined,
    streaming: plugin.streaming
      ? { blockStreamingCoalesceDefaults: plugin.streaming.blockStreamingCoalesceDefaults }
      : undefined,
    elevated: plugin.elevated,
    config: plugin.config
      ? {
          resolveAllowFrom: plugin.config.resolveAllowFrom,
          formatAllowFrom: plugin.config.formatAllowFrom,
        }
      : undefined,
    groups: plugin.groups,
    mentions: plugin.mentions,
    threading: plugin.threading,
    agentPrompt: plugin.agentPrompt,
  };
}

function listPluginDockEntries(): Array<{ id: ChannelId; dock: ChannelDock; order?: number }> {
  const registry = requireActivePluginRegistry();
  const entries: Array<{ id: ChannelId; dock: ChannelDock; order?: number }> = [];
  const seen = new Set<string>();
  for (const entry of registry.channels) {
    const plugin = entry.plugin;
    const id = String(plugin.id).trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    if ((CHAT_CHANNEL_ORDER as readonly string[]).includes(String(plugin.id))) continue;
    const dock = entry.dock ?? buildDockFromPlugin(plugin);
    entries.push({ id: plugin.id, dock, order: plugin.meta.order });
  }
  return entries;
}

export function listChannelDocks(): ChannelDock[] {
  const baseEntries = CHAT_CHANNEL_ORDER.map((id) => ({
    id,
    dock: DOCKS[id],
    order: getChatChannelMeta(id)?.order,
  }));
  const pluginEntries = listPluginDockEntries();
  const combined = [...baseEntries, ...pluginEntries];
  combined.sort((a, b) => {
    const indexA = (CHAT_CHANNEL_ORDER as readonly string[]).indexOf(String(a.id));
    const indexB = (CHAT_CHANNEL_ORDER as readonly string[]).indexOf(String(b.id));
    const orderA = a.order ?? (indexA === -1 ? 999 : indexA);
    const orderB = b.order ?? (indexB === -1 ? 999 : indexB);
    if (orderA !== orderB) return orderA - orderB;
    return String(a.id).localeCompare(String(b.id));
  });
  return combined.map((entry) => entry.dock);
}

export function getChannelDock(id: ChannelId): ChannelDock | undefined {
  const core = DOCKS[id as ChatChannelId];
  if (core) return core;
  const registry = requireActivePluginRegistry();
  const pluginEntry = registry.channels.find((entry) => entry.plugin.id === id);
  if (!pluginEntry) return undefined;
  return pluginEntry.dock ?? buildDockFromPlugin(pluginEntry.plugin);
}
