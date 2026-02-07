/**
 * @file Session Collector
 * @description Collects sanitized session data for crash reports
 */

import * as fs from "fs/promises"
import * as path from "path"
import { PrivacyRedactor } from "../privacy/redactor"
import type { SessionReplay, SanitizedMessage, SanitizedToolCall } from "../types"
import { resolveStateDir } from "../../global/dirs"

function getStateDir(): string {
  return resolveStateDir()
}

/**
 * Collect sanitized session replay
 */
export async function collectSession(
  redactor: PrivacyRedactor,
  options: { sessionId?: string } = {},
): Promise<SessionReplay | undefined> {
  const sessionsDir = path.join(getStateDir(), "sessions")

  try {
    const sessionFile = options.sessionId
      ? path.join(sessionsDir, `${options.sessionId}.json`)
      : await findLatestSession(sessionsDir)

    if (!sessionFile) return undefined

    const content = await fs.readFile(sessionFile, "utf-8")
    const session = JSON.parse(content) as Record<string, unknown>

    const messages = (session.messages as Array<Record<string, unknown>>) || []
    const tools = (session.toolCalls as Array<Record<string, unknown>>) || []

    return {
      id: String(session.id || path.basename(sessionFile, ".json")),
      startedAt: String(session.startedAt || new Date().toISOString()),
      messageCount: messages.length,
      messages: sanitizeMessages(messages, redactor),
      toolCalls: sanitizeToolCalls(tools),
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return undefined
    }
    throw error
  }
}

/**
 * Find the most recent session file
 */
async function findLatestSession(dir: string): Promise<string | undefined> {
  try {
    const files = await fs.readdir(dir)
    const jsonFiles = files.filter((f) => f.endsWith(".json"))

    if (jsonFiles.length === 0) return undefined

    let latestFile = jsonFiles[0]
    let latestMtime = 0

    for (const file of jsonFiles) {
      const stat = await fs.stat(path.join(dir, file))
      if (stat.mtimeMs > latestMtime) {
        latestMtime = stat.mtimeMs
        latestFile = file
      }
    }

    return path.join(dir, latestFile)
  } catch {
    return undefined
  }
}

/**
 * Sanitize messages - hash content, create preview
 */
function sanitizeMessages(messages: Array<Record<string, unknown>>, redactor: PrivacyRedactor): SanitizedMessage[] {
  return messages.map((msg) => {
    const content = String(msg.content || "")
    return {
      role: (msg.role as "user" | "assistant" | "system") || "user",
      contentHash: redactor.hashContent(content),
      contentPreview: redactor.createPreview(content, 80),
      timestamp: String(msg.timestamp || new Date().toISOString()),
    }
  })
}

/**
 * Sanitize tool calls - no arguments, just names and timing
 */
function sanitizeToolCalls(tools: Array<Record<string, unknown>>): SanitizedToolCall[] {
  return tools.map((tool) => ({
    tool: String(tool.name || tool.tool || "unknown"),
    success: Boolean(tool.success ?? true),
    durationMs: Number(tool.durationMs || tool.duration || 0),
    timestamp: String(tool.timestamp || new Date().toISOString()),
  }))
}
