import { z } from "zod";

import {
  DEFAULT_ACCOUNT_ID,
  DmPolicySchema,
  GroupPolicySchema,
  addWildcardAllowFrom,
  applyAccountNameToChannelSection,
  buildChannelConfigSchema,
  deleteAccountFromConfigSection,
  formatDocsLink,
  formatPairingApproveHint,
  missingTargetError,
  normalizeAccountId,
  promptAccountId,
  requireOpenAllowFrom,
  setAccountEnabledInConfigSection,
  type ChannelOnboardingAdapter,
  type ChannelPlugin,
  type ChannelStatusIssue,
  type DmPolicy,
  type ZeeConfig,
} from "zee/plugin-sdk";

const DISCORD_META = {
  id: "discord",
  label: "Discord",
  selectionLabel: "Discord Bot",
  detailLabel: "Discord REST",
  docsPath: "/channels/discord",
  docsLabel: "discord",
  blurb: "bot token + channel id routing; DM/group policy controls and mention gating.",
  order: 40,
  aliases: ["dc"],
  systemImage: "bubble.left.and.bubble.right",
  quickstartAllowFrom: true,
  forceAccountBinding: true,
} as const;

const DISCORD_BOT_TOKEN_ENV = "DISCORD_BOT_TOKEN";
const DISCORD_API_BASE = "https://discord.com/api/v10";

const DiscordAccountSchema = z
  .object({
    name: z.string().trim().min(1).optional(),
    enabled: z.boolean().optional(),
    botToken: z.string().trim().min(1).optional(),
    guildId: z.string().trim().min(1).optional(),
    defaultChannel: z.string().trim().min(1).optional(),
    dmPolicy: DmPolicySchema.optional(),
    allowFrom: z.array(z.string().trim().min(1)).optional(),
    groupPolicy: GroupPolicySchema.optional(),
    groupAllowFrom: z.array(z.string().trim().min(1)).optional(),
    requireMention: z.boolean().optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    requireOpenAllowFrom({
      policy: value.dmPolicy,
      allowFrom: value.allowFrom,
      ctx,
      path: ["allowFrom"],
      message: 'dmPolicy="open" requires allowFrom to include "*"',
    });
  });

const DiscordConfigSchema = z
  .object({
    accounts: z.record(z.string(), DiscordAccountSchema).optional(),
    name: z.string().trim().min(1).optional(),
    enabled: z.boolean().optional(),
    botToken: z.string().trim().min(1).optional(),
    guildId: z.string().trim().min(1).optional(),
    defaultChannel: z.string().trim().min(1).optional(),
    dmPolicy: DmPolicySchema.optional(),
    allowFrom: z.array(z.string().trim().min(1)).optional(),
    groupPolicy: GroupPolicySchema.optional(),
    groupAllowFrom: z.array(z.string().trim().min(1)).optional(),
    requireMention: z.boolean().optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    requireOpenAllowFrom({
      policy: value.dmPolicy,
      allowFrom: value.allowFrom,
      ctx,
      path: ["allowFrom"],
      message: 'channels.discord.dmPolicy="open" requires channels.discord.allowFrom to include "*"',
    });
  });

type DiscordConfig = z.infer<typeof DiscordConfigSchema>;
type DiscordAccountConfig = z.infer<typeof DiscordAccountSchema>;

type ResolvedDiscordAccount = DiscordAccountConfig & {
  accountId: string;
  name?: string;
  enabled: boolean;
  botToken?: string;
  guildId?: string;
  defaultChannel?: string;
  dmPolicy: DmPolicy;
  allowFrom: string[];
  groupPolicy: "allowlist" | "open" | "disabled";
  groupAllowFrom: string[];
  requireMention: boolean;
};

function normalizeEntries(list?: Array<string | number> | null): string[] {
  return (list ?? []).map((entry) => String(entry).trim()).filter(Boolean);
}

function readDiscordConfig(cfg: ZeeConfig): DiscordConfig {
  const raw = (cfg.channels as Record<string, unknown> | undefined)?.discord;
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    return raw as DiscordConfig;
  }
  return {};
}

