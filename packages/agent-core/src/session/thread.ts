/**
 * Conversation Thread Abstraction
 *
 * Provides a high-level interface for managing persona conversations across channels.
 * Threads map to sessions but add:
 * - Daily session management (one session per persona per day)
 * - User/channel identification
 * - Thread metadata (message counts, last activity)
 * - Cross-thread memory injection
 *
 * Usage:
 *   const thread = await Thread.getOrCreate("zee", "whatsapp", userId)
 *   await Thread.addMessage(thread.id, message)
 *   const history = await Thread.getMessages(thread.id)
 */

import { z } from "zod"
import { Persistence } from "./persistence"
import { Session } from "."
import { MessageV2 } from "./message-v2"
import { Instance } from "../project/instance"
import { Log } from "../util/log"
import { Timestamp } from "../util/timestamp"
import { SessionSummary } from "./summary"
import { Identifier } from "../id/id"
import {
  WHATSAPP_CAPABILITIES,
  MATRIX_CAPABILITIES,
  CLI_CAPABILITIES,
  API_CAPABILITIES,
  WEB_CAPABILITIES,
  type SurfaceCapabilities,
} from "../surface/types"

export namespace Thread {
  const log = Log.create({ service: "thread" })

  /**
   * Thread channels - where the conversation originates
   */
  export type Channel = "whatsapp" | "matrix" | "tui" | "api"

  /**
   * Thread personas - which persona is handling the conversation
   */
  export type Persona = "zee" | "stanley" | "johny"

  /**
   * Thread info - metadata about a conversation thread
   */
  export const Info = z.object({
    /** Thread ID (maps to session ID) */
    id: z.string(),
    /** The persona handling this thread */
    persona: z.enum(["zee", "stanley", "johny"]),
    /** The channel where the conversation happens */
    channel: z.enum(["whatsapp", "matrix", "tui", "api"]),
    /** User identifier (phone number, Matrix user ID, etc.) */
    userId: z.string().optional(),
    /** Chat ID for group chats */
    chatId: z.string().optional(),
    /** When the thread was created */
    createdAt: z.number(),
    /** When the thread was last active */
    lastActiveAt: z.number(),
    /** Number of messages in the thread */
    messageCount: z.number(),
    /** Date string for daily threads (YYYY-MM-DD) */
    dateKey: z.string().optional(),
    /** Whether this thread is currently active */
    isActive: z.boolean(),
  })
  export type Info = z.output<typeof Info>

  /**
   * Get or create a thread for a persona+channel+user combination.
   * For WhatsApp and Matrix, this returns the daily session.
   */
  export async function getOrCreate(
    persona: Persona,
    channel: Channel,
    options?: {
      userId?: string
      chatId?: string
      directory?: string
    },
  ): Promise<Info> {
    const directory = options?.directory ?? Instance.directory

    // Map channel to surface type
    const surface = channelToSurface(channel)

    // For gateway channels, use daily session management
    if (channel === "whatsapp" || channel === "matrix") {
      const chatIdNum = options?.chatId ? parseInt(options.chatId, 10) : undefined
      const result = await Persistence.getOrCreateDailySession(persona, {
        chatId: Number.isNaN(chatIdNum) ? undefined : chatIdNum,
      })

      // Tag the session with the originating surface
      try {
        await Session.update(
          result.sessionId,
          (draft) => {
            if (!draft.surface) draft.surface = surface
          },
          { touch: false },
        )
      } catch {
        // Session may not exist yet in storage race conditions; non-critical
      }

      return {
        id: result.sessionId,
        persona,
        channel,
        userId: options?.userId,
        chatId: options?.chatId,
        createdAt: Date.now(),
        lastActiveAt: Date.now(),
        messageCount: 0, // Will be populated on get
        dateKey: new Date().toISOString().split("T")[0],
        isActive: true,
      }
    }

    // For TUI/API, create a new session
    const session = await Session.createNext({
      title: `${persona.charAt(0).toUpperCase() + persona.slice(1)} - ${channel.toUpperCase()} - ${new Date().toISOString()}`,
      directory,
      surface,
    })

    return {
      id: session.id,
      persona,
      channel,
      userId: options?.userId,
      chatId: options?.chatId,
      createdAt: session.time.created,
      lastActiveAt: session.time.updated,
      messageCount: 0,
      isActive: true,
    }
  }

