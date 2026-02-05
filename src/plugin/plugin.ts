/**
 * Plugin System Interface
 *
 * Architecture Overview:
 * - Plugins are the primary extension mechanism for agent-core
 * - Each plugin exports a factory function that receives PluginContext
 * - Plugins return a Hooks object with registered hook handlers
 * - Lifecycle: init -> active (hooks called) -> destroy
 *
 * Design Decisions:
 * - Plugin interface inspired by legacy patterns but extended for agent use cases
 * - Lifecycle hooks added for proper resource management
 * - Auth providers support multiple authentication strategies
 * - Tool registration allows plugins to extend agent capabilities
 */

import { z } from 'zod';

// =============================================================================
// Core Plugin Types
// =============================================================================

/**
 * Plugin metadata for identification and versioning
 */
export interface PluginMetadata {
  /** Unique plugin identifier */
  name: string;
  /** Semantic version string */
  version: string;
  /** Human-readable description */
  description?: string;
  /** Plugin author or maintainer */
  author?: string;
  /** Plugin homepage or repository URL */
  homepage?: string;
  /** Plugin dependencies (other plugins) */
  dependencies?: string[];
  /** Plugin tags for categorization */
  tags?: string[];
}

/**
 * Context provided to plugins during initialization
 */
export interface PluginContext {
  /** Unique instance identifier */
  instanceId: string;
  /** Current working directory */
  workDir: string;
  /** Project root directory */
  projectRoot: string;
  /** Platform-specific shell execution */
  shell: ShellExecutor;
  /** Configuration accessor */
  config: ConfigAccessor;
  /** Logger for plugin operations */
  logger: PluginLogger;
  /** Event bus for cross-plugin communication */
  events: EventBus;
  /** Memory/storage access */
  memory?: MemoryAccessor;
  /** Agent identity (Stanley, Zee, etc.) */
  agentId?: string;
}

/**
 * Shell executor interface (platform-agnostic)
 */
export interface ShellExecutor {
  (command: string, options?: ShellOptions): Promise<ShellResult>;
  cwd(path: string): ShellExecutor;
  env(vars: Record<string, string | undefined>): ShellExecutor;
  quiet(): ShellExecutor;
  nothrow(): ShellExecutor;
}

export interface ShellOptions {
  cwd?: string;
  env?: Record<string, string | undefined>;
  timeout?: number;
  quiet?: boolean;
  nothrow?: boolean;
}

export interface ShellResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/**
 * Configuration accessor for plugins
 */
export interface ConfigAccessor {
  get<T>(key: string): T | undefined;
  set<T>(key: string, value: T): void;
  has(key: string): boolean;
  getAll(): Record<string, unknown>;
}

/**
 * Plugin logger interface
 */
export interface PluginLogger {
  debug(message: string, data?: Record<string, unknown>): void;
  info(message: string, data?: Record<string, unknown>): void;
  warn(message: string, data?: Record<string, unknown>): void;
  error(message: string, data?: Record<string, unknown>): void;
}

/**
 * Event bus for plugin communication
 */
export interface EventBus {
  emit(event: string, data: unknown): void;
  on(event: string, handler: (data: unknown) => void | Promise<void>): () => void;
  once(event: string, handler: (data: unknown) => void | Promise<void>): () => void;
  off(event: string, handler: (data: unknown) => void | Promise<void>): void;
}

/**
 * Memory/storage accessor for plugins
 */
export interface MemoryAccessor {
  get<T>(key: string): Promise<T | undefined>;
  set<T>(key: string, value: T, ttl?: number): Promise<void>;
  delete(key: string): Promise<boolean>;
  search(pattern: string): Promise<Array<{ key: string; value: unknown }>>;
  namespace(ns: string): MemoryAccessor;
}

// =============================================================================
// Plugin Definition
// =============================================================================

/**
 * Plugin factory function type
 */
export type PluginFactory = (context: PluginContext) => Promise<PluginInstance>;

/**
 * Plugin instance returned by factory
 */
export interface PluginInstance {
  /** Plugin metadata */
  metadata?: PluginMetadata;
  /** Lifecycle hooks */
  lifecycle?: LifecycleHooks;
  /** Event hooks */
  hooks?: Hooks;
  /** Tool definitions */
  tools?: Record<string, ToolDefinition>;
  /** Auth providers */
  auth?: AuthProvider[];
}

/**
 * Lifecycle hooks for plugin management
 */
export interface LifecycleHooks {
  /** Called after plugin is loaded, before hooks are active */
  init?(): Promise<void>;
  /** Called when plugin is being unloaded */
  destroy?(): Promise<void>;
  /** Called when plugin should suspend (e.g., app backgrounded) */
  suspend?(): Promise<void>;
  /** Called when plugin should resume after suspend */
  resume?(): Promise<void>;
}

