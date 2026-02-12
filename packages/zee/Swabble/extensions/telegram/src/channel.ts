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

const TELEGRAM_META = {
  id: "telegram",
  label: "Telegram",
  selectionLabel: "Telegram Bot",
  detailLabel: "Telegram Bot API",
  docsPath: "/channels/telegram",
  docsLabel: "telegram",
  blurb: "bot token + chat/group target ids; DM/group policy controls mirror WhatsApp semantics.",
  order: 20,
  aliases: ["tg"],
  systemImage: "paperplane",
  quickstartAllowFrom: true,
  forceAccountBinding: true,
} as const;

const TELEGRAM_BOT_TOKEN_ENV = "TELEGRAM_BOT_TOKEN";
const TELEGRAM_DEFAULT_BASE_URL = "https://api.telegram.org";

const TelegramAccountSchema = z
  .object({
    name: z.string().trim().min(1).optional(),
    enabled: z.boolean().optional(),
    botToken: z.string().trim().min(1).optional(),
    defaultTarget: z.string().trim().min(1).optional(),
    dmPolicy: DmPolicySchema.optional(),
    allowFrom: z.array(z.string().trim().min(1)).optional(),
    groupPolicy: GroupPolicySchema.optional(),
    groupAllowFrom: z.array(z.string().trim().min(1)).optional(),
    requireMention: z.boolean().optional(),
    baseUrl: z.string().trim().url().optional(),
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

const TelegramConfigSchema = z
  .object({
    accounts: z.record(z.string(), TelegramAccountSchema).optional(),
    name: z.string().trim().min(1).optional(),
    enabled: z.boolean().optional(),
    botToken: z.string().trim().min(1).optional(),
    defaultTarget: z.string().trim().min(1).optional(),
    dmPolicy: DmPolicySchema.optional(),
    allowFrom: z.array(z.string().trim().min(1)).optional(),
    groupPolicy: GroupPolicySchema.optional(),
    groupAllowFrom: z.array(z.string().trim().min(1)).optional(),
    requireMention: z.boolean().optional(),
    baseUrl: z.string().trim().url().optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    requireOpenAllowFrom({
      policy: value.dmPolicy,
      allowFrom: value.allowFrom,
      ctx,
      path: ["allowFrom"],
      message: 'channels.telegram.dmPolicy="open" requires channels.telegram.allowFrom to include "*"',
    });
  });

type TelegramConfig = z.infer<typeof TelegramConfigSchema>;
type TelegramAccountConfig = z.infer<typeof TelegramAccountSchema>;

type ResolvedTelegramAccount = TelegramAccountConfig & {
  accountId: string;
  name?: string;
  enabled: boolean;
  botToken?: string;
  dmPolicy: DmPolicy;
  allowFrom: string[];
  groupPolicy: "allowlist" | "open" | "disabled";
  groupAllowFrom: string[];
  requireMention: boolean;
  defaultTarget?: string;
  baseUrl: string;
};

function normalizeEntries(list?: Array<string | number> | null): string[] {
  return (list ?? []).map((value) => String(value).trim()).filter(Boolean);
}

function readTelegramConfig(cfg: ZeeConfig): TelegramConfig {
  const raw = (cfg.channels as Record<string, unknown> | undefined)?.telegram;
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    return raw as TelegramConfig;
  }
  return {};
}

function listTelegramAccountIds(cfg: ZeeConfig): string[] {
  const section = readTelegramConfig(cfg);
  const accountIds = Object.keys(section.accounts ?? {}).filter(Boolean);
  return accountIds.length > 0 ? accountIds : [DEFAULT_ACCOUNT_ID];
}

function resolveDefaultTelegramAccountId(cfg: ZeeConfig): string {
  const accountIds = listTelegramAccountIds(cfg);
  if (accountIds.includes(DEFAULT_ACCOUNT_ID)) return DEFAULT_ACCOUNT_ID;
  return accountIds[0] ?? DEFAULT_ACCOUNT_ID;
}

function resolveTelegramAccount(cfg: ZeeConfig, accountId?: string | null): ResolvedTelegramAccount {
  const section = readTelegramConfig(cfg);
  const resolvedAccountId = normalizeAccountId(accountId ?? resolveDefaultTelegramAccountId(cfg));
  const account = (section.accounts?.[resolvedAccountId] ?? {}) as TelegramAccountConfig;
  const useTopLevel = resolvedAccountId === DEFAULT_ACCOUNT_ID;

  const allowFrom = normalizeEntries(account.allowFrom ?? (useTopLevel ? section.allowFrom : []));
  const groupAllowFrom = normalizeEntries(
    account.groupAllowFrom ?? (useTopLevel ? section.groupAllowFrom : []),
  );

  return {
    accountId: resolvedAccountId,
    name: account.name ?? (useTopLevel ? section.name : undefined),
    enabled: account.enabled ?? (useTopLevel ? section.enabled !== false : true),
    botToken: account.botToken ?? (useTopLevel ? section.botToken : undefined),
    defaultTarget: account.defaultTarget ?? (useTopLevel ? section.defaultTarget : undefined),
    dmPolicy: account.dmPolicy ?? (useTopLevel ? section.dmPolicy : undefined) ?? "pairing",
    allowFrom,
    groupPolicy: account.groupPolicy ?? (useTopLevel ? section.groupPolicy : undefined) ?? "allowlist",
    groupAllowFrom,
    requireMention:
      account.requireMention ?? (useTopLevel ? section.requireMention : undefined) ?? true,
    baseUrl: account.baseUrl ?? (useTopLevel ? section.baseUrl : undefined) ?? TELEGRAM_DEFAULT_BASE_URL,
  };
}

function hasAccountOverride(cfg: ZeeConfig, accountId: string): boolean {
  return Boolean(readTelegramConfig(cfg).accounts?.[accountId]);
}

function resolveConfigPathPrefix(cfg: ZeeConfig, accountId: string): string {
  if (hasAccountOverride(cfg, accountId)) {
    return `channels.telegram.accounts.${accountId}.`;
  }
  return "channels.telegram.";
}

function resolveTelegramToken(account: ResolvedTelegramAccount): {
  token: string | null;
  source: "config" | "env" | "none";
} {
  const configToken = account.botToken?.trim();
  if (configToken) return { token: configToken, source: "config" };
  const envToken = process.env[TELEGRAM_BOT_TOKEN_ENV]?.trim();
  if (envToken) return { token: envToken, source: "env" };
  return { token: null, source: "none" };
}

function applyAccountPatch(params: {
  cfg: ZeeConfig;
  accountId: string;
  patch: Partial<TelegramAccountConfig>;
  unsetKeys?: Array<keyof TelegramAccountConfig>;
}): ZeeConfig {
  const accountId = normalizeAccountId(params.accountId);
  const section = readTelegramConfig(params.cfg);
  const accounts = { ...(section.accounts ?? {}) };
  const existing = { ...(accounts[accountId] ?? {}) } as TelegramAccountConfig;
  const next = {
    ...existing,
    ...params.patch,
  } as TelegramAccountConfig;

  for (const key of params.unsetKeys ?? []) {
    delete (next as Record<string, unknown>)[key as string];
  }

  accounts[accountId] = next;

  return {
    ...params.cfg,
    channels: {
      ...params.cfg.channels,
      telegram: {
        ...section,
        accounts,
      },
    },
  } as ZeeConfig;
}

function setTelegramDmPolicy(cfg: ZeeConfig, accountId: string, dmPolicy: DmPolicy): ZeeConfig {
  let next = applyAccountPatch({
    cfg,
    accountId,
    patch: {
      dmPolicy,
    },
  });
  if (dmPolicy === "open") {
    const resolved = resolveTelegramAccount(next, accountId);
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

function setTelegramAllowFrom(
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

async function parseTelegramResponse(res: Response): Promise<Record<string, unknown>> {
  const raw = await res.text();
  let parsed: unknown;
  try {
    parsed = raw ? (JSON.parse(raw) as unknown) : {};
  } catch {
    throw new Error(`Telegram API returned invalid JSON (${res.status}).`);
  }
  if (!parsed || typeof parsed !== "object") {
    throw new Error(`Telegram API returned an invalid payload (${res.status}).`);
  }
  return parsed as Record<string, unknown>;
}

function toTelegramChatId(value: string): string | number {
  return /^-?\d+$/.test(value) ? Number.parseInt(value, 10) : value;
}

async function sendTelegramText(params: {
  account: ResolvedTelegramAccount;
  to: string;
  text: string;
  threadId?: string | number | null;
}): Promise<{
  messageId: string;
  chatId: string;
  timestamp: number;
  meta?: Record<string, unknown>;
}> {
  const token = resolveTelegramToken(params.account).token;
  if (!token) {
    throw new Error(
      `Telegram token is missing. Set channels.telegram.botToken or ${TELEGRAM_BOT_TOKEN_ENV}.`,
    );
  }

  const endpointBase = params.account.baseUrl.replace(/\/$/, "");
  const endpoint = `${endpointBase}/bot${token}/sendMessage`;
  const payload: Record<string, unknown> = {
    chat_id: toTelegramChatId(params.to),
    text: params.text,
  };
  if (params.threadId !== undefined && params.threadId !== null) {
    payload.message_thread_id =
      typeof params.threadId === "number"
        ? params.threadId
        : /^\d+$/.test(String(params.threadId))
          ? Number.parseInt(String(params.threadId), 10)
          : String(params.threadId);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  if (typeof timeout.unref === "function") timeout.unref();

  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Telegram send failed: ${message}`);
  } finally {
    clearTimeout(timeout);
  }

  const parsed = await parseTelegramResponse(response);
  const ok = parsed.ok === true;
  if (!response.ok || !ok) {
    const description =
      typeof parsed.description === "string" && parsed.description.trim()
        ? parsed.description.trim()
        : `HTTP ${response.status}`;
    throw new Error(`Telegram send failed: ${description}`);
  }

  const result =
    parsed.result && typeof parsed.result === "object"
      ? (parsed.result as Record<string, unknown>)
      : {};
  const resultChat =
    result.chat && typeof result.chat === "object"
      ? (result.chat as Record<string, unknown>)
      : {};

  const messageId =
    typeof result.message_id === "number"
      ? String(result.message_id)
      : typeof result.message_id === "string"
        ? result.message_id
        : `${Date.now()}`;
  const chatId =
    typeof resultChat.id === "number"
      ? String(resultChat.id)
      : typeof resultChat.id === "string"
        ? resultChat.id
        : params.to;
  const timestamp =
    typeof result.date === "number" && Number.isFinite(result.date)
      ? result.date * 1000
      : Date.now();

  return {
    messageId,
    chatId,
    timestamp,
    meta:
      typeof resultChat.type === "string"
        ? {
            chatType: resultChat.type,
          }
        : undefined,
  };
}

function collectTelegramStatusIssues(accounts: Array<Record<string, unknown>>): ChannelStatusIssue[] {
  const issues: ChannelStatusIssue[] = [];
  for (const account of accounts) {
    const accountId =
      typeof account.accountId === "string" && account.accountId.trim()
        ? account.accountId
        : DEFAULT_ACCOUNT_ID;
    const enabled = account.enabled !== false;
    if (!enabled) continue;

    const configured = account.configured === true;
    if (!configured) {
      issues.push({
        channel: "telegram",
        accountId,
        kind: "config",
        message: "Telegram bot token is missing.",
        fix: `Set channels.telegram.accounts.${accountId}.botToken or ${TELEGRAM_BOT_TOKEN_ENV}.`,
      });
      continue;
    }

    const dmPolicy = typeof account.dmPolicy === "string" ? account.dmPolicy : "pairing";
    const allowFrom = Array.isArray(account.allowFrom)
      ? account.allowFrom.map((entry) => String(entry))
      : [];
    if (dmPolicy === "open" && !allowFrom.includes("*")) {
      issues.push({
        channel: "telegram",
        accountId,
        kind: "config",
        message: 'dmPolicy="open" requires allowFrom to include "*".',
      });
    }

    const groupPolicy = typeof account.mode === "string" ? account.mode : "allowlist";
    const requireMention = account.allowUnmentionedGroups !== true;
    if (groupPolicy === "open" && !requireMention) {
      issues.push({
        channel: "telegram",
        accountId,
        kind: "permissions",
        message: "Group policy is open and mentions are not required.",
        fix: "Set channels.telegram.requireMention=true or channels.telegram.groupPolicy=allowlist.",
      });
    }
  }
  return issues;
}

const telegramOnboardingAdapter: ChannelOnboardingAdapter = {
  channel: "telegram",
  getStatus: async ({ cfg, accountOverrides }) => {
    const overrideId = accountOverrides.telegram?.trim();
    const accountId = overrideId
      ? normalizeAccountId(overrideId)
      : resolveDefaultTelegramAccountId(cfg);
    const account = resolveTelegramAccount(cfg, accountId);
    const tokenSource = resolveTelegramToken(account).source;
    const configured = tokenSource !== "none";
    return {
      channel: "telegram",
      configured,
      statusLines: [
        `Telegram (${accountId === DEFAULT_ACCOUNT_ID ? "default" : accountId}): ${
          configured ? `configured (${tokenSource})` : "token missing"
        }`,
      ],
      selectionHint: configured ? "configured" : "token missing",
      quickstartScore: configured ? 4 : 2,
    };
  },
  configure: async ({ cfg, prompter, accountOverrides, shouldPromptAccountIds }) => {
    const overrideId = accountOverrides.telegram?.trim();
    let accountId = overrideId
      ? normalizeAccountId(overrideId)
      : resolveDefaultTelegramAccountId(cfg);

    if (shouldPromptAccountIds && !overrideId) {
      accountId = await promptAccountId({
        cfg,
        prompter,
        label: "Telegram",
        currentId: accountId,
        listAccountIds: listTelegramAccountIds,
        defaultAccountId: resolveDefaultTelegramAccountId(cfg),
      });
    }

    const current = resolveTelegramAccount(cfg, accountId);
    const tokenHint = resolveTelegramToken(current).source;
    const token = await prompter.text({
      message: `Telegram bot token (${accountId})`,
      initialValue: current.botToken,
      placeholder: "123456789:AA...",
      validate: (value) => {
        const trimmed = String(value ?? "").trim();
        if (trimmed) return undefined;
        if (tokenHint !== "none") return undefined;
        return `Required unless ${TELEGRAM_BOT_TOKEN_ENV} is set.`;
      },
    });

    const defaultTarget = await prompter.text({
      message: "Default Telegram target (optional chat id or @username)",
      initialValue: current.defaultTarget,
      placeholder: "-1001234567890",
    });

    const requireMention = await prompter.confirm({
      message: "Require mentions for Telegram group messages?",
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

    const normalizedToken = String(token ?? "").trim();
    if (normalizedToken) {
      next = applyAccountPatch({
        cfg: next,
        accountId,
        patch: {
          botToken: normalizedToken,
        },
      });
    }

    const normalizedTarget = String(defaultTarget ?? "").trim();
    if (normalizedTarget) {
      next = applyAccountPatch({
        cfg: next,
        accountId,
        patch: {
          defaultTarget: normalizedTarget,
        },
      });
    }

    await prompter.note(
      [
        "Telegram setup complete.",
        "Use `zee channels status` to verify token + routing.",
        `Docs: ${formatDocsLink("/channels/telegram", "channels/telegram")}`,
      ].join("\n"),
      "Telegram",
    );

    return { cfg: next, accountId };
  },
  dmPolicy: {
    label: "Telegram",
    channel: "telegram",
    policyKey: "channels.telegram.dmPolicy",
    allowFromKey: "channels.telegram.allowFrom",
    getCurrent: (cfg) => {
      const account = resolveTelegramAccount(cfg, resolveDefaultTelegramAccountId(cfg));
      return account.dmPolicy;
    },
    setPolicy: (cfg, policy) =>
      setTelegramDmPolicy(cfg, resolveDefaultTelegramAccountId(cfg), policy),
    promptAllowFrom: async ({ cfg, prompter, accountId }) => {
      const resolvedAccountId = accountId
        ? normalizeAccountId(accountId)
        : resolveDefaultTelegramAccountId(cfg);
      const account = resolveTelegramAccount(cfg, resolvedAccountId);
      const raw = await prompter.text({
        message: "Telegram DM allowFrom (comma-separated user/chat ids)",
        initialValue: account.allowFrom.join(", "),
        placeholder: "12345678, 99887766",
      });
      const entries = normalizeEntries(String(raw ?? "").split(/[\n,;]+/g));
      return setTelegramAllowFrom(cfg, resolvedAccountId, entries);
    },
  },
};

function normalizeTelegramTarget(raw: string): string | undefined {
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  return trimmed.replace(/^telegram:/i, "");
}

function looksLikeTelegramTargetId(raw: string, normalized?: string): boolean {
  const value = (normalized ?? raw).trim();
  return /^@?[a-zA-Z0-9_]{5,}$/.test(value) || /^-?\d{5,}$/.test(value);
}

export const telegramPlugin: ChannelPlugin<ResolvedTelegramAccount> = {
  id: "telegram",
  meta: TELEGRAM_META,
  onboarding: telegramOnboardingAdapter,
  pairing: {
    idLabel: "telegramSenderId",
  },
  capabilities: {
    chatTypes: ["direct", "group"],
    media: true,
  },
  configSchema: buildChannelConfigSchema(TelegramConfigSchema),
  config: {
    listAccountIds: (cfg) => listTelegramAccountIds(cfg),
    resolveAccount: (cfg, accountId) => resolveTelegramAccount(cfg, accountId),
    defaultAccountId: (cfg) => resolveDefaultTelegramAccountId(cfg),
    setAccountEnabled: ({ cfg, accountId, enabled }) =>
      setAccountEnabledInConfigSection({
        cfg,
        sectionKey: "telegram",
        accountId,
        enabled,
        allowTopLevel: true,
      }),
    deleteAccount: ({ cfg, accountId }) =>
      deleteAccountFromConfigSection({
        cfg,
        sectionKey: "telegram",
        accountId,
        clearBaseFields: [
          "name",
          "enabled",
          "botToken",
          "defaultTarget",
          "dmPolicy",
          "allowFrom",
          "groupPolicy",
          "groupAllowFrom",
          "requireMention",
          "baseUrl",
        ],
      }),
    isEnabled: (account) => account.enabled !== false,
    disabledReason: () => "disabled",
    isConfigured: async (account) => resolveTelegramToken(account).source !== "none",
    unconfiguredReason: () => "token missing",
    describeAccount: (account) => ({
      accountId: account.accountId,
      name: account.name,
      enabled: account.enabled,
      configured: resolveTelegramToken(account).source !== "none",
      dmPolicy: account.dmPolicy,
      allowFrom: account.allowFrom,
      tokenSource: resolveTelegramToken(account).source,
      mode: account.groupPolicy,
      allowUnmentionedGroups: account.requireMention === false,
      baseUrl: account.baseUrl,
    }),
    resolveAllowFrom: ({ cfg, accountId }) => resolveTelegramAccount(cfg, accountId).allowFrom,
    formatAllowFrom: ({ allowFrom }) => normalizeEntries(allowFrom),
  },
  security: {
    resolveDmPolicy: ({ cfg, accountId, account }) => {
      const resolvedAccountId = accountId ?? account.accountId ?? DEFAULT_ACCOUNT_ID;
      return {
        policy: account.dmPolicy,
        allowFrom: account.allowFrom,
        policyPath: `${resolveConfigPathPrefix(cfg, resolvedAccountId)}dmPolicy`,
        allowFromPath: resolveConfigPathPrefix(cfg, resolvedAccountId),
        approveHint: formatPairingApproveHint("telegram"),
        normalizeEntry: (raw) => raw.trim(),
      };
    },
    collectWarnings: ({ account }) => {
      const warnings: string[] = [];
      if (account.groupPolicy === "open") {
        if (account.requireMention) {
          warnings.push(
            '- Telegram groups: groupPolicy="open" allows any member in allowed groups to trigger when Zee is mentioned. Prefer groupPolicy="allowlist" for tighter control.',
          );
        } else {
          warnings.push(
            '- Telegram groups: groupPolicy="open" with requireMention=false allows any member to trigger actions. Set requireMention=true or groupPolicy="allowlist".',
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
        channelKey: "telegram",
        accountId,
        name,
        alwaysUseAccounts: true,
      }),
    applyAccountConfig: ({ cfg, accountId, input }) => {
      let next = applyAccountNameToChannelSection({
        cfg,
        channelKey: "telegram",
        accountId,
        name: input.name,
        alwaysUseAccounts: true,
      });

      const token = input.botToken?.trim() || input.token?.trim() || undefined;
      const defaultTarget = input.audience?.trim() || input.url?.trim() || undefined;
      const dmAllowlist = normalizeEntries(input.dmAllowlist);
      const groupAllowlist = normalizeEntries(input.groupChannels);

      next = applyAccountPatch({
        cfg: next,
        accountId,
        patch: {
          enabled: true,
          ...(token ? { botToken: token } : {}),
          ...(defaultTarget ? { defaultTarget } : {}),
          ...(dmAllowlist.length > 0 ? { allowFrom: dmAllowlist } : {}),
          ...(groupAllowlist.length > 0 ? { groupAllowFrom: groupAllowlist } : {}),
        },
      });
      return next;
    },
  },
  groups: {
    resolveRequireMention: ({ cfg, accountId }) =>
      resolveTelegramAccount(cfg, accountId).requireMention,
  },
  commands: {
    enforceOwnerForCommands: true,
    skipWhenConfigEmpty: true,
  },
  messaging: {
    normalizeTarget: normalizeTelegramTarget,
    targetResolver: {
      looksLikeId: looksLikeTelegramTargetId,
      hint: "<chat_id|@username>",
    },
  },
  status: {
    buildAccountSnapshot: ({ account }) => ({
      accountId: account.accountId,
      name: account.name,
      enabled: account.enabled,
      configured: resolveTelegramToken(account).source !== "none",
      dmPolicy: account.dmPolicy,
      allowFrom: account.allowFrom,
      tokenSource: resolveTelegramToken(account).source,
      mode: account.groupPolicy,
      allowUnmentionedGroups: account.requireMention === false,
      baseUrl: account.baseUrl,
    }),
    collectStatusIssues: (accounts) => collectTelegramStatusIssues(accounts as Array<Record<string, unknown>>),
  },
  outbound: {
    deliveryMode: "direct",
    textChunkLimit: 4096,
    resolveTarget: ({ cfg, accountId, to, allowFrom }) => {
      const trimmed = to?.trim();
      if (trimmed) {
        return { ok: true, to: normalizeTelegramTarget(trimmed) ?? trimmed };
      }

      const account = cfg ? resolveTelegramAccount(cfg, accountId) : null;
      const allowlist = normalizeEntries(allowFrom).filter((entry) => entry !== "*");
      const fallback = account?.defaultTarget?.trim() || allowlist[0];
      if (fallback) {
        return { ok: true, to: fallback };
      }

      return {
        ok: false,
        error: missingTargetError(
          "Telegram",
          "<chat_id|@username> or channels.telegram.defaultTarget",
        ),
      };
    },
    sendText: async ({ cfg, to, text, threadId, accountId }) => {
      const account = resolveTelegramAccount(cfg, accountId);
      const result = await sendTelegramText({
        account,
        to,
        text,
        threadId,
      });
      return {
        channel: "telegram",
        messageId: result.messageId,
        chatId: result.chatId,
        timestamp: result.timestamp,
        meta: result.meta,
      };
    },
    sendMedia: async ({ cfg, to, text, mediaUrl, threadId, accountId }) => {
      const composed = mediaUrl ? `${text ? `${text}\n\n` : ""}${mediaUrl}` : text;
      const account = resolveTelegramAccount(cfg, accountId);
      const result = await sendTelegramText({
        account,
        to,
        text: composed,
        threadId,
      });
      return {
        channel: "telegram",
        messageId: result.messageId,
        chatId: result.chatId,
        timestamp: result.timestamp,
        meta: result.meta,
      };
    },
  },
};
