import { z } from "zod";

import {
  DEFAULT_ACCOUNT_ID,
  DmPolicySchema,
  GroupPolicySchema,
  addWildcardAllowFrom,
  applyAccountNameToChannelSection,
  buildChannelConfigSchema,
  createActionGate,
  deleteAccountFromConfigSection,
  formatDocsLink,
  formatPairingApproveHint,
  jsonResult,
  missingTargetError,
  normalizeAccountId,
  promptAccountId,
  readStringParam,
  requireOpenAllowFrom,
  setAccountEnabledInConfigSection,
  type ChannelAccountSnapshot,
  type ChannelOnboardingAdapter,
  type ChannelPlugin,
  type ChannelStatusIssue,
  type DmPolicy,
  type ZeeConfig,
} from "zee/plugin-sdk";

const SLACK_META = {
  id: "slack",
  label: "Slack",
  selectionLabel: "Slack Bot",
  detailLabel: "Slack Web API",
  docsPath: "/channels/slack",
  docsLabel: "slack",
  blurb: "bot token + default channel id; per-channel DM/group policy and mention gating.",
  order: 30,
  aliases: ["sl"],
  systemImage: "number",
  quickstartAllowFrom: true,
  forceAccountBinding: true,
} as const;

const SLACK_BOT_TOKEN_ENV = "SLACK_BOT_TOKEN";
const SLACK_APP_TOKEN_ENV = "SLACK_APP_TOKEN";
const SLACK_API_BASE = "https://slack.com/api";

const SlackActionsSchema = z
  .object({
    reactions: z.boolean().optional(),
    pins: z.boolean().optional(),
    channelInfo: z.boolean().optional(),
  })
  .strict()
  .optional();

