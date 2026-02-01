import type { ChannelMeta } from "./plugins/types.js";
import type { ChannelId } from "./plugins/types.js";
import { requireActivePluginRegistry } from "../plugins/runtime.js";

// Default priority for built-in channels. Lower number = higher priority.
// Extensions can register additional channels with their own priority via the
// plugin registry; this map covers the bundled ones only.
export const DEFAULT_CHANNEL_PRIORITY: Record<string, number> = {
  telegram: 10,
  whatsapp: 20,
  matrix: 30,
};

// Legacy constant kept for backward compatibility. Prefer listChannelPluginIds()
// for dynamic channel enumeration.
export const CHAT_CHANNEL_ORDER = [
  "telegram",
  "whatsapp",
] as const;

export type ChatChannelId = (typeof CHAT_CHANNEL_ORDER)[number] | (string & {});

export const CHANNEL_IDS = [...CHAT_CHANNEL_ORDER] as const;

export const DEFAULT_CHAT_CHANNEL: ChatChannelId = "whatsapp";

export type ChatChannelMeta = ChannelMeta;

const WEBSITE_URL = "https://docs.zee";

const BUILTIN_CHANNEL_META: Record<string, ChannelMeta> = {
  telegram: {
    id: "telegram",
    label: "Telegram",
    selectionLabel: "Telegram (Bot API)",
    detailLabel: "Telegram Bot",
    docsPath: "/channels/telegram",
    docsLabel: "telegram",
    blurb: "simplest way to get started — register a bot with @BotFather and get going.",
    systemImage: "paperplane",
    selectionDocsPrefix: "",
    selectionDocsOmitLabel: true,
    selectionExtras: [WEBSITE_URL],
  },
  whatsapp: {
    id: "whatsapp",
    label: "WhatsApp",
    selectionLabel: "WhatsApp (QR link)",
    detailLabel: "WhatsApp Web",
    docsPath: "/channels/whatsapp",
    docsLabel: "whatsapp",
    blurb: "works with your own number; recommend a separate phone + eSIM.",
    systemImage: "message",
  },
  matrix: {
    id: "matrix",
    label: "Matrix",
    selectionLabel: "Matrix (E2EE)",
    detailLabel: "Matrix Homeserver",
    docsPath: "/channels/matrix",
    docsLabel: "matrix",
    blurb: "end-to-end encrypted messaging via any Matrix homeserver.",
    systemImage: "lock.shield",
  },
};

export const CHAT_CHANNEL_ALIASES: Record<string, ChatChannelId> = {};

const normalizeChannelKey = (raw?: string | null): string | undefined => {
  const normalized = raw?.trim().toLowerCase();
  return normalized || undefined;
};

/**
 * List all registered channel plugins, ordered by priority.
 * Falls back to built-in meta when the plugin registry is not yet initialized.
 */
export function listChannelPluginIds(): string[] {
  try {
    const registry = requireActivePluginRegistry();
    const entries = [...registry.channels];
    entries.sort((a, b) => {
      const pa = a.plugin.meta.order ?? DEFAULT_CHANNEL_PRIORITY[String(a.plugin.id)] ?? 999;
      const pb = b.plugin.meta.order ?? DEFAULT_CHANNEL_PRIORITY[String(b.plugin.id)] ?? 999;
      return pa - pb;
    });
    return entries.map((e) => String(e.plugin.id));
  } catch {
    // Registry not initialized yet; return built-in order
    return Object.keys(DEFAULT_CHANNEL_PRIORITY).sort(
      (a, b) => (DEFAULT_CHANNEL_PRIORITY[a] ?? 999) - (DEFAULT_CHANNEL_PRIORITY[b] ?? 999),
    );
  }
}

export function listChatChannels(): ChatChannelMeta[] {
  const ids = listChannelPluginIds();
  return ids
    .map((id) => BUILTIN_CHANNEL_META[id])
    .filter((meta): meta is ChannelMeta => meta != null);
}

export function listChatChannelAliases(): string[] {
  return Object.keys(CHAT_CHANNEL_ALIASES);
}

export function getChatChannelMeta(id: ChatChannelId): ChatChannelMeta | undefined {
  return BUILTIN_CHANNEL_META[id];
}

export function normalizeChatChannelId(raw?: string | null): ChatChannelId | null {
  const normalized = normalizeChannelKey(raw);
  if (!normalized) return null;
  const resolved = CHAT_CHANNEL_ALIASES[normalized] ?? normalized;
  // Check built-in channels first
  if (resolved in BUILTIN_CHANNEL_META) return resolved as ChatChannelId;
  // Check legacy order for backward compatibility
  return CHAT_CHANNEL_ORDER.includes(resolved as (typeof CHAT_CHANNEL_ORDER)[number])
    ? (resolved as ChatChannelId)
    : null;
}

// Channel docking: prefer this helper in shared code. Importing from
// `src/channels/plugins/*` can eagerly load channel implementations.
export function normalizeChannelId(raw?: string | null): ChatChannelId | null {
  return normalizeChatChannelId(raw);
}

// Normalizes registered channel plugins (bundled or external).
//
// Keep this light: we do not import channel plugins here (those are "heavy" and can pull in
// monitors, web login, etc). The plugin registry must be initialized first.
export function normalizeAnyChannelId(raw?: string | null): ChannelId | null {
  const key = normalizeChannelKey(raw);
  if (!key) return null;

  const registry = requireActivePluginRegistry();
  const hit = registry.channels.find((entry) => {
    const id = String(entry.plugin.id ?? "")
      .trim()
      .toLowerCase();
    if (id && id === key) return true;
    return (entry.plugin.meta.aliases ?? []).some((alias) => alias.trim().toLowerCase() === key);
  });
  return (hit?.plugin.id as ChannelId | undefined) ?? null;
}

export function formatChannelPrimerLine(meta: ChatChannelMeta): string {
  return `${meta.label}: ${meta.blurb}`;
}

export function formatChannelSelectionLine(
  meta: ChatChannelMeta,
  docsLink: (path: string, label?: string) => string,
): string {
  const docsPrefix = meta.selectionDocsPrefix ?? "Docs:";
  const docsLabel = meta.docsLabel ?? meta.id;
  const docs = meta.selectionDocsOmitLabel
    ? docsLink(meta.docsPath)
    : docsLink(meta.docsPath, docsLabel);
  const extras = (meta.selectionExtras ?? []).filter(Boolean).join(" ");
  return `${meta.label} — ${meta.blurb} ${docsPrefix ? `${docsPrefix} ` : ""}${docs}${extras ? ` ${extras}` : ""}`;
}
