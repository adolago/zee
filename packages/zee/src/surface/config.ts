/**
 * Surface Configuration
 *
 * Configuration options for surface behavior, permissions, and adaptations.
 */

import type { PermissionAction, PermissionType } from "./types.js"

const PATTERN_CACHE = new Map<string, RegExp>()

// =============================================================================
// Permission Configuration
// =============================================================================

/**
 * Permission policy for a specific permission type.
 */
export type PermissionPolicy = {
  /** Default action when no interactive prompt is available */
  defaultAction: PermissionAction
  /** Whether to require confirmation even for allowed actions */
  requireConfirmation: boolean
  /** Timeout in milliseconds before applying default (0 = no timeout) */
  timeoutMs: number
  /** Patterns that are always allowed (glob patterns for files, prefixes for commands) */
  allowPatterns?: string[]
  /** Patterns that are always denied */
  denyPatterns?: string[]
}

/**
 * Permission configuration for a surface.
 */
export type PermissionConfig = {
  /** Global default action for unknown permission types */
  globalDefault: PermissionAction
  /** Per-type permission policies */
  policies: Partial<Record<PermissionType, PermissionPolicy>>
  /** Remembered permissions from user responses */
  remembered: Map<string, PermissionAction>
}

/**
 * Default permission configuration.
 */
export const DEFAULT_PERMISSION_CONFIG: PermissionConfig = {
  globalDefault: "deny",
  policies: {
    file_read: {
      defaultAction: "allow",
      requireConfirmation: false,
      timeoutMs: 0,
      allowPatterns: ["**/*"],
      denyPatterns: ["**/.env*", "**/secrets*", "**/*.key", "**/*.pem"],
    },
    file_write: {
      defaultAction: "deny",
      requireConfirmation: true,
      timeoutMs: 30_000,
    },
    file_delete: {
      defaultAction: "deny",
      requireConfirmation: true,
      timeoutMs: 30_000,
    },
    execute_command: {
      defaultAction: "deny",
      requireConfirmation: true,
      timeoutMs: 30_000,
      denyPatterns: ["rm -rf *", "sudo *", "chmod 777 *"],
    },
    network_request: {
      defaultAction: "allow",
      requireConfirmation: false,
      timeoutMs: 0,
    },
    tool_execution: {
      defaultAction: "allow",
      requireConfirmation: false,
      timeoutMs: 0,
    },
    sensitive_data: {
      defaultAction: "deny",
      requireConfirmation: true,
      timeoutMs: 60_000,
    },
  },
  remembered: new Map(),
}

// =============================================================================
// Permission Merging Helpers
// =============================================================================

function mergePermissionPolicy(base: PermissionPolicy, overrides?: Partial<PermissionPolicy>): PermissionPolicy {
  if (!overrides) return base
  return {
    defaultAction: overrides.defaultAction ?? base.defaultAction,
    requireConfirmation: overrides.requireConfirmation ?? base.requireConfirmation,
    timeoutMs: overrides.timeoutMs ?? base.timeoutMs,
    allowPatterns: overrides.allowPatterns ?? base.allowPatterns,
    denyPatterns: overrides.denyPatterns ?? base.denyPatterns,
  }
}

export function mergePermissionConfig(
  base: PermissionConfig,
  ...overrides: Array<Partial<PermissionConfig> | undefined>
): PermissionConfig {
  const result: PermissionConfig = {
    globalDefault: base.globalDefault,
    policies: { ...base.policies },
    remembered: base.remembered,
  }

  for (const override of overrides) {
    if (!override) continue
    if (override.globalDefault !== undefined) result.globalDefault = override.globalDefault
    if (override.remembered) result.remembered = override.remembered
    if (override.policies) {
      for (const [key, value] of Object.entries(override.policies)) {
        if (!value) continue
        const policyKey = key as PermissionType
        const basePolicy = result.policies[policyKey]
        if (!basePolicy) {
          result.policies[policyKey] = value as PermissionPolicy
          continue
        }
        result.policies[policyKey] = mergePermissionPolicy(basePolicy, value as Partial<PermissionPolicy>)
      }
    }
  }

  return result
}

// =============================================================================
// Surface-Specific Configuration
// =============================================================================

/**
 * CLI/TUI surface configuration.
 */
export type CLISurfaceConfig = {
  /** Whether to use ANSI colors */
  colors: boolean
  /** Whether to show tool execution details */
  showToolDetails: boolean
  /** Whether to show streaming output */
  streamOutput: boolean
  /** Prompt style */
  promptStyle: "minimal" | "full" | "none"
  /** Key bindings for interactive actions */
  keyBindings: {
    abort: string
    accept: string
    deny: string
  }
  /** Permission overrides for CLI (more permissive by default) */
  permissions: Partial<PermissionConfig>
}

