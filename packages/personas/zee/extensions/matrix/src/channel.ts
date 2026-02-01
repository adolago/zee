/**
 * Matrix Channel Plugin
 *
 * Implements the ChannelPlugin interface for Matrix, following the
 * Telegram extension pattern. Supports DMs, groups, threads, reactions,
 * media, and E2EE via the Rust crypto SDK.
 */

import type {
  ChannelPlugin,
  ChannelMessageActionAdapter,
  ZeeConfig,
} from "zee/plugin-sdk";
import { getChatChannelMeta } from "zee/plugin-sdk";
import { getMatrixRuntime } from "./runtime.js";
import {
  createMatrixClient,
  getActiveMatrixClient,
  startMatrixClient,
  stopMatrixClient,
} from "./client.js";
import { sendText, sendMedia } from "./outbound.js";
import { initializeCryptoStore } from "./crypto.js";

const DEFAULT_ACCOUNT_ID = "default";
const DEFAULT_STATE_DIR = "~/.zee/matrix";

export interface ResolvedMatrixAccount {
  accountId: string;
  name?: string;
  enabled: boolean;
  homeserver: string;
  userId: string;
  accessToken: string;
  encryption: boolean;
  dmPolicy: string;
  allowFrom: string[];
  threadReplies: string;
  tokenSource: "config" | "env" | "none";
}

function resolveMatrixAccount(params: {
  cfg: ZeeConfig;
  accountId?: string | null;
}): ResolvedMatrixAccount {
  const { cfg, accountId } = params;
  const matrixConfig = (cfg.channels as Record<string, unknown> | undefined)?.matrix as
    | Record<string, unknown>
    | undefined;

  if (!matrixConfig) {
    return {
      accountId: accountId ?? DEFAULT_ACCOUNT_ID,
      enabled: false,
      homeserver: "",
      userId: "",
      accessToken: "",
      encryption: false,
      dmPolicy: "pairing",
      allowFrom: [],
      threadReplies: "off",
      tokenSource: "none",
    };
  }

  const envToken = process.env.MATRIX_ACCESS_TOKEN?.trim();

  return {
    accountId: accountId ?? DEFAULT_ACCOUNT_ID,
    name: matrixConfig.name as string | undefined,
    enabled: matrixConfig.enabled !== false,
    homeserver: (matrixConfig.homeserver as string) ?? "",
    userId: (matrixConfig.userId as string) ?? "",
    accessToken: envToken ?? (matrixConfig.accessToken as string) ?? "",
    encryption: (matrixConfig.encryption as boolean) ?? false,
    dmPolicy: (matrixConfig.dmPolicy as string) ?? "pairing",
    allowFrom: Array.isArray(matrixConfig.allowFrom)
      ? matrixConfig.allowFrom.map(String)
      : [],
    threadReplies: (matrixConfig.threadReplies as string) ?? "off",
    tokenSource: envToken ? "env" : matrixConfig.accessToken ? "config" : "none",
  };
}

const meta = getChatChannelMeta("matrix");

const matrixMessageActions: ChannelMessageActionAdapter = {
  listActions: () => [],
  supportsAction: () => false,
};