  /**
   * Get a thread by ID with updated metadata
   */
  export async function get(threadId: string): Promise<Info | null> {
    try {
      const session = await Session.get(threadId)
      if (!session) return null

      // Get message count
      const messages = await Session.messages({ sessionID: threadId })

      // Parse thread info from session title
      const { persona, channel } = parseSessionTitle(session.title)

      return {
        id: session.id,
        persona,
        channel,
        createdAt: session.time.created,
        lastActiveAt: session.time.updated,
        messageCount: messages.length,
        isActive: !session.time.archived,
      }
    } catch (error) {
      log.debug("Failed to get thread", {
        threadId,
        error: error instanceof Error ? error.message : String(error),
      })
      return null
    }
  }

  /**
   * Get messages for a thread
   */
  export async function getMessages(threadId: string, options?: { limit?: number }): Promise<MessageV2.WithParts[]> {
    return Session.messages({ sessionID: threadId, limit: options?.limit })
  }

  /**
   * Get the current daily thread for a persona+channel
   */
  export async function getCurrentDaily(persona: Persona, channel: Channel): Promise<Info | null> {
    if (channel !== "whatsapp" && channel !== "matrix") {
      return null
    }

    const dailySession = await Persistence.getDailySession(persona)
    if (!dailySession) return null

    return get(dailySession.sessionId)
  }

  /**
   * Check if a daily thread exists for today
   */
  export async function hasDailyThread(persona: Persona, channel: Channel): Promise<boolean> {
    if (channel !== "whatsapp" && channel !== "matrix") {
      return false
    }

    return Persistence.hasDailySession(persona)
  }

  /**
   * List recent threads for a persona
   */
  export async function listRecent(persona: Persona, options?: { limit?: number }): Promise<Info[]> {
    const threads: Info[] = []
    const limit = options?.limit ?? 10

    for await (const session of Session.list()) {
      if (threads.length >= limit) break

      const { persona: sessionPersona, channel } = parseSessionTitle(session.title)
      if (sessionPersona !== persona) continue

      const messages = await Session.messages({ sessionID: session.id, limit: 1 })

      threads.push({
        id: session.id,
        persona: sessionPersona,
        channel,
        createdAt: session.time.created,
        lastActiveAt: session.time.updated,
        messageCount: messages.length,
        isActive: !session.time.archived,
      })
    }

    return threads
  }

  /**
   * Parse session title to extract persona and channel
   * Expected formats:
   * - "Zee - 2026-01-11" (WhatsApp daily)
   * - "Zee - Matrix - 2026-01-11" (Matrix daily)
   * - "Johny - TUI - 2026-01-11T12:00:00.000Z"
   */
  function parseSessionTitle(title: string): { persona: Persona; channel: Channel } {
    const lowerTitle = title.toLowerCase()

    // Determine persona
    let persona: Persona = "zee"
    if (lowerTitle.includes("stanley")) {
      persona = "stanley"
    } else if (lowerTitle.includes("johny")) {
      persona = "johny"
    } else if (lowerTitle.includes("zee")) {
      persona = "zee"
    }

    // Determine channel
    let channel: Channel = "tui"
    if (lowerTitle.includes("whatsapp")) {
      channel = "whatsapp"
    } else if (lowerTitle.includes("matrix")) {
      channel = "matrix"
    } else if (lowerTitle.includes("api")) {
      channel = "api"
    } else if (persona === "zee" && !lowerTitle.includes("tui")) {
      // Zee daily sessions without explicit channel are WhatsApp
      channel = "whatsapp"
    }

    return { persona, channel }
  }

  /**
   * Get thread summary for display
   */
  export function getSummary(thread: Info): string {
    const personaIcon = {
      zee: "★",
      stanley: "♦",
      johny: "◎",
    }[thread.persona]

    const channelLabel = {
      whatsapp: "WhatsApp",
      matrix: "Matrix",
      tui: "TUI",
      api: "API",
    }[thread.channel]

    const lastActive = Timestamp.pretty(new Date(thread.lastActiveAt))

    return `${personaIcon} ${thread.persona.charAt(0).toUpperCase() + thread.persona.slice(1)} via ${channelLabel} (${thread.messageCount} msgs, last: ${lastActive})`
  }

  // =========================================================================
  // Thread Search & Discovery (Amp-style)
  // =========================================================================

  export interface SearchOptions {
    /** Search by keyword in thread messages */
    keyword?: string
    /** Search by files touched (edited/read) */
    files?: string[]
    /** Filter by persona */
    persona?: Persona
    /** Filter by channel */
    channel?: Channel
    /** Filter by date range */
    after?: Date
    before?: Date
    /** Maximum results */
    limit?: number
  }

  export interface SearchResult {
    thread: Info
    /** Matching message snippets */
    snippets: string[]
    /** Files touched in this thread */
    filesTouched: string[]
    /** Relevance score (0-1) */
    score: number
  }

