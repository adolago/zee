/**
 * Session Persistence & Recovery
 *
 * Provides robust session persistence that survives crashes and restarts:
 * - Periodic checkpoints of session state
 * - Write-ahead logging for in-progress operations
 * - Crash recovery on daemon startup
 * - Last active session tracking per persona
 */

import { Log } from "../util/log"
import { Global } from "../global"
import { Storage } from "../storage/storage"
import { Bus } from "../bus"
import { Session } from "./index"
import { Todo } from "./todo"
import { MessageV2 } from "./message-v2"
import fs from "fs/promises"
import path from "path"

const log = Log.create({ service: "session-persistence" })

export namespace Persistence {
  // -------------------------------------------------------------------------
  // Configuration
  // -------------------------------------------------------------------------

  export interface Config {
    /** Checkpoint interval in milliseconds (default: 5 minutes) */
    checkpointInterval: number
    /** Maximum number of checkpoints to keep (default: 3) */
    maxCheckpoints: number
    /** Enable write-ahead logging (default: true) */
    enableWAL: boolean
    /** WAL flush interval in milliseconds (default: 1 second) */
    walFlushInterval: number
  }

  const DEFAULT_CONFIG: Config = {
    checkpointInterval: 5 * 60 * 1000, // 5 minutes
    maxCheckpoints: 3,
    enableWAL: true,
    walFlushInterval: 1000,
  }

  // -------------------------------------------------------------------------
  // State
  // -------------------------------------------------------------------------

  const PERSISTENCE_DIR = path.join(Global.Path.state, "persistence")
  const CHECKPOINT_DIR = path.join(PERSISTENCE_DIR, "checkpoints")
  const WAL_FILE = path.join(PERSISTENCE_DIR, "wal.jsonl")
  const LAST_ACTIVE_FILE = path.join(PERSISTENCE_DIR, "last-active.json")
  const DAILY_SESSIONS_FILE = path.join(PERSISTENCE_DIR, "daily-sessions.json")
  const RECOVERY_MARKER = path.join(PERSISTENCE_DIR, "recovery-needed")

  interface LastActiveState {
    zee?: { sessionId: string; chatId?: number; updatedAt: number }
    stanley?: { sessionId: string; chatId?: number; updatedAt: number }
    johny?: { sessionId: string; chatId?: number; updatedAt: number }
  }

  interface WALEntry {
    timestamp: number
    operation: "session_create" | "session_update" | "message_create" | "todo_update" | "session_activate"
    data: Record<string, unknown>
  }

  interface CheckpointMetadata {
    id: string
    timestamp: number
    sessionCount: number
    todoCount: number
  }

  let config: Config = DEFAULT_CONFIG
  let checkpointInterval: NodeJS.Timeout | null = null
  let walBuffer: WALEntry[] = []
  let walFlushInterval: NodeJS.Timeout | null = null
  let isRunning = false
  let eventUnsubscribers: Array<() => void> = []

  // Mutex for WAL buffer operations to prevent race conditions
  let walMutexPromise: Promise<void> = Promise.resolve()

  async function withWALMutex<T>(fn: () => T | Promise<T>): Promise<T> {
    const currentMutex = walMutexPromise
    let release: () => void
    walMutexPromise = new Promise((resolve) => {
      release = resolve
    })
    await currentMutex
    try {
      return await fn()
    } finally {
      release!()
    }
  }

  // Mutex for state file operations (last-active.json, daily-sessions.json)
  // Prevents read-modify-write race conditions
  let stateMutexPromise: Promise<void> = Promise.resolve()

  async function withStateMutex<T>(fn: () => T | Promise<T>): Promise<T> {
    const currentMutex = stateMutexPromise
    let release: () => void
    stateMutexPromise = new Promise((resolve) => {
      release = resolve
    })
    await currentMutex
    try {
      return await fn()
    } finally {
      release!()
    }
  }

  // Atomic write: write to temp file then rename to avoid partial writes
  async function atomicWriteJSON(filePath: string, data: unknown): Promise<void> {
    const tempPath = `${filePath}.tmp.${Date.now()}`
    await fs.writeFile(tempPath, JSON.stringify(data, null, 2))
    await fs.rename(tempPath, filePath)
  }

