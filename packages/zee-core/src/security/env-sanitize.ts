/**
 * Environment Variable Sanitization
 *
 * Prevents PATH injection and other environment-based attacks.
 * Based on Zee commit 771f23d36b (PATH injection prevention).
 *
 * The risk: If an attacker can control environment variables like PATH,
 * and those values contain shell metacharacters (e.g., $(command)),
 * the shell may execute arbitrary commands during variable expansion.
 *
 * The fix: Use internal environment variables that bypass shell expansion,
 * and sanitize user-controlled values before passing to child processes.
 *
 * @module security/env-sanitize
 */

/**
 * Characters that could trigger shell expansion or injection
 * Note: Backslash is excluded because it's used in Windows paths
 */
const SHELL_METACHARACTERS_PATTERN = /[$`|;&<>(){}[\]!#*?~'"]/

/**
 * Check if a string contains shell metacharacters that could cause injection
 */
export function containsShellMetacharacters(value: string): boolean {
  return SHELL_METACHARACTERS_PATTERN.test(value)
}

/**
 * Sanitize an environment variable value by removing shell metacharacters.
 * Use this for values that will be passed to shell processes.
 *
 * @param value - The value to sanitize
 * @returns Sanitized value with metacharacters removed
 */
export function sanitizeEnvValue(value: string): string {
  // Use global flag only for replacement, not for testing
  return value.replace(/[$`|;&<>(){}[\]!#*?~'"]/g, "")
}

/**
 * Validate that a PATH-like environment variable doesn't contain injection attempts.
 * PATH values should only contain directory paths separated by colons (Unix) or semicolons (Windows).
 *
 * @param value - The PATH value to validate
 * @returns true if safe, false if potentially dangerous
 */
export function isValidPathValue(value: string): boolean {
  // PATH should only contain:
  // - Alphanumeric characters
  // - Path separators: / (Unix), \ (Windows)
  // - Path list separator: : (Unix), ; (Windows)
  // - Dots, dashes, underscores (common in paths)
  // - Spaces (for paths with spaces)
  const validPathPattern = /^[a-zA-Z0-9\/\\:;.\-_ ]+$/
  return validPathPattern.test(value)
}

/**
 * Create a safe environment object for spawning child processes.
 * This filters out or sanitizes potentially dangerous environment variables.
 *
 * @param baseEnv - Base environment (defaults to process.env)
 * @param options - Options for environment handling
 * @returns Safe environment object
 */
export function createSafeEnv(
  baseEnv: NodeJS.ProcessEnv = process.env,
  options: {
    /** Additional paths to prepend to PATH (via internal variable) */
    prependPaths?: string[]
    /** Whether to validate PATH (default: true) */
    validatePath?: boolean
    /** Environment variables to explicitly allow through unchanged */
    allowlist?: string[]
    /** Environment variables to block entirely */
    blocklist?: string[]
  } = {},
): NodeJS.ProcessEnv {
  const { prependPaths = [], validatePath = true, allowlist = [], blocklist = [] } = options

  const result: NodeJS.ProcessEnv = {}
  const blockSet = new Set(blocklist.map((k) => k.toLowerCase()))
  const allowSet = new Set(allowlist.map((k) => k.toLowerCase()))

  for (const [key, value] of Object.entries(baseEnv)) {
    if (value === undefined) continue
    const keyLower = key.toLowerCase()

    // Skip blocked variables
    if (blockSet.has(keyLower)) continue

    // Allow whitelisted variables through unchanged
    if (allowSet.has(keyLower)) {
      result[key] = value
      continue
    }

    // Special handling for PATH
    if (keyLower === "path") {
      if (validatePath && !isValidPathValue(value)) {
        // If PATH contains potentially dangerous characters,
        // use a safe default instead
        result[key] = getDefaultPath()
        continue
      }
    }

    result[key] = value
  }

  // Use internal variable for prepended paths to avoid shell expansion
  // This bypasses shell variable expansion by not using $PATH directly
  if (prependPaths.length > 0) {
    const separator = process.platform === "win32" ? ";" : ":"
    const internalKey = "AGENT_CORE_PREPEND_PATH"
    result[internalKey] = prependPaths.join(separator)

    // Prepend to PATH if present
    if (result["PATH"]) {
      result["PATH"] = prependPaths.join(separator) + separator + result["PATH"]
    }
  }

  return result
}

/**
 * Get a safe default PATH value based on the platform
 */
function getDefaultPath(): string {
  if (process.platform === "win32") {
    return "C:\\Windows\\System32;C:\\Windows"
  }
  return "/usr/local/bin:/usr/bin:/bin"
}

/**
 * Check if an environment object is safe for shell execution.
 * Returns a list of warnings for potentially dangerous variables.
 *
 * @param env - Environment to check
 * @returns Array of warning messages (empty if safe)
 */
export function auditEnv(env: NodeJS.ProcessEnv): string[] {
  const warnings: string[] = []

  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) continue

    // Check for shell metacharacters in values
    if (containsShellMetacharacters(value)) {
      warnings.push(`${key} contains shell metacharacters: potential injection risk`)
    }

    // Check for common attack patterns
    if (value.includes("$(") || value.includes("`")) {
      warnings.push(`${key} contains command substitution: $(cmd) or \`cmd\``)
    }
  }

  return warnings
}
