// Flags for Zee (personal use configuration)
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

function env(key: string, legacyKey?: string, legacyKey2?: string) {
  return process.env[key] ?? (legacyKey ? process.env[legacyKey] : undefined) ?? (legacyKey2 ? process.env[legacyKey2] : undefined)
}

function truthyCompat(key: string, legacyKey?: string, legacyKey2?: string) {
  return truthy(key) || (legacyKey ? truthy(legacyKey) : false) || (legacyKey2 ? truthy(legacyKey2) : false)
}

function numberCompat(key: string, legacyKey?: string, legacyKey2?: string) {
  return number(key) ?? (legacyKey ? number(legacyKey) : undefined) ?? (legacyKey2 ? number(legacyKey2) : undefined)
}

function computeFlags() {
  return {
    // ═══════════════════════════════════════════════════════════════════════
    // ESSENTIAL CONFIG (user can set via environment)
    // All flags support AGENT_CORE_ and OPENCODE_ prefixes for backward compatibility
    // ═══════════════════════════════════════════════════════════════════════

    // Config paths
    ZEE_CONFIG: env("ZEE_CONFIG", "AGENT_CORE_CONFIG", "OPENCODE_CONFIG"),
    ZEE_CONFIG_DIR: env("ZEE_CONFIG_DIR", "AGENT_CORE_CONFIG_DIR", "OPENCODE_CONFIG_DIR"),
    ZEE_CONFIG_CONTENT: env("ZEE_CONFIG_CONTENT", "AGENT_CORE_CONFIG_CONTENT", "OPENCODE_CONFIG_CONTENT"),
    ZEE_GIT_BASH_PATH: env("ZEE_GIT_BASH_PATH", "AGENT_CORE_GIT_BASH_PATH", "OPENCODE_GIT_BASH_PATH"), // Windows

    // Permission override
    ZEE_PERMISSION: env("ZEE_PERMISSION", "AGENT_CORE_PERMISSION", "OPENCODE_PERMISSION"),

    // Auth (disabled by default, enable with ZEE_ENABLE_SERVER_AUTH=1)
    ZEE_SERVER_PASSWORD: env("ZEE_SERVER_PASSWORD", "AGENT_CORE_SERVER_PASSWORD", "OPENCODE_SERVER_PASSWORD"),
    ZEE_SERVER_USERNAME: env("ZEE_SERVER_USERNAME", "AGENT_CORE_SERVER_USERNAME", "OPENCODE_SERVER_USERNAME"),
    ZEE_ENABLE_SERVER_AUTH: truthyCompat("ZEE_ENABLE_SERVER_AUTH", "AGENT_CORE_ENABLE_SERVER_AUTH", "OPENCODE_ENABLE_SERVER_AUTH"),
    ZEE_DISABLE_SERVER_AUTH: truthyCompat("ZEE_DISABLE_SERVER_AUTH", "AGENT_CORE_DISABLE_SERVER_AUTH", "OPENCODE_DISABLE_SERVER_AUTH"),
    // Explicitly allow insecure server binds with auth disabled (dangerous).
    ZEE_ALLOW_INSECURE_SERVER_NO_AUTH: truthyCompat(
      "ZEE_ALLOW_INSECURE_SERVER_NO_AUTH",
      "AGENT_CORE_ALLOW_INSECURE_SERVER_NO_AUTH",
      "OPENCODE_ALLOW_INSECURE_SERVER_NO_AUTH",
    ),
    // Allow using filesystem roots ("/", "C:\\") as the instance directory in server mode (dangerous).
    ZEE_SERVER_ALLOW_GLOBAL_DIRECTORY: truthyCompat(
      "ZEE_SERVER_ALLOW_GLOBAL_DIRECTORY",
      "AGENT_CORE_SERVER_ALLOW_GLOBAL_DIRECTORY",
      "OPENCODE_SERVER_ALLOW_GLOBAL_DIRECTORY",
    ),
    // Allow HTTP callers to override PTY spawn command (dangerous, usually unnecessary).
    ZEE_PTY_ALLOW_COMMAND_OVERRIDE: truthyCompat(
      "ZEE_PTY_ALLOW_COMMAND_OVERRIDE",
      "AGENT_CORE_PTY_ALLOW_COMMAND_OVERRIDE",
      "OPENCODE_PTY_ALLOW_COMMAND_OVERRIDE",
    ),
    // Allow switching sessions into RELEASE mode from messaging surfaces (dangerous).
    ZEE_ALLOW_MESSAGING_RELEASE: truthyCompat(
      "ZEE_ALLOW_MESSAGING_RELEASE",
      "AGENT_CORE_ALLOW_MESSAGING_RELEASE",
      "OPENCODE_ALLOW_MESSAGING_RELEASE",
    ),

    // Server network tuning
    ZEE_SERVER_IDLE_TIMEOUT_SECONDS: numberCompat(
      "ZEE_SERVER_IDLE_TIMEOUT_SECONDS",
      "AGENT_CORE_SERVER_IDLE_TIMEOUT_SECONDS",
      "OPENCODE_SERVER_IDLE_TIMEOUT_SECONDS",
    ),
    ZEE_SERVER_MAX_SSE_CONNECTIONS: numberCompat(
      "ZEE_SERVER_MAX_SSE_CONNECTIONS",
      "AGENT_CORE_SERVER_MAX_SSE_CONNECTIONS",
      "OPENCODE_SERVER_MAX_SSE_CONNECTIONS",
    ),
    ZEE_SERVER_MAX_SSE_CONNECTIONS_PER_CLIENT: numberCompat(
      "ZEE_SERVER_MAX_SSE_CONNECTIONS_PER_CLIENT",
      "AGENT_CORE_SERVER_MAX_SSE_CONNECTIONS_PER_CLIENT",
      "OPENCODE_SERVER_MAX_SSE_CONNECTIONS_PER_CLIENT",
    ),
    ZEE_SERVER_MAX_INSTANCES: numberCompat(
      "ZEE_SERVER_MAX_INSTANCES",
      "AGENT_CORE_SERVER_MAX_INSTANCES",
      "OPENCODE_SERVER_MAX_INSTANCES",
    ),

    // Instance cache eviction (optional)
    ZEE_INSTANCE_CACHE_MAX_INSTANCES: numberCompat(
      "ZEE_INSTANCE_CACHE_MAX_INSTANCES",
      "AGENT_CORE_INSTANCE_CACHE_MAX_INSTANCES",
      "OPENCODE_INSTANCE_CACHE_MAX_INSTANCES",
    ),
    ZEE_INSTANCE_CACHE_TTL_SECONDS: numberCompat(
      "ZEE_INSTANCE_CACHE_TTL_SECONDS",
      "AGENT_CORE_INSTANCE_CACHE_TTL_SECONDS",
      "OPENCODE_INSTANCE_CACHE_TTL_SECONDS",
    ),

    // Tuning (optional overrides)
    ZEE_BASH_DEFAULT_TIMEOUT_MS: numberCompat(
      "ZEE_BASH_DEFAULT_TIMEOUT_MS",
      "AGENT_CORE_BASH_DEFAULT_TIMEOUT_MS",
      "OPENCODE_BASH_DEFAULT_TIMEOUT_MS",
    ),
    ZEE_LLM_STREAM_START_TIMEOUT_MS: numberCompat(
      "ZEE_LLM_STREAM_START_TIMEOUT_MS",
      "AGENT_CORE_LLM_STREAM_START_TIMEOUT_MS",
      "OPENCODE_LLM_STREAM_START_TIMEOUT_MS",
    ),
    ZEE_OUTPUT_TOKEN_MAX: numberCompat("ZEE_OUTPUT_TOKEN_MAX", "AGENT_CORE_OUTPUT_TOKEN_MAX", "OPENCODE_OUTPUT_TOKEN_MAX"),
    ZEE_BASH_MAX_OUTPUT_LENGTH: numberCompat(
      "ZEE_BASH_MAX_OUTPUT_LENGTH",
      "AGENT_CORE_BASH_MAX_OUTPUT_LENGTH",
      "OPENCODE_BASH_MAX_OUTPUT_LENGTH",
    ),

    // Opt-out flags
    ZEE_DISABLE_FILEWATCHER: truthyCompat("ZEE_DISABLE_FILEWATCHER", "AGENT_CORE_DISABLE_FILEWATCHER", "OPENCODE_DISABLE_FILEWATCHER"),
    ZEE_DISABLE_COPY_ON_SELECT: truthyCompat(
      "ZEE_DISABLE_COPY_ON_SELECT",
      "AGENT_CORE_DISABLE_COPY_ON_SELECT",
      "OPENCODE_DISABLE_COPY_ON_SELECT",
    ),
    ZEE_DISABLE_PROJECT_CONFIG: truthyCompat(
      "ZEE_DISABLE_PROJECT_CONFIG",
      "AGENT_CORE_DISABLE_PROJECT_CONFIG",
      "OPENCODE_DISABLE_PROJECT_CONFIG",
    ),
    ZEE_DISABLE_FILETIME_CHECK: truthyCompat(
      "ZEE_DISABLE_FILETIME_CHECK",
      "AGENT_CORE_DISABLE_FILETIME_CHECK",
      "OPENCODE_DISABLE_FILETIME_CHECK",
    ),

    // Stream health monitoring thresholds
    ZEE_STREAM_STALL_WARNING_MS: numberCompat(
      "ZEE_STREAM_STALL_WARNING_MS",
      "AGENT_CORE_STREAM_STALL_WARNING_MS",
      "OPENCODE_STREAM_STALL_WARNING_MS",
    ),
    ZEE_STREAM_STALL_TIMEOUT_MS: numberCompat(
      "ZEE_STREAM_STALL_TIMEOUT_MS",
      "AGENT_CORE_STREAM_STALL_TIMEOUT_MS",
      "OPENCODE_STREAM_STALL_TIMEOUT_MS",
    ),
    ZEE_STREAM_NO_CONTENT_TIMEOUT_MS: numberCompat(
      "ZEE_STREAM_NO_CONTENT_TIMEOUT_MS",
      "AGENT_CORE_STREAM_NO_CONTENT_TIMEOUT_MS",
      "OPENCODE_STREAM_NO_CONTENT_TIMEOUT_MS",
    ),
    ZEE_STREAM_DIAGNOSTICS: !truthyCompat(
      "ZEE_STREAM_DIAGNOSTICS_DISABLE",
      "AGENT_CORE_STREAM_DIAGNOSTICS_DISABLE",
      "OPENCODE_STREAM_DIAGNOSTICS_DISABLE",
    ),

    // Client identifier
    ZEE_CLIENT: env("ZEE_CLIENT", "AGENT_CORE_CLIENT", "OPENCODE_CLIENT") ?? "cli",

    // Models
    ZEE_MODELS_URL: env("ZEE_MODELS_URL", "AGENT_CORE_MODELS_URL", "OPENCODE_MODELS_URL"),
    ZEE_MODELS_PATH: env("ZEE_MODELS_PATH", "AGENT_CORE_MODELS_PATH", "OPENCODE_MODELS_PATH"),
    ZEE_DISABLE_MODELS_FETCH: truthyCompat("ZEE_DISABLE_MODELS_FETCH", "AGENT_CORE_DISABLE_MODELS_FETCH", "OPENCODE_DISABLE_MODELS_FETCH"),

    // Testing
    ZEE_FAKE_VCS: env("ZEE_FAKE_VCS", "AGENT_CORE_FAKE_VCS", "OPENCODE_FAKE_VCS"),
  }
}

export const Flag = computeFlags()

export function reloadFlags() {
  Object.assign(Flag, computeFlags())
}
