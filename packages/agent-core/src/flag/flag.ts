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

function computeFlags() {
  return {
    // ═══════════════════════════════════════════════════════════════════════
    // ESSENTIAL CONFIG (user can set via environment)
    // ═══════════════════════════════════════════════════════════════════════

    // Config paths
    OPENCODE_CONFIG: process.env["OPENCODE_CONFIG"],
    OPENCODE_CONFIG_DIR: process.env["OPENCODE_CONFIG_DIR"],
    OPENCODE_CONFIG_CONTENT: process.env["OPENCODE_CONFIG_CONTENT"],
    OPENCODE_GIT_BASH_PATH: process.env["OPENCODE_GIT_BASH_PATH"], // Windows

    // Permission override
    OPENCODE_PERMISSION: process.env["OPENCODE_PERMISSION"],

    // Auth (disabled by default, enable with AGENT_CORE_ENABLE_SERVER_AUTH=1)
    AGENT_CORE_SERVER_PASSWORD: process.env["AGENT_CORE_SERVER_PASSWORD"],
    AGENT_CORE_SERVER_USERNAME: process.env["AGENT_CORE_SERVER_USERNAME"],
    AGENT_CORE_ENABLE_SERVER_AUTH: truthy("AGENT_CORE_ENABLE_SERVER_AUTH"),
    AGENT_CORE_DISABLE_SERVER_AUTH: truthy("AGENT_CORE_DISABLE_SERVER_AUTH"),

    // Tuning (optional overrides)
    AGENT_CORE_BASH_DEFAULT_TIMEOUT_MS: number("AGENT_CORE_BASH_DEFAULT_TIMEOUT_MS"),
    AGENT_CORE_LLM_STREAM_START_TIMEOUT_MS: number("AGENT_CORE_LLM_STREAM_START_TIMEOUT_MS"),
    AGENT_CORE_OUTPUT_TOKEN_MAX: number("AGENT_CORE_OUTPUT_TOKEN_MAX"),
    AGENT_CORE_BASH_MAX_OUTPUT_LENGTH: number("AGENT_CORE_BASH_MAX_OUTPUT_LENGTH"),

    // Opt-out flags
    AGENT_CORE_DISABLE_FILEWATCHER: truthy("AGENT_CORE_DISABLE_FILEWATCHER"),
    AGENT_CORE_DISABLE_COPY_ON_SELECT: truthy("AGENT_CORE_DISABLE_COPY_ON_SELECT"),

    // Stream health monitoring thresholds
    AGENT_CORE_STREAM_STALL_WARNING_MS: number("AGENT_CORE_STREAM_STALL_WARNING_MS"),
    AGENT_CORE_STREAM_STALL_TIMEOUT_MS: number("AGENT_CORE_STREAM_STALL_TIMEOUT_MS"),
    AGENT_CORE_STREAM_NO_CONTENT_TIMEOUT_MS: number("AGENT_CORE_STREAM_NO_CONTENT_TIMEOUT_MS"),
    AGENT_CORE_STREAM_DIAGNOSTICS: !truthy("AGENT_CORE_STREAM_DIAGNOSTICS_DISABLE"),

    // Client identifier
    OPENCODE_CLIENT: process.env["OPENCODE_CLIENT"] ?? "cli",

    // Models
    AGENT_CORE_MODELS_URL: process.env["AGENT_CORE_MODELS_URL"] ?? process.env["OPENCODE_MODELS_URL"],
    AGENT_CORE_MODELS_PATH: process.env["AGENT_CORE_MODELS_PATH"] ?? process.env["OPENCODE_MODELS_PATH"],
    AGENT_CORE_DISABLE_MODELS_FETCH: truthy("AGENT_CORE_DISABLE_MODELS_FETCH") || truthy("OPENCODE_DISABLE_MODELS_FETCH"),

    // Testing
    OPENCODE_FAKE_VCS: process.env["OPENCODE_FAKE_VCS"],
  }
}

export const Flag = computeFlags()

export function reloadFlags() {
  Object.assign(Flag, computeFlags())
}

