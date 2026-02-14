export type SecurityRedactionConfig = {
  /**
   * When true, redact string values under high-risk paths (auth/credentials/tokens)
   * even if the leaf key does not look sensitive.
   */
  defaultDeny?: boolean;
  /**
   * Dot-path allowlist that bypasses redaction checks.
   * Supports exact entries and "*" wildcards.
   */
  allowlist?: string[];
  /**
   * Additional case-insensitive key/path patterns treated as sensitive.
   * Plain text snippets are supported.
   */
  nestedKeyMatchers?: string[];
};

export type UnicodeSanitizationMode = "reject" | "normalize";

export type SecurityUnicodeSanitizationConfig = {
  /** Enable extra Unicode homoglyph sanitization for untrusted content. */
  enabled?: boolean;
  /** Action to take when dangerous homoglyphs are detected. */
  mode?: UnicodeSanitizationMode;
  /** Optional class labels to control category rollout. */
  homoglyphClasses?: string[];
};

export type SecurityConfig = {
  redaction?: SecurityRedactionConfig;
  unicodeSanitization?: SecurityUnicodeSanitizationConfig;
};