  /**
   * Search threads by keyword, files touched, or other criteria.
   * Like Amp's "find threads by keyword or by which files they touched".
   */
  export async function search(options: SearchOptions): Promise<SearchResult[]> {
    const results: SearchResult[] = []
    const limit = options.limit ?? 20

    for await (const session of Session.list()) {
      if (results.length >= limit) break

      // Parse persona/channel from title
      const { persona, channel } = parseSessionTitle(session.title)

      // Filter by persona
      if (options.persona && persona !== options.persona) continue

      // Filter by channel
      if (options.channel && channel !== options.channel) continue

      // Filter by date
      if (options.after && session.time.created < options.after.getTime()) continue
      if (options.before && session.time.created > options.before.getTime()) continue

      // Get messages for deeper search
      const messages = await Session.messages({ sessionID: session.id, limit: 100 })

      // Extract files touched from messages
      const filesTouched = extractFilesTouched(messages)

      // Filter by files
      if (options.files && options.files.length > 0) {
        const hasMatch = options.files.some((file) =>
          filesTouched.some((touched) => touched.includes(file) || file.includes(touched)),
        )
        if (!hasMatch) continue
      }

      // Search by keyword
      let snippets: string[] = []
      let score = 0.5 // Base score

      if (options.keyword) {
        const keyword = options.keyword.toLowerCase()
        snippets = findSnippets(messages, keyword)
        if (snippets.length === 0) continue
        score = Math.min(1, 0.5 + snippets.length * 0.1)
      }

      // Build thread info
      const thread: Info = {
        id: session.id,
        persona,
        channel,
        createdAt: session.time.created,
        lastActiveAt: session.time.updated,
        messageCount: messages.length,
        isActive: !session.time.archived,
      }

      results.push({
        thread,
        snippets,
        filesTouched,
        score,
      })
    }

    // Sort by score (highest first)
    results.sort((a, b) => b.score - a.score)

    return results
  }

  /**
   * Find threads that touched specific files.
   * Shorthand for search({ files: [...] })
   */
  export async function findByFiles(files: string[], limit?: number): Promise<SearchResult[]> {
    return search({ files, limit })
  }

  /**
   * Find threads by keyword.
   * Shorthand for search({ keyword: "..." })
   */
  export async function findByKeyword(keyword: string, limit?: number): Promise<SearchResult[]> {
    return search({ keyword, limit })
  }

  /**
   * Normalize a file path for consistent matching
   */
  function normalizePath(p: string): string {
    return p.trim().replace(/\\/g, "/")
  }

  /**
   * Extract file paths touched in messages (edits, reads, etc.)
   * Looks at tool inputs and outputs for common file path patterns.
   */
  function extractFilesTouched(messages: MessageV2.WithParts[]): string[] {
    const files = new Set<string>()
    const MAX_OUTPUT_SCAN = 50_000

    for (const msg of messages) {
      for (const part of msg.parts) {
        // Check tool calls for file operations
        if (part.type === "tool" && part.state.status !== "pending") {
          const input = part.state.input as Record<string, unknown> | undefined
          if (input && typeof input === "object") {
            // Common single path keys
            const singlePathKeys = ["path", "file", "filePath", "filename", "absolutePath"]
            for (const key of singlePathKeys) {
              const p = input[key]
              if (typeof p === "string" && p.length > 0 && p.length < 500) {
                files.add(normalizePath(p))
              }
            }

            // Common array path keys
            const arrayPathKeys = ["paths", "files", "filePaths"]
            for (const key of arrayPathKeys) {
              const arr = input[key]
              if (Array.isArray(arr)) {
                for (const item of arr) {
                  if (typeof item === "string" && item.length > 0 && item.length < 500) {
                    files.add(normalizePath(item))
                  }
                }
              }
            }
          }

          // Also scan output for file-like paths (e.g., glob results)
          if (part.state.status === "completed" && typeof part.state.output === "string") {
            const output =
              part.state.output.length > MAX_OUTPUT_SCAN
                ? part.state.output.slice(0, MAX_OUTPUT_SCAN)
                : part.state.output
            // Look for lines that appear to be file paths
            for (const line of output.split("\n")) {
              const trimmed = line.trim()
              // Heuristic: contains path separator and looks like a path
              if ((trimmed.includes("/") || trimmed.includes("\\")) && trimmed.length < 300 && !trimmed.includes(" ")) {
                files.add(normalizePath(trimmed))
              }
            }
          }
        }
      }
    }

    return Array.from(files)
  }

  /**
   * Get the surface capabilities for a thread's channel.
   * Useful for including in system prompts so the persona adapts its response style.
   */
  export function getCapabilities(channel: Channel): SurfaceCapabilities {
    switch (channel) {
      case "whatsapp":
        return WHATSAPP_CAPABILITIES
      case "matrix":
        return MATRIX_CAPABILITIES
      case "tui":
        return CLI_CAPABILITIES
      case "api":
        return API_CAPABILITIES
    }
  }