  // -------------------------------------------------------------------------
  // Initialization
  // -------------------------------------------------------------------------

  export async function init(userConfig: Partial<Config> = {}): Promise<void> {
    config = { ...DEFAULT_CONFIG, ...userConfig }

    // Ensure directories exist
    await fs.mkdir(CHECKPOINT_DIR, { recursive: true })

    // Check if recovery is needed
    const needsRecovery = await fs
      .access(RECOVERY_MARKER)
      .then(() => true)
      .catch(() => false)

    if (needsRecovery) {
      log.info("Recovery marker found, running recovery...")
      await recover()
    }

    // Create recovery marker (removed on clean shutdown)
    await fs.writeFile(RECOVERY_MARKER, new Date().toISOString())

    isRunning = true

    // Start checkpoint timer
    checkpointInterval = setInterval(() => {
      createCheckpoint().catch((e) => log.error("Checkpoint failed", { error: String(e) }))
    }, config.checkpointInterval)

    // Start WAL flush timer
    if (config.enableWAL) {
      walFlushInterval = setInterval(() => {
        flushWAL().catch((e) => log.error("WAL flush failed", { error: String(e) }))
      }, config.walFlushInterval)
    }

    // Subscribe to events for WAL
    clearEventListeners()
    setupEventListeners()

    log.info("Persistence initialized", {
      checkpointInterval: config.checkpointInterval,
      enableWAL: config.enableWAL,
    })
  }

  export async function shutdown(): Promise<void> {
    isRunning = false

    // Stop timers
    if (checkpointInterval) {
      clearInterval(checkpointInterval)
      checkpointInterval = null
    }
    if (walFlushInterval) {
      clearInterval(walFlushInterval)
      walFlushInterval = null
    }

    clearEventListeners()

    let cleanShutdown = true

    // Flush remaining WAL entries
    await flushWAL().catch((e) => {
      cleanShutdown = false
      log.error("WAL flush failed during shutdown", { error: String(e) })
    })

    // Create final checkpoint
    await createCheckpoint().catch((e) => {
      cleanShutdown = false
      log.error("Final checkpoint failed during shutdown", { error: String(e) })
    })

    // Remove recovery marker (clean shutdown)
    if (cleanShutdown) {
      await fs.unlink(RECOVERY_MARKER).catch(() => {})
    } else {
      log.warn("Skipping recovery marker removal due to shutdown errors")
    }

    log.info("Persistence shutdown complete")
  }

  // -------------------------------------------------------------------------
  // Write-Ahead Logging
  // -------------------------------------------------------------------------

  function setupEventListeners(): void {
    // Listen for session events
    eventUnsubscribers.push(Bus.subscribe(Session.Event.Created, (event) => {
      appendToWAL({
        timestamp: Date.now(),
        operation: "session_create",
        data: { session: event.properties.info },
      })
    }))

    eventUnsubscribers.push(Bus.subscribe(Session.Event.Updated, (event) => {
      appendToWAL({
        timestamp: Date.now(),
        operation: "session_update",
        data: { session: event.properties.info },
      })
    }))

    // Listen for message events
    eventUnsubscribers.push(Bus.subscribe(MessageV2.Event.Updated, (event) => {
      appendToWAL({
        timestamp: Date.now(),
        operation: "message_create",
        data: { message: event.properties.info },
      })
    }))

    // Listen for todo events
    eventUnsubscribers.push(Bus.subscribe(Todo.Event.Updated, (event) => {
      appendToWAL({
        timestamp: Date.now(),
        operation: "todo_update",
        data: { sessionID: event.properties.sessionID, todos: event.properties.todos },
      })
    }))
  }

