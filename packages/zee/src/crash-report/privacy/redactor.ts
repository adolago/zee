/**
 * @file Privacy Redactor
 * @description Redacts sensitive data from text and objects
 */

import { createHash } from "crypto";
import { getPatterns } from "./patterns";
import type { RedactionPattern, RedactionStats } from "../types";

export class PrivacyRedactor {
  private patterns: RedactionPattern[];
  private stats: RedactionStats;

  constructor(level: "minimal" | "standard" | "aggressive" = "standard") {
    this.patterns = getPatterns(level);
    this.stats = {
      totalRedactions: 0,
      byPattern: {},
    };
  }

  /**
   * Redact sensitive data from text
   */
  redact(text: string): string {
    let result = text;

    for (const pattern of this.patterns) {
      const matches = result.match(pattern.pattern);
      if (matches) {
        const count = matches.length;
        this.stats.totalRedactions += count;
        this.stats.byPattern[pattern.name] = (this.stats.byPattern[pattern.name] || 0) + count;
        
        // Reset regex lastIndex for global patterns
        pattern.pattern.lastIndex = 0;
        result = result.replace(pattern.pattern, pattern.replacement);
      }
    }

    return result;
  }

  /**
   * Redact sensitive data from an object (deep)
   */
  redactObject<T extends Record<string, unknown>>(obj: T): T {
    const result: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(obj)) {
      if (typeof value === "string") {
        result[key] = this.redact(value);
      } else if (Array.isArray(value)) {
        result[key] = value.map((item) =>
          typeof item === "string"
            ? this.redact(item)
            : typeof item === "object" && item !== null
              ? this.redactObject(item as Record<string, unknown>)
              : item
        );
      } else if (typeof value === "object" && value !== null) {
        result[key] = this.redactObject(value as Record<string, unknown>);
      } else {
        result[key] = value;
      }
    }

    return result as T;
  }

  /**
   * Create a hash of content (for message deduplication without showing content)
   */
  hashContent(content: string): string {
    return createHash("sha256").update(content).digest("hex").slice(0, 16);
  }

  /**
   * Create a preview of content with truncation
   */
  createPreview(content: string, maxLength: number = 100): string {
    const redacted = this.redact(content);
    if (redacted.length <= maxLength) {
      return redacted;
    }
    return redacted.slice(0, maxLength - 3) + "...";
  }

  /**
   * Redact environment variables (keep names, hide values)
   */
  redactEnvVars(env: Record<string, string | undefined>): Record<string, string> {
    const sensitiveKeys = [
      "KEY", "SECRET", "TOKEN", "PASSWORD", "CREDENTIAL", "AUTH", "API",
    ];

    const result: Record<string, string> = {};

    for (const [key, value] of Object.entries(env)) {
      if (!value) continue;

      const isSensitive = sensitiveKeys.some((s) => key.toUpperCase().includes(s));
      result[key] = isSensitive ? "[SET]" : this.redact(value);
    }

    return result;
  }

  /**
   * Check if text contains any sensitive patterns
   */
  containsSensitiveData(text: string): boolean {
    for (const pattern of this.patterns) {
      pattern.pattern.lastIndex = 0;
      if (pattern.pattern.test(text)) {
        pattern.pattern.lastIndex = 0;
        return true;
      }
    }
    return false;
  }

  /**
   * Get redaction statistics
   */
  getStats(): RedactionStats {
    return { ...this.stats };
  }

  /**
   * Reset statistics
   */
  resetStats(): void {
    this.stats = {
      totalRedactions: 0,
      byPattern: {},
    };
  }
}
