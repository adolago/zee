import type { DmPolicy } from "./types.base.js";
import type { ProviderCommandsConfig } from "./types.messages.js";
import type { ChannelHeartbeatVisibilityConfig } from "./types.channels.js";

export type MatrixThreadRepliesMode = "off" | "inbound" | "always";

export type MatrixConfig = {
  /** Optional display name for this account (used in CLI/UI lists). */
  name?: string;
  /** If false, do not start the Matrix client. Default: true. */
  enabled?: boolean;
  /** Allow channel-initiated config writes (default: true). */
  configWrites?: boolean;
  /** Override native command registration for Matrix (bool or "auto"). */
  commands?: ProviderCommandsConfig;

  homeserver?: string;
  userId?: string;
  accessToken?: string;

  /** Enable E2EE via olm/megolm when supported by the runtime. */
  encryption?: boolean;

  /** DM access control ("pairing" recommended). */
  dmPolicy?: DmPolicy;
  allowFrom?: string[];

  /** Controls whether replies should be threaded when reply metadata is present. */
  threadReplies?: MatrixThreadRepliesMode;

  heartbeat?: ChannelHeartbeatVisibilityConfig;
  /** Optional outbound retry config (when supported by the channel adapter). */
  retry?: Record<string, unknown>;

  /** Optional per-account config (reserved for future multi-account Matrix support). */
  accounts?: Record<string, unknown>;
};