/**
 * Default CLI configuration.
 */
export const DEFAULT_CLI_CONFIG: CLISurfaceConfig = {
  colors: true,
  showToolDetails: true,
  streamOutput: true,
  promptStyle: "full",
  keyBindings: {
    abort: "Ctrl+C",
    accept: "y",
    deny: "n",
  },
  permissions: {
    policies: {
      file_write: {
        defaultAction: "allow",
        requireConfirmation: true,
        timeoutMs: 0, // Wait forever in CLI
      },
      execute_command: {
        defaultAction: "allow",
        requireConfirmation: true,
        timeoutMs: 0,
      },
    },
  },
}

export function resolveCLISurfaceConfig(overrides: Partial<CLISurfaceConfig> = {}): CLISurfaceConfig {
  return {
    ...DEFAULT_CLI_CONFIG,
    ...overrides,
    keyBindings: {
      ...DEFAULT_CLI_CONFIG.keyBindings,
      ...overrides.keyBindings,
    },
    permissions: mergePermissionConfig(
      DEFAULT_PERMISSION_CONFIG,
      DEFAULT_CLI_CONFIG.permissions,
      overrides.permissions,
    ),
  }
}

/**
 * Messaging surface configuration (WhatsApp/Telegram).
 */
export type MessagingSurfaceConfig = {
  /** Platform identifier */
  platform: "whatsapp" | "telegram"
  /** Whether to batch messages instead of streaming */
  batchMessages: boolean
  /** Maximum message length before splitting */
  maxMessageLength: number
  /** Message chunk delay in milliseconds */
  chunkDelayMs: number
  /** Whether to show typing indicators */
  showTyping: boolean
  /** Typing indicator interval in milliseconds */
  typingIntervalMs: number
  /** Minimum interval for live stream edit updates (ms) */
  streamEditIntervalMs: number
  /** Allowed senders (empty = all allowed) */
  allowedSenders: string[]
  /** Group-specific settings */
  groups: {
    /** Whether to respond in groups */
    enabled: boolean
    /** Whether to require mention to respond */
    requireMention: boolean
    /** Mention patterns */
    mentionPatterns: string[]
    /** Allowed groups (empty = all allowed) */
    allowedGroups: string[]
  }
  /** Permission overrides - messaging is more restrictive */
  permissions: Partial<PermissionConfig>
}

/**
 * Default messaging configuration.
 */
export const DEFAULT_MESSAGING_CONFIG: MessagingSurfaceConfig = {
  platform: "whatsapp",
  batchMessages: true,
  maxMessageLength: 4096,
  chunkDelayMs: 100,
  showTyping: true,
  typingIntervalMs: 5000,
  streamEditIntervalMs: 1000,
  allowedSenders: [],
  groups: {
    enabled: true,
    requireMention: true,
    mentionPatterns: [],
    allowedGroups: [],
  },
  permissions: {
    globalDefault: "deny",
    policies: {
      file_read: {
        defaultAction: "allow",
        requireConfirmation: false,
        timeoutMs: 0,
        denyPatterns: ["**/.env*", "**/secrets*", "**/*.key", "**/*.pem"],
      },
      file_write: {
        defaultAction: "deny",
        requireConfirmation: false, // No interactive prompts
        timeoutMs: 0,
      },
      file_delete: {
        defaultAction: "deny",
        requireConfirmation: false,
        timeoutMs: 0,
      },
      execute_command: {
        defaultAction: "deny",
        requireConfirmation: false,
        timeoutMs: 0,
      },
      tool_execution: {
        defaultAction: "allow",
        requireConfirmation: false,
        timeoutMs: 0,
      },
    },
  },
}

export function resolveMessagingSurfaceConfig(
  overrides: Partial<MessagingSurfaceConfig> = {},
  options?: { platform?: MessagingSurfaceConfig["platform"] },
): MessagingSurfaceConfig {
  const base: MessagingSurfaceConfig = {
    ...DEFAULT_MESSAGING_CONFIG,
    ...(options?.platform ? { platform: options.platform } : {}),
  }

  return {
    ...base,
    ...overrides,
    groups: {
      ...base.groups,
      ...overrides.groups,
    },
    permissions: mergePermissionConfig(DEFAULT_PERMISSION_CONFIG, base.permissions, overrides.permissions),
  }
}

// =============================================================================
// Unified Surface Configuration
// =============================================================================

/**
 * Complete surface configuration.
 */
