/**
 * Zee bootstrap
 *
 * Initializes Zee-owned hooks and services.
 * Called by daemon on startup to enable cross-session memory and fact extraction.
 */

import { LifecycleHooks } from "../hooks/lifecycle"
import { Persistence } from "../session/persistence"
import { Session } from "../session"
import { Log } from "../util/log"
import { prepareLocalMemory } from "../../../../src/memory/local-runtime"

const log = Log.create({ service: "zee-bootstrap" })
const FACT_EXTRACTION_MIN_DURATION_MS = 60_000
const MAX_FACTS_PER_SESSION = 15
const MAX_CONVERSATION_CHARS = 4_000

type UnifiedMemoryModule = typeof import("../../../../src/memory/unified.js")
type UnifiedMemory = Awaited<ReturnType<UnifiedMemoryModule["getMemory"]>>

let initialized = false
let hookUnsubscribers: Array<() => void> = []
let processedSessions = new Set<string>()
let memoryModulePromise: Promise<UnifiedMemoryModule | null> | null = null
let memoryPromise: Promise<UnifiedMemory | null> | null = null
let memoryLoadError: Error | null = null

async function getMemoryModule(): Promise<UnifiedMemoryModule | null> {
  if (!memoryModulePromise) {
    memoryModulePromise = (async () => {
      try {
        return await import("../../../../src/memory/unified.js")
      } catch (e) {
        memoryLoadError = e instanceof Error ? e : new Error(String(e))
        log.error("Unified Memory module load failed", {
          error: memoryLoadError.message,
        })
        return null
      }
    })()
  }

  return memoryModulePromise
}

/**
 * Get the unified Memory instance (lazy load)
 * Throws with actionable error message if memory is unavailable.
 */
async function getMemoryInstance(): Promise<UnifiedMemory> {
  if (!memoryPromise) {
    memoryPromise = (async () => {
      try {
        const memoryModule = await getMemoryModule()
        if (!memoryModule) return null
        return memoryModule.getMemory()
      } catch (e) {
        memoryLoadError = e instanceof Error ? e : new Error(String(e))
        log.error("Unified Memory load failed", {
          error: memoryLoadError.message,
        })
        return null
      }
    })()
  }

  const memory = await memoryPromise

  if (!memory) {
    const cause = memoryLoadError?.message ?? "unknown error"
    throw new Error(
      `Unified Memory is required but unavailable. ` +
        `Run zee memory prepare and check local SQLite state. ` +
        `Cause: ${cause}`,
    )
  }

  return memory
}

function collectSessionTextParts(sessionMessages: Awaited<ReturnType<typeof Session.messages>>): string[] {
  const parts: string[] = []
  for (const message of sessionMessages) {
    const role = message.info.role
    if (role !== "user" && role !== "assistant") continue

    const text = message.parts
      .flatMap((part) => (part.type === "text" ? [part.text.trim()] : []))
      .filter(Boolean)
      .join("\n")

    if (!text) continue
    parts.push(`${role === "user" ? "User" : "Assistant"}: ${text}`)
  }
  return parts
}

function truncateConversation(content: string): { text: string; truncated: boolean } {
  if (content.length <= MAX_CONVERSATION_CHARS) {
    return { text: content, truncated: false }
  }

  return {
    text: content.slice(0, MAX_CONVERSATION_CHARS),
    truncated: true,
  }
}

/**
 * Wrap a hook handler with error logging and context.
 * Re-throws the error after logging to maintain fail-fast behavior.
 */
function safeHookHandler<T>(name: string, fn: (payload: T) => Promise<void>): (payload: T) => Promise<void> {
  return async (payload: T) => {
    try {
      await fn(payload)
    } catch (e) {
      log.error(`Agent hook "${name}" failed`, {
        error: e instanceof Error ? e.message : String(e),
        payload: JSON.stringify(payload).slice(0, 200),
      })
      throw e
    }
  }
}

async function storeConversationAndFacts(sessionId: string, agent: "zee", durationMs: number): Promise<void> {
  if (processedSessions.has(sessionId)) return
  processedSessions.add(sessionId)
  if (processedSessions.size > 1000) {
    const oldest = processedSessions.values().next().value
    if (oldest) processedSessions.delete(oldest)
  }

  const memory = await getMemoryInstance()
  const sessionMessages = await Session.messages({ sessionID: sessionId })
  const transcriptParts = collectSessionTextParts(sessionMessages)
  if (transcriptParts.length === 0) return

  const fullTranscript = transcriptParts.join("\n\n")
  if (fullTranscript.length >= 40) {
    const { text, truncated } = truncateConversation(fullTranscript)
    await memory.save({
      category: "conversation",
      content: text,
      summary: `Session ${sessionId.slice(0, 8)} conversation`,
      metadata: {
        sessionId,
        agent,
        extra: {
          source: "session-transcript",
          truncated,
          length: fullTranscript.length,
        },
      },
    })
  }

  if (durationMs < FACT_EXTRACTION_MIN_DURATION_MS) return

  const memoryModule = await getMemoryModule()
  const facts = (memoryModule?.extractKeyFacts?.(fullTranscript) ?? []).filter(Boolean).slice(0, MAX_FACTS_PER_SESSION)
  if (facts.length === 0) return

  await memory.storeKeyFacts(facts, sessionId, agent)
  log.info("Stored extracted session facts", {
    sessionId: sessionId.slice(0, 8),
    count: facts.length,
  })
}