const SlackAccountSchema = z
  .object({
    name: z.string().trim().min(1).optional(),
    enabled: z.boolean().optional(),
    botToken: z.string().trim().min(1).optional(),
    appToken: z.string().trim().min(1).optional(),
    defaultChannel: z.string().trim().min(1).optional(),
    dmPolicy: DmPolicySchema.optional(),
    allowFrom: z.array(z.string().trim().min(1)).optional(),
    groupPolicy: GroupPolicySchema.optional(),
    groupAllowFrom: z.array(z.string().trim().min(1)).optional(),
    requireMention: z.boolean().optional(),
    actions: SlackActionsSchema,
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

const SlackConfigSchema = z
  .object({
    accounts: z.record(z.string(), SlackAccountSchema).optional(),
    name: z.string().trim().min(1).optional(),
    enabled: z.boolean().optional(),
    botToken: z.string().trim().min(1).optional(),
    appToken: z.string().trim().min(1).optional(),
    defaultChannel: z.string().trim().min(1).optional(),
    dmPolicy: DmPolicySchema.optional(),
    allowFrom: z.array(z.string().trim().min(1)).optional(),
    groupPolicy: GroupPolicySchema.optional(),
    groupAllowFrom: z.array(z.string().trim().min(1)).optional(),
    requireMention: z.boolean().optional(),
    actions: SlackActionsSchema,
  })
  .strict()
  .superRefine((value, ctx) => {
    requireOpenAllowFrom({
      policy: value.dmPolicy,
      allowFrom: value.allowFrom,
      ctx,
      path: ["allowFrom"],
      message: 'channels.slack.dmPolicy="open" requires channels.slack.allowFrom to include "*"',
    });
  });

type SlackConfig = z.infer<typeof SlackConfigSchema>;
type SlackAccountConfig = z.infer<typeof SlackAccountSchema>;
type SlackActionConfig = NonNullable<z.infer<typeof SlackActionsSchema>>;

type ResolvedSlackAccount = SlackAccountConfig & {
  accountId: string;
  name?: string;
  enabled: boolean;
  botToken?: string;
  appToken?: string;
  defaultChannel?: string;
  dmPolicy: DmPolicy;
  allowFrom: string[];
  groupPolicy: "allowlist" | "open" | "disabled";
  groupAllowFrom: string[];
  requireMention: boolean;
  actions: SlackActionConfig;
};

function normalizeEntries(list?: Array<string | number> | null): string[] {
  return (list ?? []).map((entry) => String(entry).trim()).filter(Boolean);
}

function readSlackConfig(cfg: ZeeConfig): SlackConfig {
  const raw = (cfg.channels as Record<string, unknown> | undefined)?.slack;
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    return raw as SlackConfig;
  }
  return {};
}

function listSlackAccountIds(cfg: ZeeConfig): string[] {
  const section = readSlackConfig(cfg);
  const ids = Object.keys(section.accounts ?? {}).filter(Boolean);
  return ids.length > 0 ? ids : [DEFAULT_ACCOUNT_ID];
}

function resolveDefaultSlackAccountId(cfg: ZeeConfig): string {
  const ids = listSlackAccountIds(cfg);
  if (ids.includes(DEFAULT_ACCOUNT_ID)) return DEFAULT_ACCOUNT_ID;
  return ids[0] ?? DEFAULT_ACCOUNT_ID;
}

function resolveSlackAccount(cfg: ZeeConfig, accountId?: string | null): ResolvedSlackAccount {
  const section = readSlackConfig(cfg);
  const resolvedAccountId = normalizeAccountId(accountId ?? resolveDefaultSlackAccountId(cfg));
  const account = (section.accounts?.[resolvedAccountId] ?? {}) as SlackAccountConfig;
  const useTopLevel = resolvedAccountId === DEFAULT_ACCOUNT_ID;

  return {
    accountId: resolvedAccountId,
    name: account.name ?? (useTopLevel ? section.name : undefined),
    enabled: account.enabled ?? (useTopLevel ? section.enabled !== false : true),
    botToken: account.botToken ?? (useTopLevel ? section.botToken : undefined),
    appToken: account.appToken ?? (useTopLevel ? section.appToken : undefined),
    defaultChannel: account.defaultChannel ?? (useTopLevel ? section.defaultChannel : undefined),
    dmPolicy: account.dmPolicy ?? (useTopLevel ? section.dmPolicy : undefined) ?? "pairing",
    allowFrom: normalizeEntries(account.allowFrom ?? (useTopLevel ? section.allowFrom : [])),
    groupPolicy: account.groupPolicy ?? (useTopLevel ? section.groupPolicy : undefined) ?? "allowlist",
    groupAllowFrom: normalizeEntries(
      account.groupAllowFrom ?? (useTopLevel ? section.groupAllowFrom : []),
    ),
    requireMention:
      account.requireMention ?? (useTopLevel ? section.requireMention : undefined) ?? true,
    actions: {
      ...(useTopLevel ? (section.actions ?? {}) : {}),
      ...(account.actions ?? {}),
    },
  };
}

function hasAccountOverride(cfg: ZeeConfig, accountId: string): boolean {
  return Boolean(readSlackConfig(cfg).accounts?.[accountId]);
}

function resolveConfigPathPrefix(cfg: ZeeConfig, accountId: string): string {
  if (hasAccountOverride(cfg, accountId)) {
    return `channels.slack.accounts.${accountId}.`;
  }
  return "channels.slack.";
}

function resolveSlackTokens(account: ResolvedSlackAccount): {
  botToken: string | null;
  botSource: "config" | "env" | "none";
  appToken: string | null;
  appSource: "config" | "env" | "none";
} {
  const configBot = account.botToken?.trim();
  const configApp = account.appToken?.trim();
  const envBot = process.env[SLACK_BOT_TOKEN_ENV]?.trim();
  const envApp = process.env[SLACK_APP_TOKEN_ENV]?.trim();
  return {
    botToken: configBot ?? envBot ?? null,
    botSource: configBot ? "config" : envBot ? "env" : "none",
    appToken: configApp ?? envApp ?? null,
    appSource: configApp ? "config" : envApp ? "env" : "none",
  };
}

function applyAccountPatch(params: {
  cfg: ZeeConfig;
  accountId: string;
  patch: Partial<SlackAccountConfig>;
  unsetKeys?: Array<keyof SlackAccountConfig>;
}): ZeeConfig {
  const accountId = normalizeAccountId(params.accountId);
  const section = readSlackConfig(params.cfg);
  const accounts = { ...(section.accounts ?? {}) };
  const existing = { ...(accounts[accountId] ?? {}) } as SlackAccountConfig;
  const next = {
    ...existing,
    ...params.patch,
  } as SlackAccountConfig;
  for (const key of params.unsetKeys ?? []) {
    delete (next as Record<string, unknown>)[key as string];
  }
  accounts[accountId] = next;
  return {
    ...params.cfg,
    channels: {
      ...params.cfg.channels,
      slack: {
        ...section,
        accounts,
      },
    },
  } as ZeeConfig;
}

function setSlackDmPolicy(cfg: ZeeConfig, accountId: string, dmPolicy: DmPolicy): ZeeConfig {
  let next = applyAccountPatch({ cfg, accountId, patch: { dmPolicy } });
  if (dmPolicy === "open") {
    const resolved = resolveSlackAccount(next, accountId);
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

function setSlackAllowFrom(cfg: ZeeConfig, accountId: string, allowFrom?: string[] | null): ZeeConfig {
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

function collectSlackStatusIssues(accounts: ChannelAccountSnapshot[]): ChannelStatusIssue[] {
  const issues: ChannelStatusIssue[] = [];
  for (const account of accounts) {
    const accountId =
      typeof account.accountId === "string" && account.accountId.trim()
        ? account.accountId
        : DEFAULT_ACCOUNT_ID;
    if (account.enabled === false) continue;

    if (account.configured !== true) {
      issues.push({
        channel: "slack",
        accountId,
        kind: "config",
        message: "Slack bot token is missing.",
        fix: `Set channels.slack.accounts.${accountId}.botToken or ${SLACK_BOT_TOKEN_ENV}.`,
      });
      continue;
    }

    const dmPolicy = typeof account.dmPolicy === "string" ? account.dmPolicy : "pairing";
    const allowFrom = Array.isArray(account.allowFrom)
      ? account.allowFrom.map((value) => String(value))
      : [];
    if (dmPolicy === "open" && !allowFrom.includes("*")) {
      issues.push({
        channel: "slack",
        accountId,
        kind: "config",
        message: 'dmPolicy="open" requires allowFrom to include "*".',
      });
    }

    const groupPolicy = typeof account.mode === "string" ? account.mode : "allowlist";
    const requireMention = account.allowUnmentionedGroups !== true;
    if (groupPolicy === "open" && !requireMention) {
      issues.push({
        channel: "slack",
        accountId,
        kind: "permissions",
        message: "Group policy is open and mentions are not required.",
        fix: "Set channels.slack.requireMention=true or channels.slack.groupPolicy=allowlist.",
      });
    }

    const accountActions = (account as { actions?: unknown }).actions;
    const actions =
      accountActions && typeof accountActions === "object"
        ? (accountActions as Record<string, unknown>)
        : {};
    const hasActionSurface =
      actions.reactions !== false || actions.pins !== false || actions.channelInfo !== false;
    if (dmPolicy === "open" && allowFrom.includes("*") && hasActionSurface) {
      issues.push({
        channel: "slack",
        accountId,
        kind: "permissions",
        message: "Action surface is enabled while DMs are open to everyone.",
        fix: "Use dmPolicy=pairing/allowlist or disable channels.slack.actions.* controls.",
      });
    }
  }
  return issues;
}

async function callSlackApi(params: {
  account: ResolvedSlackAccount;
  method: string;
  body: Record<string, unknown>;
}): Promise<Record<string, unknown>> {
  const tokens = resolveSlackTokens(params.account);
  if (!tokens.botToken) {
    throw new Error(
      `Slack bot token is missing. Set channels.slack.botToken or ${SLACK_BOT_TOKEN_ENV}.`,
    );
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  if (typeof timeout.unref === "function") timeout.unref();

  let response: Response;
  try {
    response = await fetch(`${SLACK_API_BASE}/${params.method}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${tokens.botToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(params.body),
      signal: controller.signal,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Slack API request failed (${params.method}): ${message}`);
  } finally {
    clearTimeout(timeout);
  }

  const raw = await response.text();
  let payload: Record<string, unknown> = {};
  try {
    payload = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
  } catch {
    throw new Error(`Slack API returned invalid JSON (${response.status}).`);
  }

  const ok = payload.ok === true;
  if (!response.ok || !ok) {
    const error =
      typeof payload.error === "string" && payload.error.trim()
        ? payload.error.trim()
        : `HTTP ${response.status}`;
    throw new Error(`Slack API ${params.method} failed: ${error}`);
  }

  return payload;
}

async function sendSlackText(params: {
  account: ResolvedSlackAccount;
  to: string;
  text: string;
  threadId?: string | number | null;
}): Promise<{
  messageId: string;
  channelId: string;
  meta?: Record<string, unknown>;
}> {
  const body: Record<string, unknown> = {
    channel: params.to,
    text: params.text,
  };
  if (params.threadId !== undefined && params.threadId !== null) {
    body.thread_ts = String(params.threadId);
  }
  const payload = await callSlackApi({
    account: params.account,
    method: "chat.postMessage",
    body,
  });

  const channelId = typeof payload.channel === "string" ? payload.channel : params.to;
  const messageId = typeof payload.ts === "string" ? payload.ts : `${Date.now()}`;

  return {
    messageId,
    channelId,
    meta: {
      threadTs: typeof payload.ts === "string" ? payload.ts : undefined,
    },
  };
}

function normalizeSlackEmoji(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return trimmed;
  if (trimmed.startsWith(":") && trimmed.endsWith(":") && trimmed.length > 2) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

const slackOnboardingAdapter: ChannelOnboardingAdapter = {
  channel: "slack",
  getStatus: async ({ cfg, accountOverrides }) => {
    const overrideId = accountOverrides.slack?.trim();
    const accountId = overrideId ? normalizeAccountId(overrideId) : resolveDefaultSlackAccountId(cfg);
    const account = resolveSlackAccount(cfg, accountId);
    const tokens = resolveSlackTokens(account);
    const configured = tokens.botSource !== "none";
    return {
      channel: "slack",
      configured,
      statusLines: [
        `Slack (${accountId === DEFAULT_ACCOUNT_ID ? "default" : accountId}): ${
          configured ? `configured (${tokens.botSource})` : "token missing"
        }`,
      ],
      selectionHint: configured ? "configured" : "token missing",
      quickstartScore: configured ? 3 : 1,
    };
  },
  configure: async ({ cfg, prompter, accountOverrides, shouldPromptAccountIds }) => {
    const overrideId = accountOverrides.slack?.trim();
    let accountId = overrideId ? normalizeAccountId(overrideId) : resolveDefaultSlackAccountId(cfg);

    if (shouldPromptAccountIds && !overrideId) {
      accountId = await promptAccountId({
        cfg,
        prompter,
        label: "Slack",
        currentId: accountId,
        listAccountIds: listSlackAccountIds,
        defaultAccountId: resolveDefaultSlackAccountId(cfg),
      });
    }

    const current = resolveSlackAccount(cfg, accountId);
    const tokenInfo = resolveSlackTokens(current);

    const botToken = await prompter.text({
      message: `Slack bot token (${accountId})`,
      initialValue: current.botToken,
      placeholder: "xoxb-...",
      validate: (value) => {
        const trimmed = String(value ?? "").trim();
        if (trimmed) return undefined;
        if (tokenInfo.botSource !== "none") return undefined;
        return `Required unless ${SLACK_BOT_TOKEN_ENV} is set.`;
      },
    });

    const defaultChannel = await prompter.text({
      message: "Default Slack channel id (optional)",
      initialValue: current.defaultChannel,
      placeholder: "C0123456789",
    });

    const requireMention = await prompter.confirm({
      message: "Require mentions for Slack channel messages?",
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
        "Slack setup complete.",
        "Use `zee channels status` to verify token + routing.",
        `Docs: ${formatDocsLink("/channels/slack", "channels/slack")}`,
      ].join("\n"),
      "Slack",
    );

    return { cfg: next, accountId };
  },
  dmPolicy: {
    label: "Slack",
    channel: "slack",
    policyKey: "channels.slack.dmPolicy",
    allowFromKey: "channels.slack.allowFrom",
    getCurrent: (cfg) => resolveSlackAccount(cfg, resolveDefaultSlackAccountId(cfg)).dmPolicy,
    setPolicy: (cfg, policy) => setSlackDmPolicy(cfg, resolveDefaultSlackAccountId(cfg), policy),
    promptAllowFrom: async ({ cfg, prompter, accountId }) => {
      const resolvedAccountId = accountId
        ? normalizeAccountId(accountId)
        : resolveDefaultSlackAccountId(cfg);
      const account = resolveSlackAccount(cfg, resolvedAccountId);
      const raw = await prompter.text({
        message: "Slack DM allowFrom (comma-separated user ids)",
        initialValue: account.allowFrom.join(", "),
        placeholder: "U01234, U05678",
      });
      const entries = normalizeEntries(String(raw ?? "").split(/[\n,;]+/g));
      return setSlackAllowFrom(cfg, resolvedAccountId, entries);
    },
  },
};

function normalizeSlackTarget(raw: string): string | undefined {
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  return trimmed.replace(/^slack:/i, "");
}

function looksLikeSlackTargetId(raw: string, normalized?: string): boolean {
  const value = (normalized ?? raw).trim();
  return /^[CDGU][A-Z0-9]{8,}$/i.test(value) || /^#[a-z0-9._-]+$/i.test(value);
}

function resolveSlackActionTarget(params: Record<string, unknown>): string {
  const primary = readStringParam(params, "channel");
  const fallback = readStringParam(params, "channelId") ?? readStringParam(params, "to");
  const target = primary ?? fallback;
  if (!target) {
    throw new Error("channel required");
  }
  return target;
}

function isSlackActionEnabled(params: {
  account: ResolvedSlackAccount;
  action: "react" | "pin" | "unpin" | "channel-info";
}): boolean {
  const gate = createActionGate(params.account.actions);
  switch (params.action) {
    case "react":
      return gate("reactions");
    case "pin":
    case "unpin":
      return gate("pins");
    case "channel-info":
      return gate("channelInfo");
    default:
      return false;
  }
}

export const slackPlugin: ChannelPlugin<ResolvedSlackAccount> = {
  id: "slack",
  meta: SLACK_META,
  onboarding: slackOnboardingAdapter,
  pairing: {
    idLabel: "slackSenderId",
  },
  capabilities: {
    chatTypes: ["direct", "group", "thread"],
    media: true,
    reactions: true,
    threads: true,
  },
  configSchema: buildChannelConfigSchema(SlackConfigSchema),
  config: {
    listAccountIds: (cfg) => listSlackAccountIds(cfg),
    resolveAccount: (cfg, accountId) => resolveSlackAccount(cfg, accountId),
    defaultAccountId: (cfg) => resolveDefaultSlackAccountId(cfg),
    setAccountEnabled: ({ cfg, accountId, enabled }) =>
      setAccountEnabledInConfigSection({
        cfg,
        sectionKey: "slack",
        accountId,
        enabled,
        allowTopLevel: true,
      }),
    deleteAccount: ({ cfg, accountId }) =>
      deleteAccountFromConfigSection({
        cfg,
        sectionKey: "slack",
        accountId,
        clearBaseFields: [
          "name",
          "enabled",
          "botToken",
          "appToken",
          "defaultChannel",
          "dmPolicy",
          "allowFrom",
          "groupPolicy",
          "groupAllowFrom",
          "requireMention",
          "actions",
        ],
      }),
    isEnabled: (account) => account.enabled !== false,
    disabledReason: () => "disabled",
    isConfigured: async (account) => resolveSlackTokens(account).botSource !== "none",
    unconfiguredReason: () => "bot token missing",
    describeAccount: (account) => {
      const tokens = resolveSlackTokens(account);
      return {
        accountId: account.accountId,
        name: account.name,
        enabled: account.enabled,
        configured: tokens.botSource !== "none",
        dmPolicy: account.dmPolicy,
        allowFrom: account.allowFrom,
        mode: account.groupPolicy,
        allowUnmentionedGroups: account.requireMention === false,
        actions: account.actions,
        botTokenSource: tokens.botSource,
        appTokenSource: tokens.appSource,
      };
    },
    resolveAllowFrom: ({ cfg, accountId }) => resolveSlackAccount(cfg, accountId).allowFrom,
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
        approveHint: formatPairingApproveHint("slack"),
        normalizeEntry: (raw) => raw.trim(),
      };
    },
    collectWarnings: ({ account }) => {
      const warnings: string[] = [];
      if (account.groupPolicy === "open") {
        if (account.requireMention) {
          warnings.push(
            '- Slack groups/channels: groupPolicy="open" allows any member in allowed channels to trigger when Zee is mentioned. Prefer groupPolicy="allowlist" for tighter control.',
          );
        } else {
          warnings.push(
            '- Slack groups/channels: groupPolicy="open" with requireMention=false allows any member to trigger actions. Set requireMention=true or groupPolicy="allowlist".',
          );
        }
      }
      const gate = createActionGate(account.actions);
      const hasActionSurface = gate("reactions") || gate("pins") || gate("channelInfo");
      if (account.dmPolicy === "open" && account.allowFrom.includes("*") && hasActionSurface) {
        warnings.push(
          '- Slack actions: DM policy is open with wildcard allowFrom while native actions are enabled; this allows broad action triggering from any DM sender.',
        );
      }
      return warnings;
    },
  },
  setup: {
    resolveAccountId: ({ accountId }) => normalizeAccountId(accountId),
    applyAccountName: ({ cfg, accountId, name }) =>
      applyAccountNameToChannelSection({
        cfg,
        channelKey: "slack",
        accountId,
        name,
        alwaysUseAccounts: true,
      }),
    applyAccountConfig: ({ cfg, accountId, input }) => {
      let next = applyAccountNameToChannelSection({
        cfg,
        channelKey: "slack",
        accountId,
        name: input.name,
        alwaysUseAccounts: true,
      });

      const botToken = input.botToken?.trim() || input.token?.trim() || undefined;
      const appToken = input.appToken?.trim() || undefined;
      const defaultChannel = input.audience?.trim() || input.url?.trim() || undefined;
      const dmAllowlist = normalizeEntries(input.dmAllowlist);
      const groupAllowlist = normalizeEntries(input.groupChannels);

      next = applyAccountPatch({
        cfg: next,
        accountId,
        patch: {
          enabled: true,
          ...(botToken ? { botToken } : {}),
          ...(appToken ? { appToken } : {}),
          ...(defaultChannel ? { defaultChannel } : {}),
          ...(dmAllowlist.length > 0 ? { allowFrom: dmAllowlist } : {}),
          ...(groupAllowlist.length > 0 ? { groupAllowFrom: groupAllowlist } : {}),
        },
      });

      return next;
    },
  },
  groups: {
    resolveRequireMention: ({ cfg, accountId }) => resolveSlackAccount(cfg, accountId).requireMention,
  },
  commands: {
    enforceOwnerForCommands: true,
    skipWhenConfigEmpty: true,
  },
  messaging: {
    normalizeTarget: normalizeSlackTarget,
    targetResolver: {
      looksLikeId: looksLikeSlackTargetId,
      hint: "<channel-id|#channel>",
    },
  },
  status: {
    buildAccountSnapshot: ({ account }) => {
      const tokens = resolveSlackTokens(account);
      return {
        accountId: account.accountId,
        name: account.name,
        enabled: account.enabled,
        configured: tokens.botSource !== "none",
        dmPolicy: account.dmPolicy,
        allowFrom: account.allowFrom,
        mode: account.groupPolicy,
        allowUnmentionedGroups: account.requireMention === false,
        actions: account.actions,
        botTokenSource: tokens.botSource,
        appTokenSource: tokens.appSource,
      };
    },
    collectStatusIssues: collectSlackStatusIssues,
  },
  actions: {
    listActions: ({ cfg }) => {
      const account = resolveSlackAccount(cfg, resolveDefaultSlackAccountId(cfg));
      const actions: Array<"react" | "pin" | "unpin" | "channel-info"> = [];
      if (isSlackActionEnabled({ account, action: "react" })) actions.push("react");
      if (isSlackActionEnabled({ account, action: "pin" })) actions.push("pin", "unpin");
      if (isSlackActionEnabled({ account, action: "channel-info" })) actions.push("channel-info");
      return actions;
    },
    supportsAction: ({ action }) =>
      action === "react" || action === "pin" || action === "unpin" || action === "channel-info",
    handleAction: async ({ action, params, cfg, accountId }) => {
      if (
        action !== "react" &&
        action !== "pin" &&
        action !== "unpin" &&
        action !== "channel-info"
      ) {
        throw new Error(`Action ${action} is not supported for provider slack.`);
      }
      const account = resolveSlackAccount(cfg, accountId);
      if (!isSlackActionEnabled({ account, action })) {
        throw new Error(`Action ${action} is disabled by channels.slack.actions policy.`);
      }

      if (action === "channel-info") {
        const channel = resolveSlackActionTarget(params);
        const payload = await callSlackApi({
          account,
          method: "conversations.info",
          body: { channel },
        });
        return jsonResult({
          ok: true,
          action,
          channel: payload.channel ?? channel,
        });
      }

      const channel = resolveSlackActionTarget(params);
      const messageId = readStringParam(params, "messageId", {
        required: true,
        label: "messageId",
      });

      if (action === "react") {
        const emojiRaw = readStringParam(params, "emoji", { required: true, label: "emoji" });
        const emoji = normalizeSlackEmoji(emojiRaw);
        const remove = params.remove === true;
        await callSlackApi({
          account,
          method: remove ? "reactions.remove" : "reactions.add",
          body: {
            channel,
            timestamp: messageId,
            name: emoji,
          },
        });
        return jsonResult({
          ok: true,
          action,
          channel,
          messageId,
          emoji,
          remove,
        });
      }

      await callSlackApi({
        account,
        method: action === "pin" ? "pins.add" : "pins.remove",
        body: {
          channel,
          timestamp: messageId,
        },
      });
      return jsonResult({
        ok: true,
        action,
        channel,
        messageId,
      });
    },
  },
  outbound: {
    deliveryMode: "direct",
    textChunkLimit: 4000,
    resolveTarget: ({ cfg, accountId, to, allowFrom }) => {
      const trimmed = to?.trim();
      if (trimmed) return { ok: true, to: normalizeSlackTarget(trimmed) ?? trimmed };

      const account = cfg ? resolveSlackAccount(cfg, accountId) : null;
      const allowlist = normalizeEntries(allowFrom).filter((entry) => entry !== "*");
      const fallback = account?.defaultChannel?.trim() || allowlist[0];
      if (fallback) return { ok: true, to: fallback };

      return {
        ok: false,
        error: missingTargetError(
          "Slack",
          "<channel-id|#channel> or channels.slack.defaultChannel",
        ),
      };
    },
    sendText: async ({ cfg, to, text, threadId, accountId }) => {
      const account = resolveSlackAccount(cfg, accountId);
      const result = await sendSlackText({
        account,
        to,
        text,
        threadId,
      });
      return {
        channel: "slack",
        messageId: result.messageId,
        channelId: result.channelId,
        meta: result.meta,
      };
    },
    sendMedia: async ({ cfg, to, text, mediaUrl, threadId, accountId }) => {
      const account = resolveSlackAccount(cfg, accountId);
      const composed = mediaUrl ? `${text ? `${text}\n\n` : ""}${mediaUrl}` : text;
      const result = await sendSlackText({
        account,
        to,
        text: composed,
        threadId,
      });
      return {
        channel: "slack",
        messageId: result.messageId,
        channelId: result.channelId,
        meta: result.meta,
      };
    },
  },
};