function listDiscordAccountIds(cfg: ZeeConfig): string[] {
  const section = readDiscordConfig(cfg);
  const ids = Object.keys(section.accounts ?? {}).filter(Boolean);
  return ids.length > 0 ? ids : [DEFAULT_ACCOUNT_ID];
}

function resolveDefaultDiscordAccountId(cfg: ZeeConfig): string {
  const ids = listDiscordAccountIds(cfg);
  if (ids.includes(DEFAULT_ACCOUNT_ID)) return DEFAULT_ACCOUNT_ID;
  return ids[0] ?? DEFAULT_ACCOUNT_ID;
}

function resolveDiscordAccount(cfg: ZeeConfig, accountId?: string | null): ResolvedDiscordAccount {
  const section = readDiscordConfig(cfg);
  const resolvedAccountId = normalizeAccountId(accountId ?? resolveDefaultDiscordAccountId(cfg));
  const account = (section.accounts?.[resolvedAccountId] ?? {}) as DiscordAccountConfig;
  const useTopLevel = resolvedAccountId === DEFAULT_ACCOUNT_ID;
  return {
    accountId: resolvedAccountId,
    name: account.name ?? (useTopLevel ? section.name : undefined),
    enabled: account.enabled ?? (useTopLevel ? section.enabled !== false : true),
    botToken: account.botToken ?? (useTopLevel ? section.botToken : undefined),
    guildId: account.guildId ?? (useTopLevel ? section.guildId : undefined),
    defaultChannel: account.defaultChannel ?? (useTopLevel ? section.defaultChannel : undefined),
    dmPolicy: account.dmPolicy ?? (useTopLevel ? section.dmPolicy : undefined) ?? "pairing",
    allowFrom: normalizeEntries(account.allowFrom ?? (useTopLevel ? section.allowFrom : [])),
    groupPolicy:
      account.groupPolicy ?? (useTopLevel ? section.groupPolicy : undefined) ?? "allowlist",
    groupAllowFrom: normalizeEntries(
      account.groupAllowFrom ?? (useTopLevel ? section.groupAllowFrom : []),
    ),
    requireMention:
      account.requireMention ?? (useTopLevel ? section.requireMention : undefined) ?? true,
  };
}

function hasAccountOverride(cfg: ZeeConfig, accountId: string): boolean {
  return Boolean(readDiscordConfig(cfg).accounts?.[accountId]);
}

function resolveConfigPathPrefix(cfg: ZeeConfig, accountId: string): string {
  if (hasAccountOverride(cfg, accountId)) {
    return `channels.discord.accounts.${accountId}.`;
  }
  return "channels.discord.";
}

function resolveDiscordBotToken(account: ResolvedDiscordAccount): {
  token: string | null;
  source: "config" | "env" | "none";
} {
  const configToken = account.botToken?.trim();
  if (configToken) return { token: configToken, source: "config" };
  const envToken = process.env[DISCORD_BOT_TOKEN_ENV]?.trim();
  if (envToken) return { token: envToken, source: "env" };
  return { token: null, source: "none" };
}

function applyAccountPatch(params: {
  cfg: ZeeConfig;
  accountId: string;
  patch: Partial<DiscordAccountConfig>;
  unsetKeys?: Array<keyof DiscordAccountConfig>;
}): ZeeConfig {
  const accountId = normalizeAccountId(params.accountId);
  const section = readDiscordConfig(params.cfg);
  const accounts = { ...(section.accounts ?? {}) };
  const existing = { ...(accounts[accountId] ?? {}) } as DiscordAccountConfig;
  const next = {
    ...existing,
    ...params.patch,
  } as DiscordAccountConfig;
  for (const key of params.unsetKeys ?? []) {
    delete (next as Record<string, unknown>)[key as string];
  }
  accounts[accountId] = next;
  return {
    ...params.cfg,
    channels: {
      ...params.cfg.channels,
      discord: {
        ...section,
        accounts,
      },
    },
  } as ZeeConfig;
}

