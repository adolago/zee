import type { DmPolicy, GroupPolicy, MarkdownConfig, ReplyToMode } from "./types.base.js";
import type { ProviderCommandsConfig } from "./types.messages.js";
import type { ChannelHeartbeatVisibilityConfig } from "./types.channels.js";

export type MatrixThreadRepliesMode = "off" | "inbound" | "always";

export type MatrixDmConfig = {
  /** If false, ignore all incoming Matrix DMs. Default: true. */
  enabled?: boolean;
  /** Direct message access policy (default: pairing). */
  policy?: DmPolicy;
  /** Allowlist for DM senders (matrix user IDs or "*"). */
  allowFrom?: Array<string | number>;
};

export type MatrixRoomConfig = {
  /** If false, disable the bot in this room (alias for allow: false). */
  enabled?: boolean;
  /** Legacy room allow toggle; prefer enabled. */
  allow?: boolean;
  /** Require mentioning the bot to trigger replies. */
  requireMention?: boolean;
  /** Optional tool policy overrides for this room. */
  tools?: { allow?: string[]; deny?: string[] };
  /** If true, reply without mention requirements. */
  autoReply?: boolean;
  /** Optional allowlist for room senders (matrix user IDs). */
  users?: Array<string | number>;
  /** Optional skill filter for this room. */
  skills?: string[];
  /** Optional system prompt snippet for this room. */
  systemPrompt?: string;
};

export type MatrixActionConfig = {
  reactions?: boolean;
  messages?: boolean;
  pins?: boolean;
  memberInfo?: boolean;
  channelInfo?: boolean;
};

export type MatrixConfig = {
  /** Optional display name for this account (used in CLI/UI lists). */
  name?: string;
  /** If false, do not start the Matrix client. Default: true. */
  enabled?: boolean;
  /** Allow channel-initiated config writes (default: true). */
  configWrites?: boolean;
  /** Override native command registration for Matrix (bool or "auto"). */
  commands?: ProviderCommandsConfig;
  /** Markdown formatting overrides (tables). */
  markdown?: MarkdownConfig;

  homeserver?: string;
  userId?: string;
  accessToken?: string;
  password?: string;
  deviceName?: string;
  initialSyncLimit?: number;

  /** Enable E2EE via olm/megolm when supported by the runtime. */
  encryption?: boolean;

  /** If true, enforce allowlists for groups + DMs regardless of policy. */
  allowlistOnly?: boolean;

  /** Direct message policy + allowlist overrides. */
  dm?: MatrixDmConfig;

  /** Group message policy (default: allowlist). */
  groupPolicy?: GroupPolicy;
  /** Allowlist for group senders (matrix user IDs). */
  groupAllowFrom?: Array<string | number>;

  /** Room config allowlist keyed by room ID or alias (names resolved to IDs when possible). */
  groups?: Record<string, MatrixRoomConfig>;
  /** Room config allowlist keyed by room ID or alias. Legacy; use groups. */
  rooms?: Record<string, MatrixRoomConfig>;

  /** Controls whether replies should be threaded when reply metadata is present. */
  threadReplies?: MatrixThreadRepliesMode;
  /** Control reply-to behavior outside of thread replies (off|first|all). */
  replyToMode?: ReplyToMode;

  /** Outbound text chunk size (chars). Default: 4000. */
  textChunkLimit?: number;
  /** Chunking mode: "length" (default) splits by size; "newline" splits on every newline. */
  chunkMode?: "length" | "newline";
  /** Outbound response prefix override for this channel/account. */
  responsePrefix?: string;

  /** Max outbound media size in MB. */
  mediaMaxMb?: number;

  /** Auto-join invites (always|allowlist|off). Default: always. */
  autoJoin?: "always" | "allowlist" | "off";
  /** Allowlist for auto-join invites (room IDs, aliases). */
  autoJoinAllowlist?: Array<string | number>;

  /** Per-action tool gating (default: true for all). */
  actions?: MatrixActionConfig;

  /** Heartbeat visibility settings for this channel. */
  heartbeat?: ChannelHeartbeatVisibilityConfig;
  /** Optional outbound retry config (when supported by the channel adapter). */
  retry?: Record<string, unknown>;

  /** Optional per-account config (reserved for future multi-account Matrix support). */
  accounts?: Record<string, unknown>;

  /**
   * Legacy key (auto-migrated): use channels.matrix.dm.policy instead.
   * @deprecated
   */
  dmPolicy?: DmPolicy;
  /**
   * Legacy key (auto-migrated): use channels.matrix.dm.allowFrom instead.
   * @deprecated
   */
  allowFrom?: Array<string | number>;
};

