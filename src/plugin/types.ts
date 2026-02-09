/**
 * Plugin System Types
 *
 * Hook-based extensibility and domain-specific plugins
 */

import type { AgentConfig } from "../agent/types";
import type { Model } from "../provider/types";

/** Provider info for plugin hooks */
export interface ProviderInfo {
  id: string;
  name: string;
  models: string[];
  defaultModel?: string;
  authMethod?: string;
}

/** Tool context for plugin tools */
export interface ToolContext {
  sessionId: string;
  messageId: string;
  agent: string;
  abort: AbortSignal;
}

/** Message part for events */
export interface MessagePart {
  id: string;
  type: "text" | "tool_call" | "tool_result" | "image";
  content: unknown;
}

/** Inbound message from surface */
export interface InboundMessage {
  id: string;
  senderId: string;
  body: string;
  timestamp: number;
}

/** Outbound message to surface */
export interface OutboundMessage {
  id: string;
  recipientId: string;
  body: string;
  replyTo?: string;
}

/** Session info for plugin hooks */
export interface SessionInfo {
  id: string;
  time: { created: number; updated: number; archived?: number };
  title: string;
  projectId: string;
  directory: string;
  version: string;
  summary?: { additions: number; deletions: number; files: number };
  parentId?: string;
  context?: Record<string, unknown>;
}

/** Message info for plugin hooks */
export interface MessageInfo {
  id: string;
  sessionId: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: number;
}

/** Plugin lifecycle */
export type PluginLifecycle = "loaded" | "enabled" | "disabled" | "error";

/** Plugin metadata */
export interface PluginMeta {
  /** Plugin name */
  name: string;

  /** Plugin version */
  version: string;

  /** Plugin description */
  description?: string;

  /** Plugin author */
  author?: string;

  /** Plugin homepage/repository */
  homepage?: string;

  /** Plugin dependencies */
  dependencies?: Record<string, string>;

  /** Minimum zee version */
  agentCoreVersion?: string;
}

/** Plugin definition */
export interface PluginDefinition {
  /** Plugin metadata */
  meta: PluginMeta;

  /** Plugin lifecycle hooks */
  hooks?: PluginHooks;

  /** Tool definitions */
  tools?: Record<string, PluginToolDefinition>;

  /** Provider authentication handler */
  auth?: PluginAuthHandler;

  /** Custom commands */
  commands?: Record<string, PluginCommand>;

  /** Initialize plugin */
  init?(): Promise<void>;

  /** Cleanup plugin */
  cleanup?(): Promise<void>;
}

/** Plugin hooks */
export interface PluginHooks {
  /** Before session starts */
  "session.start"?: (session: SessionInfo) => Promise<void>;

  /** After session ends */
  "session.end"?: (session: SessionInfo) => Promise<void>;

  /** Before message sent to model */
  "message.before"?: (message: MessageInfo, context: HookContext) => Promise<MessageInfo>;

  /** After message received from model */
  "message.after"?: (message: MessageInfo, context: HookContext) => Promise<void>;

  /** Before tool execution */
  "tool.before"?: (
    tool: { name: string; input: unknown },
    context: HookContext
  ) => Promise<{ name: string; input: unknown }>;

  /** After tool execution */
  "tool.after"?: (
    tool: { name: string; input: unknown; output: unknown },
    context: HookContext
  ) => Promise<void>;

  /** Permission check */
  "permission.ask"?: (
    permission: PermissionHookInput,
    context: HookContext
  ) => Promise<{ status: "allow" | "deny" | "ask" }>;

  /** Before file edit */
  "file.before_edit"?: (
    file: { path: string; content: string; original: string },
    context: HookContext
  ) => Promise<{ path: string; content: string }>;

  /** After file edit */
  "file.after_edit"?: (
    file: { path: string; content: string },
    context: HookContext
  ) => Promise<void>;

  /** Before bash command */
  "bash.before"?: (
    command: string,
    context: HookContext
  ) => Promise<string>;

  /** After bash command */
  "bash.after"?: (
    command: string,
    output: string,
    exitCode: number,
    context: HookContext
  ) => Promise<void>;

  /** On memory save */
  "memory.save"?: (
    memory: { content: string; category: string },
    context: HookContext
  ) => Promise<void>;

  /** On error */
  "error"?: (error: Error, context: HookContext) => Promise<void>;
}

/** Hook context */
export interface HookContext {
  session?: SessionInfo;
  message?: MessageInfo;
  agent?: AgentConfig;
  model?: Model;
  provider?: ProviderInfo;
}

/** Hook handler type */
export type HookHandler = (input: unknown, context: HookContext) => Promise<unknown>;