function setDiscordDmPolicy(cfg: ZeeConfig, accountId: string, dmPolicy: DmPolicy): ZeeConfig {
  let next = applyAccountPatch({ cfg, accountId, patch: { dmPolicy } });
  if (dmPolicy === "open") {
    const resolved = resolveDiscordAccount(next, accountId);
    next = applyAccountPatch({
      cfg: next,
      accountId,
      patch: {
        allowFrom: addWildcardAllowFrom(resolved.allowFrom),
      },
    });
  }
  return next;
}

function setDiscordAllowFrom(
  cfg: ZeeConfig,
  accountId: string,
  allowFrom?: string[] | null,
): ZeeConfig {
  const normalized = allowFrom ? normalizeEntries(allowFrom) : undefined;
  return applyAccountPatch({
    cfg,
    accountId,
    patch: {
      allowFrom: normalized,
    },
    unsetKeys: normalized ? undefined : ["allowFrom"],
  });
}

function collectDiscordStatusIssues(accounts: Array<Record<string, unknown>>): ChannelStatusIssue[] {
  const issues: ChannelStatusIssue[] = [];
  for (const account of accounts) {
    const accountId =
      typeof account.accountId === "string" && account.accountId.trim()
        ? account.accountId
        : DEFAULT_ACCOUNT_ID;
    if (account.enabled === false) continue;

    if (account.configured !== true) {
      issues.push({
        channel: "discord",
        accountId,
        kind: "config",
        message: "Discord bot token is missing.",
        fix: `Set channels.discord.accounts.${accountId}.botToken or ${DISCORD_BOT_TOKEN_ENV}.`,
      });
      continue;
    }

    const dmPolicy = typeof account.dmPolicy === "string" ? account.dmPolicy : "pairing";
    const allowFrom = Array.isArray(account.allowFrom)
      ? account.allowFrom.map((value) => String(value))
      : [];
    if (dmPolicy === "open" && !allowFrom.includes("*")) {
      issues.push({
        channel: "discord",
        accountId,
        kind: "config",
        message: 'dmPolicy="open" requires allowFrom to include "*".',
      });
    }

    const groupPolicy = typeof account.mode === "string" ? account.mode : "allowlist";
    const requireMention = account.allowUnmentionedGroups !== true;
    if (groupPolicy === "open" && !requireMention) {
      issues.push({
        channel: "discord",
        accountId,
        kind: "permissions",
        message: "Group policy is open and mentions are not required.",
        fix: "Set channels.discord.requireMention=true or channels.discord.groupPolicy=allowlist.",
      });
    }
  }
  return issues;
}

async function sendDiscordText(params: {
  account: ResolvedDiscordAccount;
  to: string;
  text: string;
}): Promise<{
  messageId: string;
  channelId: string;
  timestamp: number;
}> {
  const token = resolveDiscordBotToken(params.account).token;
  if (!token) {
    throw new Error(
      `Discord bot token is missing. Set channels.discord.botToken or ${DISCORD_BOT_TOKEN_ENV}.`,
    );
  }

  const endpoint = `${DISCORD_API_BASE}/channels/${encodeURIComponent(params.to)}/messages`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  if (typeof timeout.unref === "function") timeout.unref();

  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: {
        authorization: `Bot ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ content: params.text }),
      signal: controller.signal,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Discord send failed: ${message}`);
  } finally {
    clearTimeout(timeout);
  }

  const raw = await response.text();
  let payload: Record<string, unknown> = {};
  try {
    payload = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
  } catch {
    throw new Error(`Discord API returned invalid JSON (${response.status}).`);
  }

  if (!response.ok) {
    const message =
      typeof payload.message === "string" && payload.message.trim()
        ? payload.message.trim()
        : `HTTP ${response.status}`;
    throw new Error(`Discord send failed: ${message}`);
  }

  const messageId = typeof payload.id === "string" ? payload.id : `${Date.now()}`;
  const channelId = typeof payload.channel_id === "string" ? payload.channel_id : params.to;
  const timestampRaw = typeof payload.timestamp === "string" ? Date.parse(payload.timestamp) : NaN;
  const timestamp = Number.isFinite(timestampRaw) ? timestampRaw : Date.now();

  return {
    messageId,
    channelId,
    timestamp,
  };
}

