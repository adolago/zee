/**
 * Safe Environment Variable Filtering
 *
 * Filters process.env to only include safe variables when passing to child processes.
 * Prevents accidental exposure of API keys and secrets.
 */

/**
 * Environment variables that should NEVER be passed to child processes
 */
const SENSITIVE_PATTERNS = [
  /^ANTHROPIC_/i,
  /^OPENAI_/i,
  /^GOOGLE_/i,
  /^AWS_/i,
  /^AZURE_/i,
  /^GITHUB_TOKEN$/i,
  /^GH_TOKEN$/i,
  /^NPM_TOKEN$/i,
  /^WHATSAPP_TOKEN$/i,
  /^TWILIO_/i,
  /^SENDGRID_/i,
  /^STRIPE_/i,
  /^PAYPAL_/i,
  /API_KEY$/i,
  /API_SECRET$/i,
  /SECRET_KEY$/i,
  /PRIVATE_KEY$/i,
  /ACCESS_TOKEN$/i,
  /REFRESH_TOKEN$/i,
  /^PASSWORD$/i,
  /^CREDENTIAL/i,
];

/**
 * Environment variables that are safe to pass (allowlist)
 */
const SAFE_VARS = new Set([
  // System paths
  "PATH",
  "HOME",
  "USER",
  "SHELL",
  "TERM",
  "LANG",
  "LC_ALL",
  "TZ",
  "TMPDIR",
  "XDG_CONFIG_HOME",
  "XDG_DATA_HOME",
  "XDG_CACHE_HOME",
  "XDG_RUNTIME_DIR",

  // Node.js
  "NODE_ENV",
  "NODE_OPTIONS",
  "NODE_PATH",

  // Python
  "PYTHONPATH",
  "PYTHONHOME",
  "VIRTUAL_ENV",

  // Display
  "DISPLAY",
  "WAYLAND_DISPLAY",

  // Editor/tools
  "EDITOR",
  "VISUAL",
  "PAGER",
  "LESS",
  "GIT_EDITOR",

  // zee specific (non-sensitive)
  "ZEE_URL",
  "ZEE_LOG_LEVEL",
  "ZEE_WEZTERM_ENABLED",
  "ZEE_DISABLE_TERMINAL_TITLE",
  // Persona repos (paths only, not credentials)
  "STANLEY_REPO",
  "JOHNY_REPO",
  "ZEE_REPO",
]);

/**
 * Check if an environment variable name is sensitive
 */
function isSensitive(name: string): boolean {
  return SENSITIVE_PATTERNS.some((pattern) => pattern.test(name));
}

/**
 * Filter environment variables for safe child process execution
 *
 * @param additionalSafe - Additional variable names to allow
 * @returns Filtered environment object
 */
export function getSafeEnv(additionalSafe: string[] = []): NodeJS.ProcessEnv {
  const allowed = new Set([...SAFE_VARS, ...additionalSafe]);
  const result: NodeJS.ProcessEnv = {};

  for (const [key, value] of Object.entries(process.env)) {
    if (allowed.has(key) && !isSensitive(key)) {
      result[key] = value;
    }
  }

  return result;
}

/**
 * Get environment with specific additions (merges safe env with explicit additions)
 *
 * @param additions - Explicit environment variables to add
 * @param additionalSafe - Additional safe variable names from process.env
 * @returns Merged environment object
 */
export function getSafeEnvWith(
  additions: Record<string, string>,
  additionalSafe: string[] = []
): NodeJS.ProcessEnv {
  return {
    ...getSafeEnv(additionalSafe),
    ...additions,
  };
}
