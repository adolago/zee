/**
 * Shared Configuration Primitives
 *
 * Types shared between agent-core and zee gateway.
 * These are the canonical definitions - both projects should use these.
 */

// =============================================================================
// Session Primitives
// =============================================================================

/** How sessions are scoped */
export type SessionScope = "per-sender" | "global";

/** Reply behavior mode */
export type ReplyMode = "text" | "command";

/** When to show typing indicator */
export type TypingMode = "never" | "instant" | "thinking" | "message";

/** Reply-to threading behavior */
export type ReplyToMode = "off" | "first" | "all";

// =============================================================================
// Access Policy Primitives
// =============================================================================

/** Direct message access policy */
export type DmPolicy = "pairing" | "allowlist" | "open" | "disabled";

/** Group message access policy */
export type GroupPolicy = "open" | "disabled" | "allowlist";

// =============================================================================
// Logging Primitives
// =============================================================================

/** Log levels (compatible with pino/tslog) */
export type LogLevel =
  | "silent"
  | "fatal"
  | "error"
  | "warn"
  | "info"
  | "debug"
  | "trace";

/** Console output style */
export type ConsoleStyle = "pretty" | "compact" | "json";

/** Base logging configuration */
export interface LoggingConfig {
  /** Log level threshold */
  level?: LogLevel;
  /** Log file path */
  file?: string;
  /** Console-specific log level */
  consoleLevel?: LogLevel;
  /** Console output format */
  consoleStyle?: ConsoleStyle;
  /** Wide event logging configuration */
  wideEvents?: {
    enabled?: boolean;
    file?: string;
    sampleRate?: number;
    slowMs?: number;
    payloads?: "summary" | "debug" | "full";
  };
}

// =============================================================================
// Retry Configuration
// =============================================================================

/** Outbound request retry configuration */
export interface RetryConfig {
  /** Max retry attempts (default: 3) */
  attempts?: number;
  /** Minimum retry delay in ms */
  minDelayMs?: number;
  /** Maximum retry delay cap in ms */
  maxDelayMs?: number;
  /** Jitter factor (0-1) applied to delays */
  jitter?: number;
}

// =============================================================================
// Model/Provider Primitives
// =============================================================================

/** API type for model providers */
export type ModelApi =
  | "anthropic-messages"
  | "openai-chat"
  | "openai-responses"
  | "google-genai"
  | "bedrock-converse";

/** Model input modalities */
export type ModelInputModality = "text" | "image" | "audio" | "video" | "file";

/** Token cost structure */
export interface TokenCost {
  input: number;
  output: number;
  cacheRead?: number;
  cacheWrite?: number;
}

/** Model definition */
export interface ModelDefinition {
  /** Model identifier */
  id: string;
  /** Display name */
  name?: string;
  /** Supports extended thinking */
  reasoning?: boolean;
  /** Supported input types */
  input?: ModelInputModality[];
  /** Token costs per million */
  cost?: TokenCost;
  /** Context window size in tokens */
  contextWindow?: number;
  /** Max output tokens */
  maxTokens?: number;
  /** Custom headers for this model */
  headers?: Record<string, string>;
}

/** Provider configuration */
export interface ProviderDefinition {
  /** API base URL */
  baseUrl: string;
  /** API key (or env var reference) */
  apiKey?: string;
  /** API type */
  api?: ModelApi;
  /** Custom headers */
  headers?: Record<string, string>;
  /** Available models */
  models?: ModelDefinition[];
}

// =============================================================================
// Thinking Configuration
// =============================================================================

/** Thinking/reasoning level */
export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high";

// =============================================================================
// Queue/Processing Configuration
// =============================================================================

/** Queue processing mode */
export type QueueMode = "fifo" | "lifo" | "priority" | "debounce";

/** Queue drop policy when full */
export type QueueDropPolicy = "oldest" | "newest" | "none";

// =============================================================================
// Bind/Network Configuration
// =============================================================================

/** Network bind mode */
export type BindMode = "auto" | "lan" | "tailnet" | "loopback";

// =============================================================================
// Session Entry Primitives (shared between agent-core and zee)
// =============================================================================

/** Chat type for sessions */
export type SessionChatType = "direct" | "group" | "room";

/** Provider identifiers for messaging platforms */
export type MessagingProvider = "whatsapp" | "matrix";

/** Group activation mode */
export type GroupActivation = "mention" | "always";

/** Send policy for sessions */
export type SendPolicy = "allow" | "deny";

// =============================================================================
// Re-exports for convenience
// =============================================================================

export type {
  SessionScope as SessionScopeType,
  DmPolicy as DmPolicyType,
  GroupPolicy as GroupPolicyType,
  LogLevel as LogLevelType,
  ThinkingLevel as ThinkingLevelType,
  SessionChatType as SessionChatTypeType,
  MessagingProvider as MessagingProviderType,
};