// =============================================================================
// Hook System
// =============================================================================

/**
 * Hook input/output pattern for transformations
 */
export type HookHandler<TInput, TOutput> = (
  input: TInput,
  output: TOutput
) => Promise<TOutput | void>;

/**
 * All available hooks in the system
 */
export interface Hooks {
  // -------------------------------------------------------------------------
  // Configuration Hooks
  // -------------------------------------------------------------------------
  /** Called when configuration is loaded */
  'config.loaded'?: HookHandler<{ source: string }, { config: Record<string, unknown> }>;
  /** Called before configuration is saved */
  'config.saving'?: HookHandler<{}, { config: Record<string, unknown> }>;

  // -------------------------------------------------------------------------
  // Session Hooks
  // -------------------------------------------------------------------------
  /** Called when a new session starts */
  'session.start'?: HookHandler<
    { sessionId: string; agentId?: string },
    { context: Record<string, unknown> }
  >;
  /** Called when a session ends */
  'session.end'?: HookHandler<
    { sessionId: string; duration: number },
    { summary?: string; metrics?: Record<string, number> }
  >;
  /** Called when session is restored from persistence */
  'session.restore'?: HookHandler<
    { sessionId: string },
    { context: Record<string, unknown> }
  >;

  // -------------------------------------------------------------------------
  // Task Hooks
  // -------------------------------------------------------------------------
  /** Called before task execution begins */
  'pre-task'?: HookHandler<
    { taskId: string; description: string; agentType?: string },
    { context: Record<string, unknown>; shouldProceed: boolean }
  >;
  /** Called after task execution completes */
  'post-task'?: HookHandler<
    { taskId: string; duration: number; success: boolean; error?: Error },
    { metrics?: Record<string, number>; memoryUpdates?: Record<string, unknown> }
  >;

  // -------------------------------------------------------------------------
  // File Edit Hooks
  // -------------------------------------------------------------------------
  /** Called before a file edit is applied */
  'pre-edit'?: HookHandler<
    { filePath: string; editType: 'create' | 'modify' | 'delete' },
    { shouldProceed: boolean; transformedContent?: string }
  >;
  /** Called after a file edit is applied */
  'post-edit'?: HookHandler<
    { filePath: string; editType: 'create' | 'modify' | 'delete'; success: boolean },
    { memoryKey?: string; notification?: string }
  >;

  // -------------------------------------------------------------------------
  // Chat/Message Hooks
  // -------------------------------------------------------------------------
  /** Called when a new user message is received */
  'chat.message'?: HookHandler<
    { sessionId: string; messageId?: string; agentId?: string },
    { message: UserMessage; parts: MessagePart[] }
  >;
  /** Called to modify LLM parameters before sending */
  'chat.params'?: HookHandler<
    { sessionId: string; agentId: string; model: ModelInfo },
    { temperature: number; topP: number; topK: number; options: Record<string, unknown> }
  >;
  /** Called when assistant response is received */
  'chat.response'?: HookHandler<
    { sessionId: string; messageId: string },
    { content: string; toolCalls?: ToolCall[] }
  >;

  // -------------------------------------------------------------------------
  // Tool Execution Hooks
  // -------------------------------------------------------------------------
  /** Called before a tool is executed */
  'tool.execute.before'?: HookHandler<
    { tool: string; sessionId: string; callId: string },
    { args: Record<string, unknown>; shouldProceed: boolean }
  >;
  /** Called after a tool is executed */
  'tool.execute.after'?: HookHandler<
    { tool: string; sessionId: string; callId: string; duration: number },
    { title: string; output: string; metadata?: Record<string, unknown> }
  >;

  // -------------------------------------------------------------------------
  // Permission Hooks
  // -------------------------------------------------------------------------
  /** Called when permission is requested */
  'permission.ask'?: HookHandler<
    { permission: Permission },
    { status: 'ask' | 'deny' | 'allow' }
  >;

  // -------------------------------------------------------------------------
  // Memory Hooks
  // -------------------------------------------------------------------------
  /** Called when memory is updated */
  'memory.update'?: HookHandler<
    { key: string; namespace?: string },
    { value: unknown; ttl?: number }
  >;
  /** Called when memory is retrieved */
  'memory.retrieve'?: HookHandler<
    { key: string; namespace?: string },
    { value: unknown }
  >;

  // -------------------------------------------------------------------------
  // Generic Event Hook
  // -------------------------------------------------------------------------
  /** Catch-all for system events */
  event?: (input: { event: SystemEvent }) => Promise<void>;
}