export const matrixPlugin: ChannelPlugin<ResolvedMatrixAccount> = {
  id: "matrix",
  meta: {
    ...(meta ?? {
      id: "matrix",
      label: "Matrix",
      selectionLabel: "Matrix (E2EE)",
      detailLabel: "Matrix Homeserver",
      docsPath: "/channels/matrix",
      docsLabel: "matrix",
      blurb: "end-to-end encrypted messaging via any Matrix homeserver.",
      systemImage: "lock.shield",
    }),
  },
  capabilities: {
    chatTypes: ["direct", "group", "thread"],
    reactions: true,
    threads: true,
    media: true,
    encryption: true,
    encryptionProtocol: "olm-megolm",
  },
  reload: { configPrefixes: ["channels.matrix"] },
  config: {
    listAccountIds: () => [DEFAULT_ACCOUNT_ID],
    resolveAccount: (cfg, accountId) => resolveMatrixAccount({ cfg, accountId }),
    defaultAccountId: () => DEFAULT_ACCOUNT_ID,
    isConfigured: (account) =>
      Boolean(account.homeserver && account.userId && account.accessToken),
    describeAccount: (account) => ({
      accountId: account.accountId,
      name: account.name,
      enabled: account.enabled,
      configured: Boolean(account.homeserver && account.userId && account.accessToken),
      tokenSource: account.tokenSource,
    }),
    resolveAllowFrom: ({ cfg }) => {
      const account = resolveMatrixAccount({ cfg });
      return account.allowFrom;
    },
  },
  security: {
    resolveDmPolicy: ({ cfg, accountId, account }) => ({
      policy: account.dmPolicy,
      allowFrom: account.allowFrom,
      policyPath: "channels.matrix.dmPolicy",
      allowFromPath: "channels.matrix.",
      approveHint: "approve the room invite from the Matrix client",
      normalizeEntry: (raw) => raw.replace(/^matrix:/i, "").trim().toLowerCase(),
    }),
  },
  encryption: {
    protocol: "olm-megolm",
    initialize: async ({ stateDir }) => {
      await initializeCryptoStore({ stateDir });
    },
    isActive: async ({ cfg }) => {
      const account = resolveMatrixAccount({ cfg });
      return account.encryption;
    },
  },
  pairing: {
    idLabel: "matrixUserId",
    normalizeAllowEntry: (entry) => entry.replace(/^matrix:/i, "").trim().toLowerCase(),
  },
  threading: {
    resolveReplyToMode: ({ cfg }) => {
      const matrixConfig = (cfg.channels as Record<string, unknown> | undefined)?.matrix as
        | Record<string, unknown>
        | undefined;
      const threadReplies = (matrixConfig?.threadReplies as string) ?? "off";
      if (threadReplies === "always") return "all";
      if (threadReplies === "inbound") return "first";
      return "off";
    },
  },
  messaging: {
    normalizeTarget: (raw) => raw.trim().toLowerCase(),
    targetResolver: {
      looksLikeId: (raw) => raw.startsWith("@") || raw.startsWith("!"),
      hint: "@user:server or !roomId:server",
    },
  },
  directory: {
    self: async () => null,
    listPeers: async () => [],
    listGroups: async () => [],
  },
  actions: matrixMessageActions,
  setup: {
    resolveAccountId: ({ accountId }) => accountId ?? DEFAULT_ACCOUNT_ID,
    applyAccountConfig: ({ cfg, input }) => ({
      ...cfg,
      channels: {
        ...cfg.channels,
        matrix: {
          ...(cfg.channels as Record<string, unknown>)?.matrix as object,
          enabled: true,
          homeserver: input.homeserver ?? "",
          userId: input.userId ?? "",
          accessToken: input.accessToken ?? "",
        },
      },
    }),
  },
  outbound: {
    deliveryMode: "direct",
    textChunkLimit: 16384,
    sendText: async ({ to, text, replyToId, threadId }) => {
      const client = getActiveMatrixClient();
      if (!client) throw new Error("Matrix client not connected");
      const result = await sendText(client, to, text, {
        threadRootEventId: threadId != null ? String(threadId) : undefined,
        replyToEventId: replyToId ?? undefined,
      });
      return { channel: "matrix", ...result };
    },
    sendMedia: async ({ to, text, mediaUrl, replyToId, threadId }) => {
      const client = getActiveMatrixClient();
      if (!client) throw new Error("Matrix client not connected");
      const result = await sendMedia(client, to, mediaUrl ?? "", {
        text: text || undefined,
        threadRootEventId: threadId != null ? String(threadId) : undefined,
        replyToEventId: replyToId ?? undefined,
      });
      return { channel: "matrix", ...result };
    },
  },
  status: {
    defaultRuntime: {
      accountId: DEFAULT_ACCOUNT_ID,
      running: false,
      lastStartAt: null,
      lastStopAt: null,
      lastError: null,
    },
    buildAccountSnapshot: ({ account, runtime }) => ({
      accountId: account.accountId,
      name: account.name,
      enabled: account.enabled,
      configured: Boolean(account.homeserver && account.userId && account.accessToken),
      tokenSource: account.tokenSource,
      running: runtime?.running ?? false,
      lastStartAt: runtime?.lastStartAt ?? null,
      lastStopAt: runtime?.lastStopAt ?? null,
      lastError: runtime?.lastError ?? null,
      baseUrl: account.homeserver || null,
    }),
  },
  gateway: {
    startAccount: async (ctx) => {
      const account = ctx.account;
      if (!account.homeserver || !account.accessToken || !account.userId) {
        throw new Error("Matrix requires homeserver, accessToken, and userId");
      }

      const stateDir = DEFAULT_STATE_DIR.replace("~", process.env.HOME ?? "");
      if (account.encryption) {
        await initializeCryptoStore({ stateDir, userId: account.userId });
      }

      const client = createMatrixClient({
        homeserver: account.homeserver,
        accessToken: account.accessToken,
        userId: account.userId,
        stateDir,
      });

      ctx.log?.info(`[${account.accountId}] starting Matrix client for ${account.userId}`);
      await startMatrixClient(client);
      ctx.setStatus({ ...ctx.getStatus(), running: true, lastStartAt: Date.now() });

      return client;
    },
    stopAccount: async (ctx) => {
      await stopMatrixClient();
      ctx.setStatus({ ...ctx.getStatus(), running: false, lastStopAt: Date.now() });
    },
    logoutAccount: async () => {
      await stopMatrixClient();
      return { cleared: true, loggedOut: true };
    },
  },
};
