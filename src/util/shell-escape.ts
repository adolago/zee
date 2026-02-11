/**
 * Shell Escape Utilities
 *
 * Provides safe escaping for shell commands and terminal output.
 * Prevents command injection and escape sequence attacks.
 */

/**
 * Valid persona identifiers - whitelist for validation
 */
export const VALID_PERSONAS = ["zee"] as const;
export type PersonaId = (typeof VALID_PERSONAS)[number];

/**
 * Check if a string is a valid persona ID
 */
export function isValidPersona(persona: string): persona is PersonaId {
  return VALID_PERSONAS.includes(persona as PersonaId);
}

/**
 * Validate and sanitize a persona parameter
 * Throws if invalid to prevent injection
 */
export function validatePersona(persona: string | undefined): PersonaId | undefined {
  if (persona === undefined) return undefined;
  const normalized = persona.toLowerCase().trim();
  if (!isValidPersona(normalized)) {
    throw new Error(
      `Invalid persona: "${persona}". Valid personas: ${VALID_PERSONAS.join(", ")}`
    );
  }
  return normalized;
}

/**
 * Escape a string for use in single-quoted shell arguments
 *
 * Single quotes in shell preserve all characters literally except
 * single quotes themselves. We escape ' as '\'' (end quote, escaped quote, start quote).
 */
export function escapeShellArg(arg: string): string {
  // Replace single quotes with '\'' (end quote, literal quote, start quote)
  return arg.replace(/'/g, "'\\''");
}

/**
 * Escape a string for use in double-quoted shell arguments
 *
 * In double quotes, $, `, \, ", and ! need escaping.
 */
export function escapeDoubleQuoted(arg: string): string {
  return arg
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\$/g, "\\$")
    .replace(/`/g, "\\`")
    .replace(/!/g, "\\!");
}

/**
 * Strip ANSI escape sequences and control characters from a string
 *
 * This prevents terminal escape sequence injection when displaying
 * user-controlled content in a terminal.
 */
export function stripControlChars(text: string): string {
  // Remove ANSI escape sequences: ESC[ ... (ending with letter)
  // Also remove ESC ] ... ESC \ (OSC sequences for titles etc)
  // And raw control characters (except newline/tab)
  return text
    // ANSI CSI sequences: ESC [ ... letter
    .replace(/\x1b\[[0-9;]*[A-Za-z]/g, "")
    // OSC sequences: ESC ] ... (ST or BEL)
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, "")
    // Single-character escape sequences
    .replace(/\x1b[NOPXcn]/g, "")
    // Raw control characters (keep \n \t \r)
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, "");
}

/**
 * Sanitize text for safe terminal display
 *
 * Removes control characters while preserving printable content.
 * Use this for user-controlled content before sending to terminal.
 */
export function sanitizeForTerminal(text: string): string {
  return stripControlChars(text);
}

/**
 * Escape text for use in WezTerm send-text with single quotes
 *
 * WezTerm's send-text with --no-paste sends text literally,
 * but we still need to escape for the shell command itself.
 */
export function escapeForWezterm(text: string): string {
  // Strip any escape sequences from the content itself
  const sanitized = stripControlChars(text);
  // Escape for single-quoted shell argument
  return escapeShellArg(sanitized);
}

/**
 * Escape text for safe display with echo (without -e flag)
 *
 * Returns the text escaped for use with plain echo, which doesn't
 * interpret backslash sequences.
 */
export function escapeForEcho(text: string): string {
  // For plain echo, we just need to handle quotes
  // No backslash interpretation without -e
  return escapeDoubleQuoted(stripControlChars(text));
}

/**
 * Build a safe WezTerm send-text command
 *
 * Uses single quotes to avoid shell interpretation.
 */
export function buildWeztermSendText(paneId: string, text: string): string {
  // Validate paneId is numeric (WezTerm pane IDs are integers)
  if (!/^\d+$/.test(paneId)) {
    throw new Error(`Invalid pane ID: ${paneId}`);
  }
  const escaped = escapeForWezterm(text);
  return `wezterm cli send-text --pane-id ${paneId} --no-paste '${escaped}'`;
}

/**
 * Build a safe WezTerm pane title command
 *
 * Sets pane title using WezTerm CLI directly (if available)
 * or via escape sequence with sanitized title.
 */
export function buildPaneTitleCommand(paneId: string, title: string): string {
  // Validate paneId
  if (!/^\d+$/.test(paneId)) {
    throw new Error(`Invalid pane ID: ${paneId}`);
  }
  // Sanitize title - remove any escape sequences
  const sanitizedTitle = stripControlChars(title);
  // Use WezTerm's built-in title escape sequence
  // \033]0;title\007 is the OSC sequence for setting title
  // We need to double-escape for shell
  const escapeSequence = `\\033]0;${escapeShellArg(sanitizedTitle)}\\007`;
  return `wezterm cli send-text --pane-id ${paneId} --no-paste $'${escapeSequence}'`;
}

/**
 * Redact sensitive values from a string
 *
 * Replaces tokens, keys, and secrets with [REDACTED]
 */
export function redactSecrets(text: string): string {
  // Common token patterns
  const patterns = [
    // GitHub tokens
    /gh[pousr]_[A-Za-z0-9_]{36,}/g,
    // Bearer tokens in Authorization headers
    /Bearer\s+[A-Za-z0-9\-._~+\/]+=*/gi,
    // Generic API keys (32+ chars of alphanumeric)
    /(?:api[_-]?key|token|secret|password|credential)[=:]\s*['"]?[A-Za-z0-9\-._~+\/]{32,}['"]?/gi,
    // AWS-style keys
    /AKIA[A-Z0-9]{16}/g,
    // Generic long alphanumeric strings that look like secrets (64+ chars)
    /[A-Za-z0-9\-._~+\/]{64,}/g,
  ];

  let result = text;
  for (const pattern of patterns) {
    result = result.replace(pattern, "[REDACTED]");
  }
  return result;
}
