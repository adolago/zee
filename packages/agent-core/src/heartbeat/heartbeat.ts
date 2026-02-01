// Core heartbeat logic - prompt generation and content checking.

import { HEARTBEAT_TOKEN } from "./tokens"

export const HEARTBEAT_PROMPT =
  "Read HEARTBEAT.md if it exists (workspace context). Follow it strictly. Do not infer or repeat old tasks from prior chats. If nothing needs attention, reply HEARTBEAT_OK."

export const DEFAULT_HEARTBEAT_EVERY = "30m"
export const DEFAULT_HEARTBEAT_ACK_MAX_CHARS = 300

/**
 * Check if HEARTBEAT.md content is "effectively empty" - meaning it has no actionable tasks.
 * This allows skipping heartbeat API calls when no tasks are configured.
 *
 * A file is considered effectively empty if it contains only:
 * - Whitespace
 * - Comment lines (lines starting with #)
 * - Empty lines
 * - Empty markdown list items
 *
 * A missing file returns false (not effectively empty) so the LLM can still
 * decide what to do.
 */
export function isHeartbeatContentEffectivelyEmpty(content: string | undefined | null): boolean {
  if (content === undefined || content === null) {
    return false
  }
  if (typeof content !== "string") {
    return false
  }

  const lines = content.split("\n")
  for (const line of lines) {
    const trimmed = line.trim()
    // Skip empty lines
    if (!trimmed) {
      continue
    }
    // Skip markdown header lines (# followed by space or EOL)
    // Does NOT skip lines like "#TODO" or "#hashtag"
    if (/^#+(\s|$)/.test(trimmed)) {
      continue
    }
    // Skip empty markdown list items like "- [ ]" or "* [ ]" or just "- "
    if (/^[-*+]\s*(\[[\sXx]?\]\s*)?$/.test(trimmed)) {
      continue
    }
    // Found a non-empty, non-comment line - there's actionable content
    return false
  }
  // All lines were either empty or comments
  return true
}

export function resolveHeartbeatPrompt(raw?: string): string {
  const trimmed = typeof raw === "string" ? raw.trim() : ""
  return trimmed || HEARTBEAT_PROMPT
}
