/**
 * @file Privacy Patterns
 * @description Regex patterns for detecting and redacting sensitive data
 */

import type { RedactionPattern } from "../types";

/** API Key patterns */
export const API_KEY_PATTERNS: RedactionPattern[] = [
  {
    name: "anthropic-key",
    pattern: /sk-ant-[a-zA-Z0-9-_]{20,}/g,
    replacement: "[ANTHROPIC_KEY]",
  },
  {
    name: "openai-key",
    pattern: /sk-[a-zA-Z0-9]{32,}/g,
    replacement: "[OPENAI_KEY]",
  },
  {
    name: "google-key",
    pattern: /AIza[a-zA-Z0-9_-]{35}/g,
    replacement: "[GOOGLE_KEY]",
  },
  {
    name: "github-pat",
    pattern: /ghp_[a-zA-Z0-9]{36}/g,
    replacement: "[GITHUB_PAT]",
  },
  {
    name: "github-token",
    pattern: /ghs_[a-zA-Z0-9]{36}/g,
    replacement: "[GITHUB_TOKEN]",
  },
  {
    name: "bearer-token",
    pattern: /Bearer\s+[a-zA-Z0-9._-]{20,}/gi,
    replacement: "[BEARER_TOKEN]",
  },
  {
    name: "generic-api-key",
    pattern: /api[_-]?key["']?\s*[:=]\s*["']?[a-zA-Z0-9_-]{16,}/gi,
    replacement: "[API_KEY]",
  },
];

/** Credential patterns */
export const CREDENTIAL_PATTERNS: RedactionPattern[] = [
  {
    name: "password-field",
    pattern: /password["']?\s*[:=]\s*["'][^"']+["']/gi,
    replacement: 'password="[REDACTED]"',
  },
  {
    name: "connection-string",
    pattern: /(mongodb|postgres|mysql|redis):\/\/[^@]+@[^\s]+/gi,
    replacement: "[CONNECTION_STRING]",
  },
  {
    name: "private-key",
    pattern: /-----BEGIN\s+(RSA\s+)?PRIVATE\s+KEY-----[\s\S]+?-----END\s+(RSA\s+)?PRIVATE\s+KEY-----/g,
    replacement: "[PRIVATE_KEY]",
  },
  {
    name: "aws-access-key",
    pattern: /AKIA[0-9A-Z]{16}/g,
    replacement: "[AWS_ACCESS_KEY]",
  },
  {
    name: "aws-secret-key",
    pattern: /aws[_-]?secret[_-]?access[_-]?key["']?\s*[:=]\s*["']?[A-Za-z0-9/+=]{40}/gi,
    replacement: "[AWS_SECRET_KEY]",
  },
];

/** PII patterns */
export const PII_PATTERNS: RedactionPattern[] = [
  {
    name: "email",
    pattern: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
    replacement: "[EMAIL]",
  },
  {
    name: "phone",
    pattern: /(\+\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g,
    replacement: "[PHONE]",
  },
  {
    name: "ssn",
    pattern: /\d{3}[-.\s]?\d{2}[-.\s]?\d{4}/g,
    replacement: "[SSN]",
  },
  {
    name: "credit-card",
    pattern: /\d{4}[-.\s]?\d{4}[-.\s]?\d{4}[-.\s]?\d{4}/g,
    replacement: "[CREDIT_CARD]",
  },
  {
    name: "ip-address",
    pattern: /\b(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\b/g,
    replacement: "[IP_ADDRESS]",
  },
];

/** Path patterns for username redaction */
export const PATH_PATTERNS: RedactionPattern[] = [
  {
    name: "home-path-linux",
    pattern: /\/home\/[a-zA-Z0-9_-]+/g,
    replacement: "/home/[USER]",
  },
  {
    name: "home-path-windows",
    pattern: /C:\\Users\\[a-zA-Z0-9_-]+/gi,
    replacement: "C:\\Users\\[USER]",
  },
];

/**
 * Get patterns based on anonymization level
 */
export function getPatterns(level: "minimal" | "standard" | "aggressive"): RedactionPattern[] {
  switch (level) {
    case "minimal":
      // Only API keys
      return [...API_KEY_PATTERNS];

    case "standard":
      // API keys + credentials + paths
      return [...API_KEY_PATTERNS, ...CREDENTIAL_PATTERNS, ...PATH_PATTERNS];

    case "aggressive":
      // Everything including PII
      return [...API_KEY_PATTERNS, ...CREDENTIAL_PATTERNS, ...PII_PATTERNS, ...PATH_PATTERNS];

    default:
      return [...API_KEY_PATTERNS, ...CREDENTIAL_PATTERNS, ...PATH_PATTERNS];
  }
}