  /**
   * Get a concise hint string describing surface constraints for persona prompts.
   */
  export function getSurfaceHint(channel: Channel): string {
    const caps = getCapabilities(channel)
    const hints: string[] = []

    if (caps.maxMessageLength > 0) {
      hints.push(`Keep responses under ${caps.maxMessageLength} characters.`)
    }
    if (!caps.richText) {
      hints.push("Do not use markdown formatting (plain text only).")
    }
    if (!caps.media) {
      hints.push("Cannot display images or media.")
    }
    if (!caps.streaming) {
      hints.push("Response will be sent as a single message (no streaming).")
    }
    if (!caps.showThinking) {
      hints.push("Thinking/reasoning output is hidden from the user.")
    }

    if (hints.length === 0) return ""
    return `Surface constraints (${channel}): ${hints.join(" ")}`
  }

  /**
   * Map a thread channel to a session surface type.
   */
  function channelToSurface(channel: Channel): "cli" | "web" | "api" | "whatsapp" | "matrix" {
    switch (channel) {
      case "whatsapp":
        return "whatsapp"
      case "matrix":
        return "matrix"
      case "tui":
        return "cli"
      case "api":
        return "api"
    }
  }

  /**
   * Resume a thread on a different surface.
   * Updates the session surface and injects a handoff summary as a system
   * message so the persona has context from the previous surface.
   */
  export async function resume(
    threadId: string,
    surface: "cli" | "web" | "api" | "whatsapp" | "matrix",
    options?: { injectSummary?: boolean },
  ): Promise<Info | null> {
    const thread = await get(threadId)
    if (!thread) return null

    // Update the session's surface
    try {
      await Session.update(threadId, (draft) => {
        draft.surface = surface
      })
    } catch (error) {
      log.debug("Failed to update session surface on resume", {
        threadId,
        surface,
        error: error instanceof Error ? error.message : String(error),
      })
    }

    // Inject handoff summary as a synthetic system message so the persona
    // has context from the previous conversation on the other surface.
    if (options?.injectSummary !== false) {
      try {
        const summary = await SessionSummary.handoffSummary(threadId)
        if (summary) {
          const messageID = Identifier.ascending("message")
          const partID = Identifier.ascending("part")
          await Session.updateMessage({
            id: messageID,
            sessionID: threadId,
            role: "user",
            model: { providerID: "system", modelID: "handoff" },
            time: { created: Date.now(), completed: Date.now() },
          } as any)
          await Session.updatePart({
            id: partID,
            messageID,
            sessionID: threadId,
            type: "text",
            text: summary,
            synthetic: true,
          } as any)
        }
      } catch (error) {
        log.debug("Failed to inject handoff summary", {
          threadId,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }

    // Derive channel from surface
    const channelMap: Record<string, Channel> = {
      cli: "tui",
      web: "tui",
      api: "api",
      whatsapp: "whatsapp",
      matrix: "matrix",
    }

    return {
      ...thread,
      channel: channelMap[surface] ?? "tui",
      lastActiveAt: Date.now(),
    }
  }

  /**
   * Find message snippets containing keyword.
   * Finds multiple occurrences across messages up to maxSnippets.
   */
  function findSnippets(messages: MessageV2.WithParts[], keyword: string): string[] {
    const snippets: string[] = []
    const maxSnippets = 5
    const snippetLength = 100
    const half = Math.floor(snippetLength / 2)
    const maxScan = 50_000

    for (const msg of messages) {
      if (snippets.length >= maxSnippets) break

      for (const part of msg.parts) {
        if (snippets.length >= maxSnippets) break

        let text = ""
        if (part.type === "text") {
          text = part.text
        } else if (part.type === "tool" && part.state.status === "completed") {
          text = typeof part.state.output === "string" ? part.state.output : ""
        }

        if (!text) continue
        // Limit scanning of very large outputs
        if (text.length > maxScan) text = text.slice(0, maxScan)

        const lowerText = text.toLowerCase()
        let fromIndex = 0

        // Find all occurrences in this text
        while (snippets.length < maxSnippets) {
          const index = lowerText.indexOf(keyword, fromIndex)
          if (index === -1) break

          const start = Math.max(0, index - half)
          const end = Math.min(text.length, index + keyword.length + half)
          const snippet = text.slice(start, end).trim()
          snippets.push(snippet.length < text.length ? `...${snippet}...` : snippet)

          fromIndex = index + keyword.length
        }
      }
    }

    return snippets
  }
}
