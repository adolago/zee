/**
 * Agent System Types
 *
 * Configurable agent personas with permission system and mode switching
 */

/** Permission level for agent actions */
export type PermissionLevel = "allow" | "ask" | "deny";

/** Agent execution mode */
export type AgentMode = "primary" | "subagent" | "all";

/** Agent permission configuration */
export interface AgentPermission {
  /** File editing permission */
  edit: PermissionLevel;

  /** Bash command permissions - pattern matched */
  bash: Record<string, PermissionLevel>;

  /** Skill/tool permissions - pattern matched */
  skill: Record<string, PermissionLevel>;

  /** Web fetch permission */
  webfetch?: PermissionLevel;

  /** Doom loop prevention permission */
  doomLoop?: PermissionLevel;

  /** Access to external directories */
  externalDirectory?: PermissionLevel;
}

/** Agent tool configuration */
export interface AgentToolConfig {
  /** Tool ID to enabled/disabled mapping */
  [toolId: string]: boolean;
}

/** Per-model sampling parameters, or null for locked params (e.g. GPT-5 series) */
export type ModelSamplingParams = {
  temperature?: number;
  topP?: number;
  topK?: number;
  frequencyPenalty?: number;
  presencePenalty?: number;
} | null;

/** Map of model family pattern to sampling params */
export type ModelParamsMap = Record<string, ModelSamplingParams>;

/** Agent configuration */
export interface AgentConfig {
  /** Unique agent identifier */
  name: string;

  /** Human-readable description */
  description?: string;

  /** Agent execution mode */
  mode: AgentMode;

  /** Whether this is a built-in agent */
  native?: boolean;

  /** Whether to hide from user selection */
  hidden?: boolean;

  /** Whether this is the default agent */
  default?: boolean;

  /** Model temperature (0-1) */
  temperature?: number;

  /** Top-p sampling parameter */
  topP?: number;

  /** Per-model sampling overrides keyed by model family pattern */
  modelParams?: ModelParamsMap;

  /** Display color (hex or named) */
  color?: string;

  /** Permission configuration */
  permission: AgentPermission;

  /** Override model for this agent */
  model?: {
    providerId: string;
    modelId: string;
  };

  /** Custom system prompt */
  prompt?: string;

  /** Tool enablement configuration */
  tools: AgentToolConfig;

  /** Additional model options */
  options: Record<string, unknown>;

  /** Maximum inference steps */
  maxSteps?: number;
}

/** UI theme colors for persona */
export interface PersonaTheme {
  /** Primary color (hex) */
  primaryColor: string;
  /** Accent color for highlights (hex) */
  accentColor: string;
  /** Border color with alpha (rgba string) */
  borderColor: string;
  /** Background gradient (CSS gradient string) */
  bgGradient: string;
}

/** Agent persona for identity management */
export interface AgentPersona {
  /** Display name (e.g., "Zee", "Stanley") */
  displayName: string;

  /** Short identifier */
  id: string;

  /** Avatar/icon URL or emoji */
  avatar?: string;

  /** Single character icon for compact displays */
  icon?: string;

  /** Personality traits for system prompt */
  personality?: string[];

  /** Default greeting */
  greeting?: string;

  /** Signature for messages */
  signature?: string;

  /** UI theme colors */
  theme?: PersonaTheme;

  /** Default session key */
  defaultSession?: string;

  /** Short description */
  description?: string;
}

/** Agent instance at runtime */
export interface AgentInstance {
  /** Agent configuration */
  config: AgentConfig;

  /** Agent persona */
  persona: AgentPersona;

  /** Current session ID */
  sessionId: string;

  /** Current message ID */
  messageId?: string;

  /** Provider and model being used */
  model: {
    providerId: string;
    modelId: string;
  };

  /** Tools available to this agent */
  tools: string[];

  /** Parent agent if this is a subagent */
  parentAgent?: AgentInstance;
}

/** Agent registry interface */
export interface AgentRegistry {
  /** Get agent by name */
  get(name: string): Promise<AgentConfig | undefined>;

  /** List all agents */
  list(): Promise<AgentConfig[]>;

  /** Get the default agent name */
  defaultAgent(): Promise<string>;

  /** Register a custom agent */
  register(config: AgentConfig): Promise<void>;

  /** Generate agent from description using AI */
  generate(input: {
    description: string;
    model?: { providerId: string; modelId: string };
  }): Promise<{
    identifier: string;
    whenToUse: string;
    systemPrompt: string;
  }>;
}

/** Permission request for user approval */
export interface PermissionRequest {
  id: string;
  type: string;
  pattern?: string | string[];
  sessionId: string;
  messageId: string;
  callId?: string;
  title: string;
  metadata: Record<string, unknown>;
  createdAt: number;
}

/** Permission response from user */
export type PermissionResponse = "once" | "always" | "reject";

/** Permission manager interface */
export interface PermissionManager {
  /** Request permission for an action */
  ask(input: {
    type: string;
    title: string;
    pattern?: string | string[];
    callId?: string;
    sessionId: string;
    messageId: string;
    metadata: Record<string, unknown>;
  }): Promise<void>;

  /** Respond to a permission request */
  respond(input: {
    sessionId: string;
    permissionId: string;
    response: PermissionResponse;
  }): void;

  /** Get pending permission requests */
  pending(): Record<string, Record<string, PermissionRequest>>;
}
