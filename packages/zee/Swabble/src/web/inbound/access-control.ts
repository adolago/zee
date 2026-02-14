import { loadConfig } from "../../config/config.js";
import { logVerbose } from "../../globals.js";
import { isSelfChatMode, normalizeE164 } from "../../utils.js";
import { normalizeWhatsAppTarget } from "../../whatsapp/normalize.js";
import { resolveWhatsAppAccount } from "../accounts.js";

export type InboundAccessControlResult = {
  allowed: boolean;
  shouldMarkRead: boolean;
  isSelfChat: boolean;
  resolvedAccountId: string;
};

export async function checkInboundAccessControl(params: {
  accountId: string;
  from: string;
  selfE164: string | null;
  senderE164: string | null;
  group: boolean;
  pushName?: string;
  isFromMe: boolean;
  remoteJid: string;
}): Promise<InboundAccessControlResult> {
  const cfg = loadConfig();
  const account = resolveWhatsAppAccount({
    cfg,
    accountId: params.accountId,
  });
  const configuredDmPolicy = cfg.channels?.whatsapp?.dmPolicy;
  const configuredAllowFrom = account.allowFrom;
  // Without user config, default to self-only DM access so the owner can talk to themselves.
  const combinedAllowFrom = Array.from(
    new Set([...(configuredAllowFrom ?? [])]),
  );
  const dmPolicy = configuredDmPolicy ?? "allowlist";
  const defaultAllowFrom =
    combinedAllowFrom.length === 0 && params.selfE164 ? [params.selfE164] : undefined;
  const allowFrom = combinedAllowFrom.length > 0 ? combinedAllowFrom : defaultAllowFrom;
  const groupAllowFrom =
    account.groupAllowFrom ??
    (configuredAllowFrom && configuredAllowFrom.length > 0 ? configuredAllowFrom : undefined);
  const isSamePhone = params.from === params.selfE164;
  const isSelfChat = isSelfChatMode(params.selfE164, configuredAllowFrom);
  // Pre-compute normalized allowlists for filtering.
  // Use normalizeWhatsAppTarget first (strips JID device suffixes like :0@s.whatsapp.net),
  // falling back to normalizeE164 for plain phone numbers.
  const normalizeAllowEntry = (entry: string): string => {
    const waTarget = normalizeWhatsAppTarget(entry);
    return waTarget ?? normalizeE164(entry);
  };
  const dmHasWildcard = allowFrom?.includes("*") ?? false;
  const normalizedAllowFrom =
    allowFrom && allowFrom.length > 0
      ? allowFrom.filter((entry) => entry !== "*").map(normalizeAllowEntry)
      : [];
  const groupHasWildcard = groupAllowFrom?.includes("*") ?? false;
  const normalizedGroupAllowFrom =
    groupAllowFrom && groupAllowFrom.length > 0
      ? groupAllowFrom.filter((entry) => entry !== "*").map(normalizeAllowEntry)
      : [];

  // Group policy filtering:
  // - "open": groups bypass allowFrom, only mention-gating applies
  // - "disabled": block all group messages entirely
  // - "allowlist": only allow group messages from senders in groupAllowFrom/allowFrom
  const defaultGroupPolicy = cfg.channels?.defaults?.groupPolicy;
  const groupPolicy = account.groupPolicy ?? defaultGroupPolicy ?? "open";
  if (params.group && groupPolicy === "disabled") {
    logVerbose("Blocked group message (groupPolicy: disabled)");
    return {
      allowed: false,
      shouldMarkRead: false,
      isSelfChat,
      resolvedAccountId: account.accountId,
    };
  }
  if (params.group && groupPolicy === "allowlist") {
    if (!groupAllowFrom || groupAllowFrom.length === 0) {
      logVerbose("Blocked group message (groupPolicy: allowlist, no groupAllowFrom)");
      return {
        allowed: false,
        shouldMarkRead: false,
        isSelfChat,
        resolvedAccountId: account.accountId,
      };
    }
    const senderAllowed =
      groupHasWildcard ||
      (params.senderE164 != null && normalizedGroupAllowFrom.includes(params.senderE164));
    if (!senderAllowed) {
      logVerbose(
        `Blocked group message from ${params.senderE164 ?? "unknown sender"} (groupPolicy: allowlist)`,
      );
      return {
        allowed: false,
        shouldMarkRead: false,
        isSelfChat,
        resolvedAccountId: account.accountId,
      };
    }
  }

  // DM access control defaults: "allowlist" (default) / "open" / "disabled".
  if (!params.group) {
    if (params.isFromMe && !isSamePhone) {
      logVerbose("Skipping outbound DM (fromMe).");
      return {
        allowed: false,
        shouldMarkRead: false,
        isSelfChat,
        resolvedAccountId: account.accountId,
      };
    }
    if (dmPolicy === "disabled") {
      logVerbose("Blocked dm (dmPolicy: disabled)");
      return {
        allowed: false,
        shouldMarkRead: false,
        isSelfChat,
        resolvedAccountId: account.accountId,
      };
    }
    if (dmPolicy !== "open" && !isSamePhone) {
      const candidate = params.from;
      const allowed =
        dmHasWildcard ||
        (normalizedAllowFrom.length > 0 && normalizedAllowFrom.includes(candidate));
      if (!allowed) {
        logVerbose(`Blocked unauthorized sender ${candidate} (dmPolicy=${dmPolicy})`);
        return {
          allowed: false,
          shouldMarkRead: false,
          isSelfChat,
          resolvedAccountId: account.accountId,
        };
      }
    }
  }

  return {
    allowed: true,
    shouldMarkRead: true,
    isSelfChat,
    resolvedAccountId: account.accountId,
  };
}