const discordOnboardingAdapter: ChannelOnboardingAdapter = {
  channel: "discord",
  getStatus: async ({ cfg, accountOverrides }) => {
    const overrideId = accountOverrides.discord?.trim();
    const accountId = overrideId
      ? normalizeAccountId(overrideId)
      : resolveDefaultDiscordAccountId(cfg);
    const account = resolveDiscordAccount(cfg, accountId);
    const tokenSource = resolveDiscordBotToken(account).source;
    const configured = tokenSource !== "none";
    return {
      channel: "discord",
      configured,
      statusLines: [
        `Discord (${accountId === DEFAULT_ACCOUNT_ID ? "default" : accountId}): ${
          configured ? `configured (${tokenSource})` : "token missing"
        }`,
      ],
      selectionHint: configured ? "configured" : "token missing",
      quickstartScore: configured ? 3 : 1,
    };
  },
  configure: async ({ cfg, prompter, accountOverrides, shouldPromptAccountIds }) => {
    const overrideId = accountOverrides.discord?.trim();
    let accountId = overrideId
      ? normalizeAccountId(overrideId)
      : resolveDefaultDiscordAccountId(cfg);

    if (shouldPromptAccountIds && !overrideId) {
      accountId = await promptAccountId({
        cfg,
        prompter,
        label: "Discord",
        currentId: accountId,
        listAccountIds: listDiscordAccountIds,
        defaultAccountId: resolveDefaultDiscordAccountId(cfg),
      });
    }

    const current = resolveDiscordAccount(cfg, accountId);
    const tokenInfo = resolveDiscordBotToken(current);

    const botToken = await prompter.text({
      message: `Discord bot token (${accountId})`,
      initialValue: current.botToken,
      placeholder: "Bot token",
      validate: (value) => {
        const trimmed = String(value ?? "").trim();
        if (trimmed) return undefined;
        if (tokenInfo.source !== "none") return undefined;
        return `Required unless ${DISCORD_BOT_TOKEN_ENV} is set.`;
      },
    });

    const defaultChannel = await prompter.text({
      message: "Default Discord channel id (optional)",
      initialValue: current.defaultChannel,
      placeholder: "123456789012345678",
    });

    const requireMention = await prompter.confirm({
      message: "Require mentions for Discord channel messages?",
      initialValue: current.requireMention,
    });

    let next = applyAccountPatch({
      cfg,
      accountId,
      patch: {
        enabled: true,
        requireMention,
      },
    });

    const normalizedToken = String(botToken ?? "").trim();
    if (normalizedToken) {
      next = applyAccountPatch({
        cfg: next,
        accountId,
        patch: {
          botToken: normalizedToken,
        },
      });
    }

    const normalizedChannel = String(defaultChannel ?? "").trim();
    if (normalizedChannel) {
      next = applyAccountPatch({
        cfg: next,
        accountId,
        patch: {
          defaultChannel: normalizedChannel,
        },
      });
    }

    await prompter.note(
      [
        "Discord setup complete.",
        "Use `zee channels status` to verify token + routing.",
        `Docs: ${formatDocsLink("/channels/discord", "channels/discord")}`,
      ].join("\n"),
      "Discord",
    );

    return { cfg: next, accountId };
  },
  dmPolicy: {
    label: "Discord",
    channel: "discord",
    policyKey: "channels.discord.dmPolicy",
    allowFromKey: "channels.discord.allowFrom",
    getCurrent: (cfg) => resolveDiscordAccount(cfg, resolveDefaultDiscordAccountId(cfg)).dmPolicy,
    setPolicy: (cfg, policy) =>
      setDiscordDmPolicy(cfg, resolveDefaultDiscordAccountId(cfg), policy),
    promptAllowFrom: async ({ cfg, prompter, accountId }) => {
      const resolvedAccountId = accountId
        ? normalizeAccountId(accountId)
        : resolveDefaultDiscordAccountId(cfg);
      const account = resolveDiscordAccount(cfg, resolvedAccountId);
      const raw = await prompter.text({
        message: "Discord DM allowFrom (comma-separated user ids)",
        initialValue: account.allowFrom.join(", "),
        placeholder: "12345, 67890",
      });
      const entries = normalizeEntries(String(raw ?? "").split(/[\n,;]+/g));
      return setDiscordAllowFrom(cfg, resolvedAccountId, entries);
    },
  },
};