export type SurfaceConfig = {
  /** Global permission configuration */
  permissions: PermissionConfig
  /** CLI-specific configuration */
  cli: CLISurfaceConfig
  /** Messaging platform configurations */
  messaging: {
    whatsapp?: MessagingSurfaceConfig
    telegram?: MessagingSurfaceConfig
  }
  /** Tool availability per surface */
  toolAvailability: Record<string, string[]>
  /** UX adaptations */
  ux: UXAdaptations
}

/**
 * UX adaptations for different surface types.
 */
export type UXAdaptations = {
  /** Streaming vs batching behavior */
  responseMode: "streaming" | "batched" | "auto"
  /** How to handle long responses */
  longResponseHandling: "chunk" | "truncate" | "file"
  /** Maximum response length before applying longResponseHandling */
  maxResponseLength: number
  /** Whether to include tool output in responses */
  includeToolOutput: boolean
  /** Whether to include thinking/reasoning in responses */
  includeThinking: boolean
  /** Response prefix (e.g., bot name) */
  responsePrefix?: string
  /** Response suffix */
  responseSuffix?: string
}

/**
 * Default UX adaptations.
 */
export const DEFAULT_UX_ADAPTATIONS: UXAdaptations = {
  responseMode: "auto",
  longResponseHandling: "chunk",
  maxResponseLength: 10_000,
  includeToolOutput: false,
  includeThinking: false,
}

/**
 * Build complete surface configuration with defaults.
 */
export function buildSurfaceConfig(overrides: Partial<SurfaceConfig> = {}): SurfaceConfig {
  return {
    permissions: mergePermissionConfig(DEFAULT_PERMISSION_CONFIG, overrides.permissions),
    cli: resolveCLISurfaceConfig(overrides.cli),
    messaging: {
      whatsapp: overrides.messaging?.whatsapp ? resolveMessagingSurfaceConfig(overrides.messaging.whatsapp) : undefined,
      telegram: overrides.messaging?.telegram
        ? resolveMessagingSurfaceConfig(overrides.messaging.telegram, { platform: "telegram" })
        : undefined,
    },
    toolAvailability: overrides.toolAvailability ?? {},
    ux: {
      ...DEFAULT_UX_ADAPTATIONS,
      ...overrides.ux,
    },
  }
}

// =============================================================================
// Permission Resolution
// =============================================================================

/**
 * Resolve the permission action for a given request.
 *
 * @param type - Permission type
 * @param resource - Resource being accessed (file path, command, etc.)
 * @param config - Permission configuration
 * @returns Resolved permission action
 */
export function resolvePermission(
  type: PermissionType,
  resource: string,
  config: PermissionConfig,
): { action: PermissionAction; requiresConfirmation: boolean; timeoutMs: number } {
  // Check remembered permissions first
  const rememberedKey = `${type}:${resource}`
  const remembered = config.remembered.get(rememberedKey)
  if (remembered) {
    return { action: remembered, requiresConfirmation: false, timeoutMs: 0 }
  }

  // Get type-specific policy
  const policy = config.policies[type]
  if (!policy) {
    return {
      action: config.globalDefault,
      requiresConfirmation: true,
      timeoutMs: 30_000,
    }
  }

  // Check deny patterns first (deny takes priority)
  if (policy.denyPatterns) {
    for (const pattern of policy.denyPatterns) {
      if (matchPattern(resource, pattern)) {
        return { action: "deny", requiresConfirmation: false, timeoutMs: 0 }
      }
    }
  }

  // Check allow patterns
  if (policy.allowPatterns) {
    for (const pattern of policy.allowPatterns) {
      if (matchPattern(resource, pattern)) {
        return {
          action: "allow",
          requiresConfirmation: policy.requireConfirmation,
          timeoutMs: policy.timeoutMs,
        }
      }
    }
  }

  return {
    action: policy.defaultAction,
    requiresConfirmation: policy.requireConfirmation,
    timeoutMs: policy.timeoutMs,
  }
}

/**
 * Simple glob-like pattern matching.
 */
function matchPattern(value: string, pattern: string): boolean {
  const normalizedValue = value.replace(/\\/g, "/")
  const normalizedPattern = pattern.replace(/\\/g, "/")

  let regex = PATTERN_CACHE.get(normalizedPattern)
  if (!regex) {
    // Convert glob to regex
    const escaped = normalizedPattern
      .replace(/[.+^${}()|[\]\\]/g, "\\$&")
      .replace(/\*\*/g, "<<<GLOBSTAR>>>")
      .replace(/\*/g, "[^/]*")
      .replace(/<<<GLOBSTAR>>>/g, ".*")
      .replace(/\?/g, ".")

    regex = new RegExp(`^${escaped}$`)
    PATTERN_CACHE.set(normalizedPattern, regex)
  }

  return regex.test(normalizedValue)
}