  function clearEventListeners(): void {
    if (eventUnsubscribers.length === 0) return
    for (const unsubscribe of eventUnsubscribers) {
      try {
        unsubscribe()
      } catch (error) {
        log.warn("Failed to unsubscribe persistence listener", {
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }
    eventUnsubscribers = []
  }

  function appendToWAL(entry: WALEntry): void {
    if (!config.enableWAL || !isRunning) return
    // Use synchronous push but the mutex protects flushWAL from reading while we push
    // For truly concurrent safety, we queue this through the mutex
    withWALMutex(() => {
      walBuffer.push(entry)
    }).catch((e) => log.error("Failed to append to WAL", { error: String(e) }))
  }

  async function flushWAL(): Promise<void> {
    await withWALMutex(async () => {
      if (walBuffer.length === 0) return

      const entries = walBuffer
      walBuffer = []

      const lines = entries.map((e) => JSON.stringify(e)).join("\n") + "\n"

      await fs.appendFile(WAL_FILE, lines).catch((e) => {
        // Put entries back if write failed (inside mutex, so safe)
        walBuffer = [...entries, ...walBuffer]
        throw e
      })
    })
  }

  async function replayWAL(): Promise<number> {
    let replayed = 0

    try {
      const content = await fs.readFile(WAL_FILE, "utf-8")
      const lines = content.split("\n").filter(Boolean)

      for (const line of lines) {
        try {
          const entry = JSON.parse(line) as WALEntry
          await replayWALEntry(entry)
          replayed++
        } catch (e) {
          log.warn("Failed to replay WAL entry", { error: String(e), line: line.substring(0, 100) })
        }
      }

      // Clear WAL after successful replay
      await fs.unlink(WAL_FILE).catch(() => {})
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") {
        log.error("Failed to read WAL", { error: String(e) })
      }
    }

    return replayed
  }

  async function replayWALEntry(entry: WALEntry): Promise<void> {
    // WAL entries are replayed to ensure state consistency
    // The actual state should already be in storage, so we mainly
    // use this to verify and republish events
    switch (entry.operation) {
      case "session_create":
      case "session_update":
        // Session should already be persisted by Storage
        log.debug("WAL: session operation", { id: (entry.data.session as Session.Info)?.id })
        break
      case "message_create":
        log.debug("WAL: message operation", { id: (entry.data.message as MessageV2.Info)?.id })
        break
      case "todo_update":
        log.debug("WAL: todo operation", { sessionID: entry.data.sessionID })
        break
      case "session_activate":
        // Re-apply last active session
        const { persona, sessionId, chatId } = entry.data as {
          persona: keyof LastActiveState
          sessionId: string
          chatId?: number
        }
        await setLastActive(persona, sessionId, chatId)
        break
    }
  }

  // -------------------------------------------------------------------------
  // Checkpoints
  // -------------------------------------------------------------------------

  export async function createCheckpoint(): Promise<string> {
    const checkpointId = `checkpoint-${Date.now()}`
    const checkpointPath = path.join(CHECKPOINT_DIR, checkpointId)

    log.info("Creating checkpoint", { id: checkpointId })

    await fs.mkdir(checkpointPath, { recursive: true })

    // Get all sessions
    const sessions: Session.Info[] = []
    for await (const session of Session.list()) {
      sessions.push(session)
    }

    // Collect all session data with todos
    let todoCount = 0
    const sessionData: Array<{
      session: Session.Info
      todos: Todo.Info[]
    }> = []

    for (const session of sessions) {
      const todos = await Todo.get(session.id)
      todoCount += todos.length
      sessionData.push({ session, todos })
    }

    // Write checkpoint data
    await fs.writeFile(path.join(checkpointPath, "sessions.json"), JSON.stringify(sessionData, null, 2))

    // Write last active state
    const lastActive = await getLastActiveState()
    await fs.writeFile(path.join(checkpointPath, "last-active.json"), JSON.stringify(lastActive, null, 2))

    // Write metadata
    const metadata: CheckpointMetadata = {
      id: checkpointId,
      timestamp: Date.now(),
      sessionCount: sessions.length,
      todoCount,
    }
    await fs.writeFile(path.join(checkpointPath, "metadata.json"), JSON.stringify(metadata, null, 2))

    log.info("Checkpoint created", {
      id: checkpointId,
      sessions: sessions.length,
      todos: todoCount,
    })

    // Cleanup old checkpoints
    await cleanupOldCheckpoints()

    return checkpointId
  }

  async function cleanupOldCheckpoints(): Promise<void> {
    try {
      const entries = await fs.readdir(CHECKPOINT_DIR)
      const checkpoints = entries
        .filter((e) => e.startsWith("checkpoint-"))
        .map((e) => ({
          name: e,
          timestamp: parseInt(e.replace("checkpoint-", "")),
        }))
        .sort((a, b) => b.timestamp - a.timestamp) // newest first

      // Keep only the newest N checkpoints
      const toDelete = checkpoints.slice(config.maxCheckpoints)
      for (const checkpoint of toDelete) {
        const checkpointPath = path.join(CHECKPOINT_DIR, checkpoint.name)
        await fs.rm(checkpointPath, { recursive: true }).catch(() => {})
        log.debug("Deleted old checkpoint", { id: checkpoint.name })
      }
    } catch (e) {
      log.warn("Failed to cleanup checkpoints", { error: String(e) })
    }
  }

  async function getLatestCheckpoint(): Promise<string | null> {
    try {
      const entries = await fs.readdir(CHECKPOINT_DIR)
      const checkpoints = entries
        .filter((e) => e.startsWith("checkpoint-"))
        .map((e) => ({
          name: e,
          timestamp: parseInt(e.replace("checkpoint-", "")),
        }))
        .sort((a, b) => b.timestamp - a.timestamp) // newest first

      return checkpoints[0]?.name || null
    } catch {
      return null
    }
  }

  // -------------------------------------------------------------------------
  // Recovery
  // -------------------------------------------------------------------------

  export async function recover(): Promise<{ checkpointRestored: boolean; walEntriesReplayed: number }> {
    log.info("Starting recovery...")

    let checkpointRestored = false
    let walEntriesReplayed = 0

    // Try to restore from latest checkpoint
    const latestCheckpoint = await getLatestCheckpoint()
    if (latestCheckpoint) {
      try {
        await restoreFromCheckpoint(latestCheckpoint)
        checkpointRestored = true
        log.info("Restored from checkpoint", { id: latestCheckpoint })
      } catch (e) {
        log.error("Failed to restore from checkpoint", { error: String(e) })
      }
    }

    // Replay WAL for any operations after the checkpoint
    walEntriesReplayed = await replayWAL()

    log.info("Recovery complete", {
      checkpointRestored,
      walEntriesReplayed,
    })

    return { checkpointRestored, walEntriesReplayed }
  }

  async function restoreFromCheckpoint(checkpointId: string): Promise<void> {
    const checkpointPath = path.join(CHECKPOINT_DIR, checkpointId)

    // Read metadata
    const metadataPath = path.join(checkpointPath, "metadata.json")
    const metadata = JSON.parse(await fs.readFile(metadataPath, "utf-8")) as CheckpointMetadata

    log.info("Restoring checkpoint", {
      id: checkpointId,
      timestamp: new Date(metadata.timestamp).toISOString(),
      sessions: metadata.sessionCount,
    })

    // Restore last active state
    const lastActivePath = path.join(checkpointPath, "last-active.json")
    try {
      const lastActive = JSON.parse(await fs.readFile(lastActivePath, "utf-8")) as LastActiveState
      await fs.writeFile(LAST_ACTIVE_FILE, JSON.stringify(lastActive, null, 2))
    } catch {
      // Last active state is optional
    }
  }

  // -------------------------------------------------------------------------
  // Last Active Session Tracking
  // -------------------------------------------------------------------------

  export async function setLastActive(
    persona: "zee" | "stanley" | "johny",
    sessionId: string,
    chatId?: number,
  ): Promise<void> {
    // Use mutex to prevent read-modify-write race conditions
    await withStateMutex(async () => {
      const state = await getLastActiveState()

      state[persona] = {
        sessionId,
        chatId,
        updatedAt: Date.now(),
      }

      // Atomic write to prevent partial writes
      await atomicWriteJSON(LAST_ACTIVE_FILE, state)
    })

    // Also log to WAL (outside mutex to avoid holding lock during I/O)
    appendToWAL({
      timestamp: Date.now(),
      operation: "session_activate",
      data: { persona, sessionId, chatId },
    })

    log.debug("Set last active session", { persona, sessionId, chatId })
  }

  export async function getLastActive(persona: "zee" | "stanley" | "johny"): Promise<{
    sessionId: string
    chatId?: number
    updatedAt: number
  } | null> {
    const state = await getLastActiveState()
    return state[persona] || null
  }

  async function getLastActiveState(): Promise<LastActiveState> {
    try {
      const content = await fs.readFile(LAST_ACTIVE_FILE, "utf-8")
      return JSON.parse(content) as LastActiveState
    } catch {
      return {}
    }
  }

  export async function getAllLastActive(): Promise<LastActiveState> {
    return getLastActiveState()
  }

  // -------------------------------------------------------------------------
  // Daily Session Tracking (One session per persona per day)
  // -------------------------------------------------------------------------

  interface DailySessionEntry {
    sessionId: string
    chatId?: number
    createdAt: number
  }

  interface DailySessionsState {
    // Format: { "zee-2026-01-11": { sessionId, chatId, createdAt }, ... }
    [key: string]: DailySessionEntry
  }

  function getDailyKey(persona: "zee" | "stanley" | "johny", date?: Date): string {
    const d = date || new Date()
    const dateStr = d.toISOString().split("T")[0] // YYYY-MM-DD
    return `${persona}-${dateStr}`
  }

  async function getDailySessionsState(): Promise<DailySessionsState> {
    try {
      const content = await fs.readFile(DAILY_SESSIONS_FILE, "utf-8")
      return JSON.parse(content) as DailySessionsState
    } catch {
      return {}
    }
  }

  /**
   * Get today's session for a persona (or specific date)
   */
  export async function getDailySession(
    persona: "zee" | "stanley" | "johny",
    date?: Date,
  ): Promise<DailySessionEntry | null> {
    const key = getDailyKey(persona, date)
    const state = await getDailySessionsState()
    return state[key] || null
  }

  /**
   * Set today's session for a persona (or specific date)
   */
  export async function setDailySession(
    persona: "zee" | "stanley" | "johny",
    sessionId: string,
    chatId?: number,
    date?: Date,
  ): Promise<void> {
    const key = getDailyKey(persona, date)

    // Use mutex to prevent read-modify-write race conditions
    await withStateMutex(async () => {
      const state = await getDailySessionsState()

      state[key] = {
        sessionId,
        chatId,
        createdAt: Date.now(),
      }

      // Cleanup old entries (keep last 30 days)
      const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000
      for (const k of Object.keys(state)) {
        if (state[k].createdAt < cutoff) {
          delete state[k]
        }
      }

      // Atomic write to prevent partial writes
      await atomicWriteJSON(DAILY_SESSIONS_FILE, state)
    })

    // Also log to WAL (outside mutex to avoid holding lock during I/O)
    appendToWAL({
      timestamp: Date.now(),
      operation: "session_activate",
      data: { persona, sessionId, chatId, daily: true, date: getDailyKey(persona, date) },
    })

    log.debug("Set daily session", { persona, sessionId, chatId, key })
  }

  /**
   * Check if a daily session exists and is still valid
   */
  export async function hasDailySession(persona: "zee" | "stanley" | "johny", date?: Date): Promise<boolean> {
    const entry = await getDailySession(persona, date)
    if (!entry) return false

    // Verify session still exists
    try {
      const session = await Session.get(entry.sessionId)
      return !!session
    } catch {
      return false
    }
  }

  // Track in-progress reservations to prevent TOCTOU races
  const pendingReservations = new Map<string, Promise<{ sessionId: string; isNew: boolean }>>()

  /**
   * Get or create a daily session for a persona
   * Returns the session ID to use
   *
   * Uses mutex to prevent TOCTOU race where multiple callers both see isNew:true
   */
  export async function getOrCreateDailySession(
    persona: "zee" | "stanley" | "johny",
    options: {
      chatId?: number
      title?: string
    } = {},
  ): Promise<{ sessionId: string; isNew: boolean }> {
    const key = getDailyKey(persona)

    // Check if there's already an in-progress reservation for this key
    const pending = pendingReservations.get(key)
    if (pending) {
      // Wait for the pending reservation to complete, then re-check
      await pending
      return getOrCreateDailySession(persona, options)
    }

    // Use mutex to ensure atomic check-and-reserve
    const reservationPromise = withStateMutex(async () => {
      // Check for existing daily session
      const existing = await getDailySession(persona)
      if (existing) {
        // Verify it still exists
        try {
          const session = await Session.get(existing.sessionId)
          if (session) {
            log.debug("Reusing daily session", { persona, sessionId: existing.sessionId })
            return { sessionId: existing.sessionId, isNew: false }
          }
        } catch {
          // Session no longer exists, will create new one
        }
      }

      // Need to create new session - return empty sessionId to indicate caller should create
      // (We don't create here because session creation needs proper API context)
      return { sessionId: "", isNew: true }
    })

    // Track this reservation while it's in progress
    pendingReservations.set(key, reservationPromise)

    try {
      return await reservationPromise
    } finally {
      pendingReservations.delete(key)
    }
  }

  // -------------------------------------------------------------------------
  // Session Recovery Helpers
  // -------------------------------------------------------------------------

  export interface SessionWithTodos {
    session: Session.Info
    todos: Todo.Info[]
    incompleteTodos: Todo.Info[]
  }

  /**
   * Get all sessions that have incomplete todos
   */
  export async function getSessionsWithIncompleteTodos(): Promise<SessionWithTodos[]> {
    const result: SessionWithTodos[] = []

    for await (const session of Session.list()) {
      const todos = await Todo.get(session.id)
      const incompleteTodos = todos.filter((t) => t.status !== "completed" && t.status !== "cancelled")

      if (incompleteTodos.length > 0) {
        result.push({
          session,
          todos,
          incompleteTodos,
        })
      }
    }

    // Sort by most recently updated
    result.sort((a, b) => (b.session.time.updated || 0) - (a.session.time.updated || 0))

    return result
  }

  /**
   * Get the last active session for a persona with its todos
   */
  export async function getLastActiveSessionWithTodos(
    persona: "zee" | "stanley" | "johny",
  ): Promise<SessionWithTodos | null> {
    const lastActive = await getLastActive(persona)
    if (!lastActive) return null

    try {
      const session = await Session.get(lastActive.sessionId)
      if (!session) return null

      const todos = await Todo.get(session.id)
      const incompleteTodos = todos.filter((t) => t.status !== "completed" && t.status !== "cancelled")

      return { session, todos, incompleteTodos }
    } catch {
      return null
    }
  }

  // -------------------------------------------------------------------------
  // Session Context (for cross-session memory injection)
  // -------------------------------------------------------------------------

  const SESSION_CONTEXT_FILE = path.join(PERSISTENCE_DIR, "session-contexts.json")

  interface SessionContext {
    timestamp: number
    memories: string[]
  }

  interface SessionContextStore {
    [sessionId: string]: SessionContext
  }

  /**
   * Set cross-session context for a session
   * Used by personas bootstrap to inject memories
   */
  export async function setSessionContext(sessionId: string, context: SessionContext): Promise<void> {
    await fs.mkdir(PERSISTENCE_DIR, { recursive: true })

    let store: SessionContextStore = {}
    try {
      const content = await fs.readFile(SESSION_CONTEXT_FILE, "utf-8")
      store = JSON.parse(content)
    } catch {
      // File doesn't exist yet
    }

    store[sessionId] = context

    // Cleanup old contexts (keep last 100)
    const entries = Object.entries(store)
    if (entries.length > 100) {
      entries.sort((a, b) => b[1].timestamp - a[1].timestamp)
      store = Object.fromEntries(entries.slice(0, 100))
    }

    await fs.writeFile(SESSION_CONTEXT_FILE, JSON.stringify(store, null, 2))
  }

  /**
   * Get cross-session context for a session
   * Used by prompt builder to inject memories into system prompt
   */
  export async function getSessionContext(sessionId: string): Promise<SessionContext | null> {
    try {
      const content = await fs.readFile(SESSION_CONTEXT_FILE, "utf-8")
      const store: SessionContextStore = JSON.parse(content)
      return store[sessionId] ?? null
    } catch {
      return null
    }
  }

  /**
   * Clear session context after it's been used
   */
  export async function clearSessionContext(sessionId: string): Promise<void> {
    try {
      const content = await fs.readFile(SESSION_CONTEXT_FILE, "utf-8")
      const store: SessionContextStore = JSON.parse(content)
      delete store[sessionId]
      await fs.writeFile(SESSION_CONTEXT_FILE, JSON.stringify(store, null, 2))
    } catch {
      // Ignore if file doesn't exist
    }
  }
}