// =============================================================================
// Supporting Types
// =============================================================================

export interface UserMessage {
  role: 'user';
  content: string | MessagePart[];
}

export interface MessagePart {
  type: 'text' | 'image' | 'file' | 'tool_use' | 'tool_result';
  content?: string;
  data?: unknown;
}

export interface ModelInfo {
  providerId: string;
  modelId: string;
  displayName?: string;
}

export interface ToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export interface Permission {
  type: 'file' | 'shell' | 'network' | 'tool';
  action: string;
  resource?: string;
  metadata?: Record<string, unknown>;
}

export interface SystemEvent {
  type: string;
  timestamp: number;
  data: unknown;
}

// =============================================================================
// Tool Definition
// =============================================================================

/**
 * Tool context for execution
 */
export interface ToolContext {
  sessionId: string;
  messageId: string;
  agentId: string;
  abort: AbortSignal;
}

/**
 * Tool definition with schema validation
 */
export interface ToolDefinition<TArgs extends z.ZodRawShape = z.ZodRawShape> {
  /** Tool description for LLM */
  description: string;
  /** Zod schema for arguments */
  args: TArgs;
  /** Tool execution function */
  execute(args: z.infer<z.ZodObject<TArgs>>, context: ToolContext): Promise<string>;
}

/**
 * Helper function to create tool definitions
 */
export function defineTool<TArgs extends z.ZodRawShape>(
  definition: ToolDefinition<TArgs>
): ToolDefinition<TArgs> {
  return definition;
}

// Re-export zod for plugin authors
export { z as schema } from 'zod';

// =============================================================================
// Auth Provider
// =============================================================================

/**
 * Authentication provider for external services
 */
export interface AuthProvider {
  /** Provider identifier (e.g., 'anthropic', 'github-copilot') */
  provider: string;
  /** Display name */
  displayName?: string;
  /** Load existing auth credentials */
  loader?: (getAuth: () => Promise<AuthCredentials | undefined>) => Promise<Record<string, unknown>>;
  /** Available authentication methods */
  methods: AuthMethod[];
}

export type AuthMethod = OAuthMethod | ApiKeyMethod;

export interface OAuthMethod {
  type: 'oauth';
  label: string;
  prompts?: AuthPrompt[];
  authorize(inputs?: Record<string, string>): Promise<OAuthResult>;
}

export interface ApiKeyMethod {
  type: 'api';
  label: string;
  prompts?: AuthPrompt[];
  authorize?(inputs?: Record<string, string>): Promise<ApiKeyResult>;
}

export type AuthPrompt = TextPrompt | SelectPrompt;

export interface TextPrompt {
  type: 'text';
  key: string;
  message: string;
  placeholder?: string;
  validate?: (value: string) => string | undefined;
  condition?: (inputs: Record<string, string>) => boolean;
}

export interface SelectPrompt {
  type: 'select';
  key: string;
  message: string;
  options: Array<{ label: string; value: string; hint?: string }>;
  condition?: (inputs: Record<string, string>) => boolean;
}

export interface AuthCredentials {
  type: 'oauth' | 'api';
  provider: string;
  accessToken?: string;
  refreshToken?: string;
  apiKey?: string;
  expiresAt?: number;
  metadata?: Record<string, unknown>;
}

export type OAuthResult = {
  url: string;
  instructions: string;
} & (
  | {
      method: 'auto';
      callback(): Promise<OAuthSuccess | AuthFailure>;
    }
  | {
      method: 'code';
      callback(code: string): Promise<OAuthSuccess | AuthFailure>;
    }
);

export interface OAuthSuccess {
  type: 'success';
  provider?: string;
  access: string;
  refresh: string;
  expires: number;
}

export interface ApiKeyResult {
  type: 'success' | 'failed';
  key?: string;
  provider?: string;
}

export interface AuthFailure {
  type: 'failed';
  error?: string;
}

// =============================================================================
// Plugin Registration
// =============================================================================

/**
 * Plugin descriptor for registration
 */
export interface PluginDescriptor {
  /** Plugin source: npm package, file path, or inline */
  source: string;
  /** Whether plugin is enabled */
  enabled?: boolean;
  /** Plugin-specific configuration */
  config?: Record<string, unknown>;
}

/**
 * Plugin registration from configuration
 */
export const PluginDescriptorSchema = z.object({
  source: z.string(),
  enabled: z.boolean().optional().default(true),
  config: z.record(z.unknown()).optional(),
});

export type PluginDescriptorInput = z.input<typeof PluginDescriptorSchema>;