/** Permission hook input */
export interface PermissionHookInput {
  id: string;
  type: string;
  pattern?: string | string[];
  sessionId: string;
  messageId: string;
  callId?: string;
  title: string;
  metadata: Record<string, unknown>;
}

/** Plugin tool definition */
export interface PluginToolDefinition {
  description: string;
  args: Record<string, unknown>;
  execute: (args: unknown, context: ToolContext) => Promise<string | object>;
}

/** Plugin auth handler for providers */
export interface PluginAuthHandler {
  /** Provider ID this handles */
  provider: string;

  /** Load authentication */
  loader: (
    getAuth: () => Promise<PluginAuthEntry | undefined>,
    providerInfo: ProviderInfo
  ) => Promise<Record<string, unknown>>;

  /** Interactive authentication flow */
  authenticate?: () => Promise<PluginAuthEntry>;

  /** Refresh expired tokens */
  refresh?: (entry: PluginAuthEntry) => Promise<PluginAuthEntry>;
}

/** Plugin auth entry */
export interface PluginAuthEntry {
  type: "api" | "oauth" | "custom";
  key?: string;
  tokens?: {
    accessToken: string;
    refreshToken?: string;
    expiresAt?: number;
  };
  data?: Record<string, unknown>;
}

/** Plugin command */
export interface PluginCommand {
  description: string;
  args?: Record<string, { type: string; description?: string; required?: boolean }>;
  execute: (args: Record<string, unknown>) => Promise<string>;
}

/** Plugin manager interface */
export interface PluginManager {
  /** Load plugins from paths */
  load(paths: string[]): Promise<void>;

  /** List loaded plugins */
  list(): PluginDefinition[];

  /** Get plugin by name */
  get(name: string): PluginDefinition | undefined;

  /** Enable plugin */
  enable(name: string): Promise<void>;

  /** Disable plugin */
  disable(name: string): Promise<void>;

  /** Trigger hook */
  trigger<T>(
    hook: string,
    input: unknown,
    context: HookContext,
    defaultValue?: T
  ): Promise<T>;

  /** Register plugin */
  register(plugin: PluginDefinition): Promise<void>;

  /** Unregister plugin */
  unregister(name: string): Promise<void>;
}

/** Event bus for plugin communication */
export interface EventBus {
  /** Publish event */
  publish<T>(event: string, data: T): void;

  /** Subscribe to event */
  subscribe<T>(event: string, handler: (data: T) => void): () => void;

  /** Subscribe once */
  once<T>(event: string, handler: (data: T) => void): () => void;

  /** Wait for event */
  waitFor<T>(event: string, timeout?: number): Promise<T>;
}

/** Built-in event types */
export interface CoreEvents {
  "session.created": SessionInfo;
  "session.updated": SessionInfo;
  "session.deleted": SessionInfo;
  "message.created": MessageInfo;
  "message.updated": MessageInfo;
  "message.deleted": { sessionId: string; messageId: string };
  "part.created": MessagePart;
  "part.updated": { part: MessagePart; delta?: string };
  "permission.updated": PermissionHookInput;
  "permission.replied": { sessionId: string; permissionId: string; response: string };
  "mcp.tools.changed": { server: string };
  "surface.message": InboundMessage;
  "surface.send": OutboundMessage;
  "error": Error;
}

/** Automation rule */
export interface AutomationRule {
  id: string;
  name: string;
  trigger: AutomationTrigger;
  conditions?: AutomationCondition[];
  actions: AutomationAction[];
  enabled: boolean;
}

export type AutomationTrigger =
  | { type: "event"; event: string }
  | { type: "schedule"; cron: string }
  | { type: "file_change"; patterns: string[] }
  | { type: "webhook"; path: string };

export type AutomationCondition =
  | { type: "match"; field: string; pattern: string }
  | { type: "time"; start?: string; end?: string; days?: number[] }
  | { type: "custom"; fn: (context: unknown) => boolean };

export type AutomationAction =
  | { type: "message"; template: string }
  | { type: "tool"; name: string; input: Record<string, unknown> }
  | { type: "webhook"; url: string; method?: string; body?: unknown }
  | { type: "custom"; fn: (context: unknown) => Promise<void> };

/** Automation engine interface */
export interface AutomationEngine {
  /** Register rule */
  register(rule: AutomationRule): Promise<void>;

  /** Unregister rule */
  unregister(ruleId: string): Promise<void>;

  /** List rules */
  list(): AutomationRule[];

  /** Enable/disable rule */
  setEnabled(ruleId: string, enabled: boolean): Promise<void>;

  /** Trigger rule manually */
  trigger(ruleId: string, context?: unknown): Promise<void>;
}
