// Flags for Zee (personal use configuration)
// Zee-only environment surface (no legacy aliases)

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

function env(key: string) {
  return process.env[key]
}

function computeFlags() {
  return {
    // Config paths
    ZEE_CONFIG: env("ZEE_CONFIG"),
    ZEE_CONFIG_DIR: env("ZEE_CONFIG_DIR"),
    ZEE_CONFIG_CONTENT: env("ZEE_CONFIG_CONTENT"),
    ZEE_GIT_BASH_PATH: env("ZEE_GIT_BASH_PATH"), // Windows

    // Permission override
    ZEE_PERMISSION: env("ZEE_PERMISSION"),

    // Auth (disabled by default, enable with ZEE_ENABLE_SERVER_AUTH=1)
    ZEE_SERVER_PASSWORD: env("ZEE_SERVER_PASSWORD"),
    ZEE_SERVER_USERNAME: env("ZEE_SERVER_USERNAME"),
    ZEE_ENABLE_SERVER_AUTH: truthy("ZEE_ENABLE_SERVER_AUTH"),
    ZEE_DISABLE_SERVER_AUTH: truthy("ZEE_DISABLE_SERVER_AUTH"),
    // Explicitly allow insecure server binds with auth disabled (dangerous).
    ZEE_ALLOW_INSECURE_SERVER_NO_AUTH: truthy("ZEE_ALLOW_INSECURE_SERVER_NO_AUTH"),
    // Allow using filesystem roots ("/", "C:\\") as the instance directory in server mode (dangerous).
    ZEE_SERVER_ALLOW_GLOBAL_DIRECTORY: truthy("ZEE_SERVER_ALLOW_GLOBAL_DIRECTORY"),
    // Allow HTTP callers to override PTY spawn command (dangerous, usually unnecessary).
    ZEE_PTY_ALLOW_COMMAND_OVERRIDE: truthy("ZEE_PTY_ALLOW_COMMAND_OVERRIDE"),
    // Allow switching sessions into RELEASE mode from messaging surfaces (dangerous).
    ZEE_ALLOW_MESSAGING_RELEASE: truthy("ZEE_ALLOW_MESSAGING_RELEASE"),

    // Server network tuning
    ZEE_SERVER_IDLE_TIMEOUT_SECONDS: number("ZEE_SERVER_IDLE_TIMEOUT_SECONDS"),
    ZEE_SERVER_MAX_SSE_CONNECTIONS: number("ZEE_SERVER_MAX_SSE_CONNECTIONS"),
    ZEE_SERVER_MAX_SSE_CONNECTIONS_PER_CLIENT: number("ZEE_SERVER_MAX_SSE_CONNECTIONS_PER_CLIENT"),
    ZEE_SERVER_MAX_INSTANCES: number("ZEE_SERVER_MAX_INSTANCES"),

    // Instance cache eviction (optional)
    ZEE_INSTANCE_CACHE_MAX_INSTANCES: number("ZEE_INSTANCE_CACHE_MAX_INSTANCES"),
    ZEE_INSTANCE_CACHE_TTL_SECONDS: number("ZEE_INSTANCE_CACHE_TTL_SECONDS"),

    // Tuning (optional overrides)
    ZEE_BASH_DEFAULT_TIMEOUT_MS: number("ZEE_BASH_DEFAULT_TIMEOUT_MS"),
    ZEE_LLM_STREAM_START_TIMEOUT_MS: number("ZEE_LLM_STREAM_START_TIMEOUT_MS"),
    ZEE_OUTPUT_TOKEN_MAX: number("ZEE_OUTPUT_TOKEN_MAX"),
    ZEE_BASH_MAX_OUTPUT_LENGTH: number("ZEE_BASH_MAX_OUTPUT_LENGTH"),

    // Opt-out flags
    ZEE_DISABLE_FILEWATCHER: truthy("ZEE_DISABLE_FILEWATCHER"),
    ZEE_DISABLE_COPY_ON_SELECT: truthy("ZEE_DISABLE_COPY_ON_SELECT"),
    ZEE_DISABLE_PROJECT_CONFIG: truthy("ZEE_DISABLE_PROJECT_CONFIG"),
    ZEE_DISABLE_FILETIME_CHECK: truthy("ZEE_DISABLE_FILETIME_CHECK"),

    // Stream health monitoring thresholds
    ZEE_STREAM_STALL_WARNING_MS: number("ZEE_STREAM_STALL_WARNING_MS"),
    ZEE_STREAM_STALL_TIMEOUT_MS: number("ZEE_STREAM_STALL_TIMEOUT_MS"),
    ZEE_STREAM_NO_CONTENT_TIMEOUT_MS: number("ZEE_STREAM_NO_CONTENT_TIMEOUT_MS"),
    ZEE_STREAM_DIAGNOSTICS: !truthy("ZEE_STREAM_DIAGNOSTICS_DISABLE"),

    // Client identifier
    ZEE_CLIENT: env("ZEE_CLIENT") ?? "cli",
    ZEE_SESSION_CONTROL: truthy("ZEE_SESSION_CONTROL"),

    // Models
    ZEE_MODELS_URL: env("ZEE_MODELS_URL"),
    ZEE_MODELS_PATH: env("ZEE_MODELS_PATH"),
    ZEE_DISABLE_MODELS_FETCH: truthy("ZEE_DISABLE_MODELS_FETCH"),

    // Testing
    ZEE_FAKE_VCS: env("ZEE_FAKE_VCS"),
  }
}

export const Flag = computeFlags()

export function reloadFlags() {
  Object.assign(Flag, computeFlags())
}
