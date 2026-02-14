import type { AgentBinding, AgentsConfig } from "./types.agents.js";
import type { ApprovalsConfig } from "./types.approvals.js";
import type { AuthConfig } from "./types.auth.js";
import type { DiagnosticsConfig, LoggingConfig, SessionConfig, WebConfig } from "./types.base.js";
import type { BrowserConfig } from "./types.browser.js";
import type { CanvasHostConfig } from "./types.canvas-host.js";
import type { ChannelsConfig } from "./types.channels.js";
import type { CronConfig } from "./types.cron.js";
import type {
  DiscoveryConfig,
  GatewayConfig,
  TalkConfig,
} from "./types.gateway.js";
import type { HooksConfig } from "./types.hooks.js";
import type {
  AudioConfig,
  BroadcastConfig,
  CommandsConfig,
  MessagesConfig,
} from "./types.messages.js";
import type { ModelsConfig } from "./types.models.js";
import type { NodeHostConfig } from "./types.node-host.js";
import type { PluginsConfig } from "./types.plugins.js";
import type { SecurityConfig } from "./types.security.js";
import type { SkillsConfig } from "./types.skills.js";
import type { ToolsConfig } from "./types.tools.js";

/** User identity configuration for personalization. */
export type UserConfig = {
  /** User's display name (e.g., "Artur"). */
  name?: string;
  /** User's phone number in E164 format (e.g., "+1234567890"). */
  phone?: string;
  /** User's email address. */
  email?: string;
  /** User's preferred language (e.g., "en", "pt", "de"). */
  language?: string;
  /** User's location/city for context (e.g., "Vienna, Austria"). */
  location?: string;
  /** Additional notes about the user for context. */
  notes?: string;
};

export type ContactConfig = {
  /** Contact display name (e.g., "Ruth"). */
  name: string;
  /** Alternative names/aliases ("partner", "Ruth A.", etc.). */
  aliases?: string[];
  /** Primary phone number (E164). */
  phone?: string;
  /** Primary email address. */
  email?: string;
  /** Per-channel identifiers (e.g., { whatsapp: "+123" }). */
  channels?: Record<string, string | number>;
  /** Additional notes about the contact. */
  notes?: string;
};

export type ContactsConfig = Record<string, ContactConfig>;

export type ZeeConfig = {
  meta?: {
    /** Last Zee version that wrote this config. */
    lastTouchedVersion?: string;
    /** ISO timestamp when this config was last written. */
    lastTouchedAt?: string;
  };
  /** User identity and preferences. Injected into system prompts. */
  user?: UserConfig;
  /** Contact registry used for outbound targeting and disambiguation. */
  contacts?: ContactsConfig;
  auth?: AuthConfig;
  env?: {
    /** Opt-in: import missing secrets from a login shell environment (exec `$SHELL -l -c 'env -0'`). */
    shellEnv?: {
      enabled?: boolean;
      /** Timeout for the login shell exec (ms). Default: 15000. */
      timeoutMs?: number;
    };
    /** Inline env vars to apply when not already present in the process env. */
    vars?: Record<string, string>;
    /** Sugar: allow env vars directly under env (string values only). */
    [key: string]:
      | string
      | Record<string, string>
      | { enabled?: boolean; timeoutMs?: number }
      | undefined;
  };
  wizard?: {
    lastRunAt?: string;
    lastRunVersion?: string;
    lastRunCommit?: string;
    lastRunCommand?: string;
    lastRunMode?: "local" | "remote";
  };
  diagnostics?: DiagnosticsConfig;
  logging?: LoggingConfig;
  update?: {
    /** Update channel for git + npm installs ("stable", "beta", or "dev"). */
    channel?: "stable" | "beta" | "dev";
    /** Check for updates on gateway start (npm installs only). */
    checkOnStart?: boolean;
  };
  browser?: BrowserConfig;
  ui?: {
    /** Accent color for Zee UI chrome (hex). */
    seamColor?: string;
    assistant?: {
      /** Assistant display name for UI surfaces. */
      name?: string;
      /** Assistant avatar (emoji, short text, or image URL/data URI). */
      avatar?: string;
    };
  };
  skills?: SkillsConfig;
  plugins?: PluginsConfig;
  models?: ModelsConfig;
  nodeHost?: NodeHostConfig;
  agents?: AgentsConfig;
  tools?: ToolsConfig;
  bindings?: AgentBinding[];
  broadcast?: BroadcastConfig;
  audio?: AudioConfig;
  messages?: MessagesConfig;
  commands?: CommandsConfig;
  approvals?: ApprovalsConfig;
  session?: SessionConfig;
  web?: WebConfig;
  channels?: ChannelsConfig;
  cron?: CronConfig;
  hooks?: HooksConfig;
  discovery?: DiscoveryConfig;
  talk?: TalkConfig;
  canvasHost?: CanvasHostConfig;
  gateway?: GatewayConfig;
  security?: SecurityConfig;
};

export type ConfigValidationIssue = {
  path: string;
  message: string;
};

export type LegacyConfigIssue = {
  path: string;
  message: string;
};

export type ConfigFileSnapshot = {
  path: string;
  exists: boolean;
  raw: string | null;
  parsed: unknown;
  valid: boolean;
  config: ZeeConfig;
  hash?: string;
  issues: ConfigValidationIssue[];
  warnings: ConfigValidationIssue[];
  legacyIssues: LegacyConfigIssue[];
};
