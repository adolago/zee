// Flags for agent-core (personal use configuration)
// Most features are hardcoded ON/OFF - only essential config is exposed

function truthy(key: string) {
  const value = process.env[key]?.toLowerCase()
  return value === "true" || value === "1"
}

function number(key: string) {
  const value = process.env[key]
  if (!value) return undefined
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined
}

function env(key: string, legacyKey?: string) {
  return process.env[key] ?? (legacyKey ? process.env[legacyKey] : undefined)
}

function truthyCompat(key: string, legacyKey?: string) {
  return truthy(key) || (legacyKey ? truthy(legacyKey) : false)
}

function numberCompat(key: string, legacyKey?: string) {
  return number(key) ?? (legacyKey ? number(legacyKey) : undefined)
}

function computeFlags() {
  return {
    // ═══════════════════════════════════════════════════════════════════════
    // ESSENTIAL CONFIG (user can set via environment)
    // All flags support OPENCODE_ prefix for backward compatibility
    // ═══════════════════════════════════════════════════════════════════════

    // Config paths
    AGENT_CORE_CONFIG: env("AGENT_CORE_CONFIG", "OPENCODE_CONFIG"),
    AGENT_CORE_CONFIG_DIR: env("AGENT_CORE_CONFIG_DIR", "OPENCODE_CONFIG_DIR"),
    AGENT_CORE_CONFIG_CONTENT: env("AGENT_CORE_CONFIG_CONTENT", "OPENCODE_CONFIG_CONTENT"),
    AGENT_CORE_GIT_BASH_PATH: env("AGENT_CORE_GIT_BASH_PATH", "OPENCODE_GIT_BASH_PATH"), // Windows

    // Permission override
    AGENT_CORE_PERMISSION: env("AGENT_CORE_PERMISSION", "OPENCODE_PERMISSION"),

    // Auth (disabled by default, enable with AGENT_CORE_ENABLE_SERVER_AUTH=1)
    AGENT_CORE_SERVER_PASSWORD: env("AGENT_CORE_SERVER_PASSWORD", "OPENCODE_SERVER_PASSWORD"),
    AGENT_CORE_SERVER_USERNAME: env("AGENT_CORE_SERVER_USERNAME", "OPENCODE_SERVER_USERNAME"),
    AGENT_CORE_ENABLE_SERVER_AUTH: truthyCompat("AGENT_CORE_ENABLE_SERVER_AUTH", "OPENCODE_ENABLE_SERVER_AUTH"),
    AGENT_CORE_DISABLE_SERVER_AUTH: truthyCompat("AGENT_CORE_DISABLE_SERVER_AUTH", "OPENCODE_DISABLE_SERVER_AUTH"),
    // Explicitly allow insecure server binds with auth disabled (dangerous).
    AGENT_CORE_ALLOW_INSECURE_SERVER_NO_AUTH: truthyCompat(
      "AGENT_CORE_ALLOW_INSECURE_SERVER_NO_AUTH",
      "OPENCODE_ALLOW_INSECURE_SERVER_NO_AUTH",
    ),
    // Allow using filesystem roots ("/", "C:\\") as the instance directory in server mode (dangerous).
    AGENT_CORE_SERVER_ALLOW_GLOBAL_DIRECTORY: truthyCompat(
      "AGENT_CORE_SERVER_ALLOW_GLOBAL_DIRECTORY",
      "OPENCODE_SERVER_ALLOW_GLOBAL_DIRECTORY",
    ),
    // Allow HTTP callers to override PTY spawn command (dangerous, usually unnecessary).
    AGENT_CORE_PTY_ALLOW_COMMAND_OVERRIDE: truthyCompat(
      "AGENT_CORE_PTY_ALLOW_COMMAND_OVERRIDE",
      "OPENCODE_PTY_ALLOW_COMMAND_OVERRIDE",
    ),
    // Allow switching sessions into RELEASE mode from messaging surfaces (dangerous).
    AGENT_CORE_ALLOW_MESSAGING_RELEASE: truthyCompat(
      "AGENT_CORE_ALLOW_MESSAGING_RELEASE",
      "OPENCODE_ALLOW_MESSAGING_RELEASE",
    ),

    // Server network tuning
    AGENT_CORE_SERVER_IDLE_TIMEOUT_SECONDS: numberCompat(
      "AGENT_CORE_SERVER_IDLE_TIMEOUT_SECONDS",
      "OPENCODE_SERVER_IDLE_TIMEOUT_SECONDS",
    ),
    AGENT_CORE_SERVER_MAX_SSE_CONNECTIONS: numberCompat(
      "AGENT_CORE_SERVER_MAX_SSE_CONNECTIONS",
      "OPENCODE_SERVER_MAX_SSE_CONNECTIONS",
    ),
    AGENT_CORE_SERVER_MAX_SSE_CONNECTIONS_PER_CLIENT: numberCompat(
      "AGENT_CORE_SERVER_MAX_SSE_CONNECTIONS_PER_CLIENT",
      "OPENCODE_SERVER_MAX_SSE_CONNECTIONS_PER_CLIENT",
    ),
    AGENT_CORE_SERVER_MAX_INSTANCES: numberCompat("AGENT_CORE_SERVER_MAX_INSTANCES", "OPENCODE_SERVER_MAX_INSTANCES"),

    // Instance cache eviction (optional)
    AGENT_CORE_INSTANCE_CACHE_MAX_INSTANCES: numberCompat(
      "AGENT_CORE_INSTANCE_CACHE_MAX_INSTANCES",
      "OPENCODE_INSTANCE_CACHE_MAX_INSTANCES",
    ),
    AGENT_CORE_INSTANCE_CACHE_TTL_SECONDS: numberCompat(
      "AGENT_CORE_INSTANCE_CACHE_TTL_SECONDS",
      "OPENCODE_INSTANCE_CACHE_TTL_SECONDS",
    ),

    // Tuning (optional overrides)
    AGENT_CORE_BASH_DEFAULT_TIMEOUT_MS: numberCompat(
      "AGENT_CORE_BASH_DEFAULT_TIMEOUT_MS",
      "OPENCODE_BASH_DEFAULT_TIMEOUT_MS",
    ),
    AGENT_CORE_LLM_STREAM_START_TIMEOUT_MS: numberCompat(
      "AGENT_CORE_LLM_STREAM_START_TIMEOUT_MS",
      "OPENCODE_LLM_STREAM_START_TIMEOUT_MS",
    ),
    AGENT_CORE_OUTPUT_TOKEN_MAX: numberCompat("AGENT_CORE_OUTPUT_TOKEN_MAX", "OPENCODE_OUTPUT_TOKEN_MAX"),
    AGENT_CORE_BASH_MAX_OUTPUT_LENGTH: numberCompat(
      "AGENT_CORE_BASH_MAX_OUTPUT_LENGTH",
      "OPENCODE_BASH_MAX_OUTPUT_LENGTH",
    ),

    // Opt-out flags
    AGENT_CORE_DISABLE_FILEWATCHER: truthyCompat("AGENT_CORE_DISABLE_FILEWATCHER", "OPENCODE_DISABLE_FILEWATCHER"),
    AGENT_CORE_DISABLE_COPY_ON_SELECT: truthyCompat(
      "AGENT_CORE_DISABLE_COPY_ON_SELECT",
      "OPENCODE_DISABLE_COPY_ON_SELECT",
    ),
    AGENT_CORE_DISABLE_PROJECT_CONFIG: truthyCompat(
      "AGENT_CORE_DISABLE_PROJECT_CONFIG",
      "OPENCODE_DISABLE_PROJECT_CONFIG",
    ),
    AGENT_CORE_DISABLE_FILETIME_CHECK: truthyCompat(
      "AGENT_CORE_DISABLE_FILETIME_CHECK",
      "OPENCODE_DISABLE_FILETIME_CHECK",
    ),

    // Stream health monitoring thresholds
    AGENT_CORE_STREAM_STALL_WARNING_MS: numberCompat(
      "AGENT_CORE_STREAM_STALL_WARNING_MS",
      "OPENCODE_STREAM_STALL_WARNING_MS",
    ),
    AGENT_CORE_STREAM_STALL_TIMEOUT_MS: numberCompat(
      "AGENT_CORE_STREAM_STALL_TIMEOUT_MS",
      "OPENCODE_STREAM_STALL_TIMEOUT_MS",
    ),
    AGENT_CORE_STREAM_NO_CONTENT_TIMEOUT_MS: numberCompat(
      "AGENT_CORE_STREAM_NO_CONTENT_TIMEOUT_MS",
      "OPENCODE_STREAM_NO_CONTENT_TIMEOUT_MS",
    ),
    AGENT_CORE_STREAM_DIAGNOSTICS: !truthyCompat(
      "AGENT_CORE_STREAM_DIAGNOSTICS_DISABLE",
      "OPENCODE_STREAM_DIAGNOSTICS_DISABLE",
    ),

    // Client identifier
    AGENT_CORE_CLIENT: env("AGENT_CORE_CLIENT", "OPENCODE_CLIENT") ?? "cli",

    // Models
    AGENT_CORE_MODELS_URL: env("AGENT_CORE_MODELS_URL", "OPENCODE_MODELS_URL"),
    AGENT_CORE_MODELS_PATH: env("AGENT_CORE_MODELS_PATH", "OPENCODE_MODELS_PATH"),
    AGENT_CORE_DISABLE_MODELS_FETCH: truthyCompat("AGENT_CORE_DISABLE_MODELS_FETCH", "OPENCODE_DISABLE_MODELS_FETCH"),

    // Testing
    AGENT_CORE_FAKE_VCS: env("AGENT_CORE_FAKE_VCS", "OPENCODE_FAKE_VCS"),
  }
}

export const Flag = computeFlags()

export function reloadFlags() {
  Object.assign(Flag, computeFlags())
}