function normalizeDiscordTarget(raw: string): string | undefined {
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  return trimmed.replace(/^discord:/i, "");
}

function looksLikeDiscordTargetId(raw: string, normalized?: string): boolean {
  const value = (normalized ?? raw).trim();
  return /^\d{15,20}$/.test(value);
}

export const discordPlugin: ChannelPlugin<ResolvedDiscordAccount> = {
  id: "discord",
  meta: DISCORD_META,
  onboarding: discordOnboardingAdapter,
  pairing: {
    idLabel: "discordSenderId",
  },
  capabilities: {
    chatTypes: ["direct", "group", "thread"],
    media: true,
    reactions: true,
    threads: true,
    groupManagement: true,
  },
  configSchema: buildChannelConfigSchema(DiscordConfigSchema),
  config: {
    listAccountIds: (cfg) => listDiscordAccountIds(cfg),
    resolveAccount: (cfg, accountId) => resolveDiscordAccount(cfg, accountId),
    defaultAccountId: (cfg) => resolveDefaultDiscordAccountId(cfg),
    setAccountEnabled: ({ cfg, accountId, enabled }) =>
      setAccountEnabledInConfigSection({
        cfg,
        sectionKey: "discord",
        accountId,
        enabled,
        allowTopLevel: true,
      }),
    deleteAccount: ({ cfg, accountId }) =>
      deleteAccountFromConfigSection({
        cfg,
        sectionKey: "discord",
        accountId,
        clearBaseFields: [
          "name",
          "enabled",
          "botToken",
          "guildId",
          "defaultChannel",
          "dmPolicy",
          "allowFrom",
          "groupPolicy",
          "groupAllowFrom",
          "requireMention",
        ],
      }),
    isEnabled: (account) => account.enabled !== false,
    disabledReason: () => "disabled",
    isConfigured: async (account) => resolveDiscordBotToken(account).source !== "none",
    unconfiguredReason: () => "bot token missing",
    describeAccount: (account) => ({
      accountId: account.accountId,
      name: account.name,
      enabled: account.enabled,
      configured: resolveDiscordBotToken(account).source !== "none",
      dmPolicy: account.dmPolicy,
      allowFrom: account.allowFrom,
      mode: account.groupPolicy,
      allowUnmentionedGroups: account.requireMention === false,
      botTokenSource: resolveDiscordBotToken(account).source,
    }),
    resolveAllowFrom: ({ cfg, accountId }) => resolveDiscordAccount(cfg, accountId).allowFrom,
    formatAllowFrom: ({ allowFrom }) => normalizeEntries(allowFrom),
  },
  security: {
    resolveDmPolicy: ({ cfg, accountId, account }) => {
      const resolvedAccountId = accountId ?? account.accountId ?? DEFAULT_ACCOUNT_ID;
      const prefix = resolveConfigPathPrefix(cfg, resolvedAccountId);
      return {
        policy: account.dmPolicy,
        allowFrom: account.allowFrom,
        policyPath: `${prefix}dmPolicy`,
        allowFromPath: prefix,
        approveHint: formatPairingApproveHint("discord"),
        normalizeEntry: (raw) => raw.trim(),
      };
    },
    collectWarnings: ({ account }) => {
      const warnings: string[] = [];
      if (account.groupPolicy === "open") {
        if (account.requireMention) {
          warnings.push(
            '- Discord channels: groupPolicy="open" allows any member in allowed channels to trigger when Zee is mentioned. Prefer groupPolicy="allowlist" for tighter control.',
          );
        } else {
          warnings.push(
            '- Discord channels: groupPolicy="open" with requireMention=false allows any member to trigger actions. Set requireMention=true or groupPolicy="allowlist".',
          );
        }
      }
      return warnings;
    },
  },
  setup: {
    resolveAccountId: ({ accountId }) => normalizeAccountId(accountId),
    applyAccountName: ({ cfg, accountId, name }) =>
      applyAccountNameToChannelSection({
        cfg,
        channelKey: "discord",
        accountId,
        name,
        alwaysUseAccounts: true,
      }),
    applyAccountConfig: ({ cfg, accountId, input }) => {
      let next = applyAccountNameToChannelSection({
        cfg,
        channelKey: "discord",
        accountId,
        name: input.name,
        alwaysUseAccounts: true,
      });

      const botToken = input.botToken?.trim() || input.token?.trim() || undefined;
      const defaultChannel = input.audience?.trim() || input.url?.trim() || undefined;
      const guildId = input.ship?.trim() || undefined;
      const dmAllowlist = normalizeEntries(input.dmAllowlist);
      const groupAllowlist = normalizeEntries(input.groupChannels);

      next = applyAccountPatch({
        cfg: next,
        accountId,
        patch: {
          enabled: true,
          ...(botToken ? { botToken } : {}),
          ...(defaultChannel ? { defaultChannel } : {}),
          ...(guildId ? { guildId } : {}),
          ...(dmAllowlist.length > 0 ? { allowFrom: dmAllowlist } : {}),
          ...(groupAllowlist.length > 0 ? { groupAllowFrom: groupAllowlist } : {}),
        },
      });

      return next;
    },
  },
  groups: {
    resolveRequireMention: ({ cfg, accountId }) =>
      resolveDiscordAccount(cfg, accountId).requireMention,
  },
  commands: {
    enforceOwnerForCommands: true,
    skipWhenConfigEmpty: true,
  },
  messaging: {
    normalizeTarget: normalizeDiscordTarget,
    targetResolver: {
      looksLikeId: looksLikeDiscordTargetId,
      hint: "<channel-id>",
    },
  },
  status: {
    buildAccountSnapshot: ({ account }) => ({
      accountId: account.accountId,
      name: account.name,
      enabled: account.enabled,
      configured: resolveDiscordBotToken(account).source !== "none",
      dmPolicy: account.dmPolicy,
      allowFrom: account.allowFrom,
      mode: account.groupPolicy,
      allowUnmentionedGroups: account.requireMention === false,
      botTokenSource: resolveDiscordBotToken(account).source,
    }),
    collectStatusIssues: (accounts) =>
      collectDiscordStatusIssues(accounts as Array<Record<string, unknown>>),
  },
  outbound: {
    deliveryMode: "direct",
    textChunkLimit: 2000,
    resolveTarget: ({ cfg, accountId, to, allowFrom }) => {
      const trimmed = to?.trim();
      if (trimmed) return { ok: true, to: normalizeDiscordTarget(trimmed) ?? trimmed };

      const account = cfg ? resolveDiscordAccount(cfg, accountId) : null;
      const allowlist = normalizeEntries(allowFrom).filter((entry) => entry !== "*");
      const fallback = account?.defaultChannel?.trim() || allowlist[0];
      if (fallback) return { ok: true, to: fallback };

      return {
        ok: false,
        error: missingTargetError("Discord", "<channel-id> or channels.discord.defaultChannel"),
      };
    },
    sendText: async ({ cfg, to, text, accountId }) => {
      const account = resolveDiscordAccount(cfg, accountId);
      const result = await sendDiscordText({
        account,
        to,
        text,
      });
      return {
        channel: "discord",
        messageId: result.messageId,
        channelId: result.channelId,
        timestamp: result.timestamp,
      };
    },
    sendMedia: async ({ cfg, to, text, mediaUrl, accountId }) => {
      const account = resolveDiscordAccount(cfg, accountId);
      const composed = mediaUrl ? `${text ? `${text}\n\n` : ""}${mediaUrl}` : text;
      const result = await sendDiscordText({
        account,
        to,
        text: composed,
      });
      return {
        channel: "discord",
        messageId: result.messageId,
        channelId: result.channelId,
        timestamp: result.timestamp,
      };
    },
  },
};