/**
 * Initialize Zee hooks and services
 */
export async function initZeeBootstrap(): Promise<void> {
  if (initialized) {
    log.debug("Zee bootstrap already initialized")
    return
  }

  log.info("Initializing Zee hooks")

  const memoryStatus = await prepareLocalMemory()
  if (!memoryStatus.ok) {
    throw new Error(memoryStatus.sqlite.error || memoryStatus.embedding.error || "Local memory preparation failed")
  }

  await getMemoryInstance()
  log.info("Unified Memory connected for cross-session context")

  const startUnsub = LifecycleHooks.on<LifecycleHooks.SessionLifecycle.StartPayload>(
    LifecycleHooks.SessionLifecycle.Start,
    safeHookHandler("session.start", async (payload) => {
      await injectCrossSessionMemory(payload.sessionId, payload.agent)
    }),
  )
  hookUnsubscribers.push(startUnsub)

  const restoreUnsub = LifecycleHooks.on<LifecycleHooks.SessionLifecycle.RestorePayload>(
    LifecycleHooks.SessionLifecycle.Restore,
    safeHookHandler("session.restore", async (payload) => {
      await injectCrossSessionMemory(payload.sessionId, payload.agent)
    }),
  )
  hookUnsubscribers.push(restoreUnsub)

  const endUnsub = LifecycleHooks.on<LifecycleHooks.SessionLifecycle.EndPayload>(
    LifecycleHooks.SessionLifecycle.End,
    safeHookHandler("session.end", async (payload) => {
      await storeConversationAndFacts(payload.sessionId, payload.agent ?? "zee", payload.duration)
    }),
  )
  hookUnsubscribers.push(endUnsub)

  initialized = true
  log.info("Zee bootstrap initialized")
}

/**
 * Inject relevant memories from previous sessions.
 */
async function injectCrossSessionMemory(sessionId: string, agent: "zee"): Promise<void> {
  const memory = await getMemoryInstance()
  const memories: string[] = []

  const yesterday = new Date()
  yesterday.setDate(yesterday.getDate() - 1)
  const yesterdaySession = await Persistence.getDailySession(agent, yesterday)

  if (yesterdaySession) {
    const previousSession = await Session.get(yesterdaySession.sessionId)
    if (previousSession) {
      log.info("Found previous session for context", {
        agent,
        previousSessionId: yesterdaySession.sessionId,
        previousDate: yesterday.toISOString().split("T")[0],
      })
      memories.push(`[Previous session from ${yesterday.toISOString().split("T")[0]}]`)
    }
  }

  const searchResults = await memory.searchAgentMemories(getAgentSearchContext(agent), agent, {
    limit: 5,
    categories: ["fact", "preference", "decision"],
  })

  if (searchResults.length > 0) {
    log.info("Found relevant memories", {
      agent,
      count: searchResults.length,
    })

    for (const result of searchResults) {
      memories.push(`[Memory (${result.entry.category}, relevance: ${result.score.toFixed(2)})]: ${result.entry.content}`)
    }
  }

  if (memories.length > 0) {
    await storeSessionContext(sessionId, memories)
    log.info("Injected cross-session context", {
      sessionId: sessionId.slice(0, 8),
      memoriesCount: memories.length,
    })
  }
}

function getAgentSearchContext(_agent: "zee"): string {
  return "personal assistant tasks reminders calendar schedule preferences contacts portfolio investments learning study knowledge practice"
}

/**
 * Store cross-session context for prompt injection.
 */
async function storeSessionContext(sessionId: string, memories: string[]): Promise<void> {
  try {
    await Persistence.setSessionContext(sessionId, {
      timestamp: Date.now(),
      memories,
    })
  } catch (error) {
    log.debug("Could not store session context", {
      sessionId: sessionId.slice(0, 8),
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

/**
 * Cleanup hooks and reset state.
 */
export function cleanupZeeBootstrap(): void {
  for (const unsub of hookUnsubscribers) {
    try {
      unsub()
    } catch (e) {
      log.debug("Hook unsubscribe failed", {
        error: e instanceof Error ? e.message : String(e),
      })
    }
  }
  hookUnsubscribers = []

  memoryModulePromise = null
  memoryPromise = null
  memoryLoadError = null
  processedSessions = new Set()
  initialized = false

  log.info("Zee bootstrap cleanup complete")
}
