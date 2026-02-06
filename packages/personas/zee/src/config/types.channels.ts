import type { MatrixConfig } from "./types.matrix.js";
import type { WhatsAppConfig } from "./types.whatsapp.js";
import type { GroupPolicy } from "./types.base.js";

export type ChannelHeartbeatVisibilityConfig = {
  /** Show HEARTBEAT_OK acknowledgments in chat (default: false). */
  showOk?: boolean;
  /** Show heartbeat alerts with actual content (default: true). */
  showAlerts?: boolean;
  /** Emit indicator events for UI status display (default: true). */
  useIndicator?: boolean;
};

export type ChannelDefaultsConfig = {
  groupPolicy?: GroupPolicy;
  /** Default heartbeat visibility for all channels. */
  heartbeat?: ChannelHeartbeatVisibilityConfig;
};

export type ChannelsConfig = {
  defaults?: ChannelDefaultsConfig;
  whatsapp?: WhatsAppConfig;
  matrix?: MatrixConfig;
  [key: string]: unknown;
};
