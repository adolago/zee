/**
 * Lifecycle Hooks for agent-core daemon
 *
 * Provides hook events for daemon, session, and todo lifecycles.
 */

import z from "zod"
import { BusEvent } from "../bus/bus-event"
import { Bus } from "../bus"
import { Log } from "../util/log"
import { Todo } from "../session/todo"
import { Persistence } from "../session/persistence"

const log = Log.create({ service: "lifecycle-hooks" })

export namespace LifecycleHooks {
  // -------------------------------------------------------------------------
  // Event Definitions
  // -------------------------------------------------------------------------

  export namespace Daemon {
    export const Start = BusEvent.define(
      "daemon.start",
      z.object({
        pid: z.number(),
        port: z.number(),
        hostname: z.string(),
        directory: z.string(),
        startTime: z.number(),
      }),
    )

    export const Ready = BusEvent.define(
      "daemon.ready",
      z.object({
        pid: z.number(),
        port: z.number(),
        services: z.object({
          persistence: z.boolean(),
          telegram: z.boolean(),
          whatsapp: z.boolean(),
        }),
        sessionsWithIncompleteTodos: z.number(),
      }),
    )

    export const Shutdown = BusEvent.define(
      "daemon.shutdown",
      z.object({
        pid: z.number(),
        reason: z.enum(["signal", "error", "manual"]),
        signal: z.string().optional(),
        error: z.string().optional(),
        uptime: z.number(),
      }),
    )

    export type StartPayload = z.infer<typeof Start.properties>
    export type ReadyPayload = z.infer<typeof Ready.properties>
    export type ShutdownPayload = z.infer<typeof Shutdown.properties>
  }

  export namespace SessionLifecycle {
    export const Start = BusEvent.define(
      "session.lifecycle.start",
      z.object({
        sessionId: z.string(),
        persona: z.enum(["zee", "stanley", "johny"]),
        source: z.enum(["daemon", "telegram", "whatsapp", "tui", "cli"]),
        chatId: z.number().optional(),
        directory: z.string(),
      }),
    )

    export const Restore = BusEvent.define(
      "session.lifecycle.restore",
      z.object({
        sessionId: z.string(),
        persona: z.enum(["zee", "stanley", "johny"]),
        source: z.enum(["daemon", "telegram", "whatsapp", "tui", "cli"]),
        chatId: z.number().optional(),
        hasTodos: z.boolean(),
        incompleteTodos: z.number(),
        triggerContinuation: z.boolean(),
      }),
    )

    export const End = BusEvent.define(
      "session.lifecycle.end",
      z.object({
        sessionId: z.string(),
        persona: z.enum(["zee", "stanley", "johny"]).optional(),
        reason: z.enum(["completed", "suspended", "timeout", "error"]),
        duration: z.number(),
        todosCompleted: z.number(),
        todosRemaining: z.number(),
      }),
    )

    export const Transfer = BusEvent.define(
      "session.lifecycle.transfer",
      z.object({
        sessionId: z.string(),
        fromContext: z.enum(["daemon", "telegram", "tui", "cli"]),
        toContext: z.enum(["daemon", "telegram", "tui", "cli"]),
        fromDevice: z.string().optional(),
        toDevice: z.string().optional(),
      }),
    )

    export type StartPayload = z.infer<typeof Start.properties>
    export type RestorePayload = z.infer<typeof Restore.properties>
    export type EndPayload = z.infer<typeof End.properties>
    export type TransferPayload = z.infer<typeof Transfer.properties>
  }

  export namespace TodoLifecycle {
    export const Continuation = BusEvent.define(
      "todo.lifecycle.continuation",
      z.object({
        sessionId: z.string(),
        totalTodos: z.number(),
        completedTodos: z.number(),
        remainingTodos: z.number(),
        percentage: z.number(),
        proceedWithoutAsking: z.boolean(),
        reminderMessage: z.string(),
      }),
    )

    export const Completed = BusEvent.define(
      "todo.lifecycle.completed",
      z.object({
        sessionId: z.string(),
        totalTodos: z.number(),
        duration: z.number(),
      }),
    )

    export const Blocked = BusEvent.define(
      "todo.lifecycle.blocked",
      z.object({
        sessionId: z.string(),
        todoId: z.string(),
        todoContent: z.string(),
        reason: z.string(),
        needsInput: z.boolean(),
      }),
    )

    export type ContinuationPayload = z.infer<typeof Continuation.properties>
    export type CompletedPayload = z.infer<typeof Completed.properties>
    export type BlockedPayload = z.infer<typeof Blocked.properties>
  }

  // -------------------------------------------------------------------------
  // Hook Execution
  // -------------------------------------------------------------------------

  interface HookHandler<T> {
    (payload: T): Promise<void> | void
  }

  const handlers: Map<string, Array<HookHandler<any>>> = new Map()

  /**
   * Register a hook handler
   */
  export function on<T>(event: { type: string }, handler: HookHandler<T>): () => void {
    const eventType = event.type
    if (!handlers.has(eventType)) {
      handlers.set(eventType, [])
    }
    handlers.get(eventType)!.push(handler)

    // Return unsubscribe function
    return () => {
      const list = handlers.get(eventType)
      if (list) {
        const index = list.indexOf(handler)
        if (index !== -1) {
          list.splice(index, 1)
        }
      }
    }
  }

  /**
   * Execute registered hook handlers
   */
  async function executeHandlers<T>(eventType: string, payload: T): Promise<void> {
    const list = handlers.get(eventType) || []
    for (const handler of list) {
      try {
        await handler(payload)
      } catch (error) {
        log.error("Hook handler error", {
          eventType,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }
  }

  // -------------------------------------------------------------------------
  // Daemon Lifecycle Functions
  // -------------------------------------------------------------------------

  let daemonStartTime: number | null = null

  export async function emitDaemonStart(payload: Daemon.StartPayload): Promise<void> {
    daemonStartTime = payload.startTime
    log.info("Emitting daemon.start hook", { pid: payload.pid, port: payload.port })

    Bus.publish(Daemon.Start, payload)
    await executeHandlers(Daemon.Start.type, payload)
  }

  export async function emitDaemonReady(payload: Daemon.ReadyPayload): Promise<void> {
    log.info("Emitting daemon.ready hook", {
      pid: payload.pid,
      services: payload.services,
      sessionsWithIncompleteTodos: payload.sessionsWithIncompleteTodos,
    })

    Bus.publish(Daemon.Ready, payload)
    await executeHandlers(Daemon.Ready.type, payload)
  }

  export async function emitDaemonShutdown(payload: Omit<Daemon.ShutdownPayload, "uptime">): Promise<void> {
    const uptime = daemonStartTime ? Date.now() - daemonStartTime : 0
    const fullPayload: Daemon.ShutdownPayload = { ...payload, uptime }

    log.info("Emitting daemon.shutdown hook", {
      pid: payload.pid,
      reason: payload.reason,
      uptime,
    })

    Bus.publish(Daemon.Shutdown, fullPayload)
    await executeHandlers(Daemon.Shutdown.type, fullPayload)
  }

  // -------------------------------------------------------------------------
  // Session Lifecycle Functions
  // -------------------------------------------------------------------------

  const sessionStartTimes: Map<string, number> = new Map()
  const SESSION_START_TTL_MS = 7 * 24 * 60 * 60 * 1000
  const SESSION_START_MAX = 5000
  const SESSION_START_CLEANUP_INTERVAL_MS = 60 * 60 * 1000
  let lastSessionCleanup = 0

  function cleanupSessionStartTimes(now = Date.now()) {
    if (now - lastSessionCleanup < SESSION_START_CLEANUP_INTERVAL_MS) return
    lastSessionCleanup = now

    let removed = 0
    const cutoff = now - SESSION_START_TTL_MS
    for (const [sessionId, startTime] of sessionStartTimes) {
      if (startTime < cutoff) {
        sessionStartTimes.delete(sessionId)
        removed++
      }
    }

    if (sessionStartTimes.size > SESSION_START_MAX) {
      const entries = Array.from(sessionStartTimes.entries()).sort((a, b) => a[1] - b[1])
      const overflow = sessionStartTimes.size - SESSION_START_MAX
      for (let i = 0; i < overflow; i++) {
        sessionStartTimes.delete(entries[i]![0])
        removed++
      }
    }

    if (removed > 0) {
      log.debug("Pruned session start times", {
        removed,
        remaining: sessionStartTimes.size,
      })
    }
  }

  export async function emitSessionStart(payload: SessionLifecycle.StartPayload): Promise<void> {
    const now = Date.now()
    cleanupSessionStartTimes(now)
    sessionStartTimes.set(payload.sessionId, now)
    log.info("Emitting session.start hook", {
      sessionId: payload.sessionId,
      persona: payload.persona,
      source: payload.source,
    })

    Bus.publish(SessionLifecycle.Start, payload)
    await executeHandlers(SessionLifecycle.Start.type, payload)

    // Update last active in persistence
    if (payload.chatId !== undefined) {
      try {
        await Persistence.setLastActive(payload.persona, payload.sessionId, payload.chatId)
      } catch (e) {
        log.warn("Failed to set last active", { error: String(e) })
      }
    }
  }

  export async function emitSessionRestore(payload: SessionLifecycle.RestorePayload): Promise<void> {
    const now = Date.now()
    cleanupSessionStartTimes(now)
    sessionStartTimes.set(payload.sessionId, now)
    log.info("Emitting session.restore hook", {
      sessionId: payload.sessionId,
      persona: payload.persona,
      hasTodos: payload.hasTodos,
      incompleteTodos: payload.incompleteTodos,
    })

    Bus.publish(SessionLifecycle.Restore, payload)
    await executeHandlers(SessionLifecycle.Restore.type, payload)

    // If there are incomplete todos and continuation is triggered, emit continuation hook
    if (payload.triggerContinuation && payload.incompleteTodos > 0) {
      await emitTodoContinuation(payload.sessionId, payload.persona)
    }

    // Update last active in persistence
    if (payload.chatId !== undefined) {
      try {
        await Persistence.setLastActive(payload.persona, payload.sessionId, payload.chatId)
      } catch (e) {
        log.warn("Failed to set last active", { error: String(e) })
      }
    }
  }

  export async function emitSessionEnd(payload: SessionLifecycle.EndPayload): Promise<void> {
    const startTime = sessionStartTimes.get(payload.sessionId)
    const duration = startTime ? Date.now() - startTime : payload.duration
    const fullPayload = { ...payload, duration }

    log.info("Emitting session.end hook", {
      sessionId: payload.sessionId,
      reason: payload.reason,
      duration,
    })

    Bus.publish(SessionLifecycle.End, fullPayload)
    await executeHandlers(SessionLifecycle.End.type, fullPayload)
    sessionStartTimes.delete(payload.sessionId)
  }

  export async function emitSessionTransfer(payload: SessionLifecycle.TransferPayload): Promise<void> {
    log.info("Emitting session.transfer hook", {
      sessionId: payload.sessionId,
      from: payload.fromContext,
      to: payload.toContext,
    })

    Bus.publish(SessionLifecycle.Transfer, payload)
    await executeHandlers(SessionLifecycle.Transfer.type, payload)
  }

  // -------------------------------------------------------------------------
  // Todo Lifecycle Functions
  // -------------------------------------------------------------------------

  export async function emitTodoContinuation(
    sessionId: string,
    persona?: "zee" | "stanley" | "johny",
  ): Promise<TodoLifecycle.ContinuationPayload | null> {
    try {
      const todos = await Todo.get(sessionId)
      const completedTodos = todos.filter((t) => t.status === "completed").length
      const remainingTodos = todos.filter((t) => t.status !== "completed" && t.status !== "cancelled").length
      const totalTodos = todos.length
      const percentage = totalTodos > 0 ? Math.round((completedTodos / totalTodos) * 100) : 100

      if (remainingTodos === 0) {
        log.debug("No incomplete todos, skipping continuation", { sessionId })
        return null
      }

      const reminderMessage = generateReminderMessage(completedTodos, totalTodos, remainingTodos)

      const payload: TodoLifecycle.ContinuationPayload = {
        sessionId,
        totalTodos,
        completedTodos,
        remainingTodos,
        percentage,
        proceedWithoutAsking: true,
        reminderMessage,
      }

      log.info("Emitting todo.continuation hook", {
        sessionId,
        completedTodos,
        remainingTodos,
        percentage,
      })

      Bus.publish(TodoLifecycle.Continuation, payload)
      await executeHandlers(TodoLifecycle.Continuation.type, payload)

      return payload
    } catch (e) {
      log.error("Failed to emit todo continuation", { sessionId, error: String(e) })
      return null
    }
  }

  export async function emitTodoCompleted(sessionId: string): Promise<void> {
    const startTime = sessionStartTimes.get(sessionId)
    const duration = startTime ? Date.now() - startTime : 0

    try {
      const todos = await Todo.get(sessionId)
      const totalTodos = todos.length

      const payload: TodoLifecycle.CompletedPayload = {
        sessionId,
        totalTodos,
        duration,
      }

      log.info("Emitting todo.completed hook", {
        sessionId,
        totalTodos,
        duration,
      })

      Bus.publish(TodoLifecycle.Completed, payload)
      await executeHandlers(TodoLifecycle.Completed.type, payload)
    } catch (e) {
      log.error("Failed to emit todo completed", { sessionId, error: String(e) })
    }
  }

  export async function emitTodoBlocked(
    sessionId: string,
    todoId: string,
    todoContent: string,
    reason: string,
    needsInput: boolean = true,
  ): Promise<void> {
    const payload: TodoLifecycle.BlockedPayload = {
      sessionId,
      todoId,
      todoContent,
      reason,
      needsInput,
    }

    log.info("Emitting todo.blocked hook", {
      sessionId,
      todoId,
      reason,
    })

    Bus.publish(TodoLifecycle.Blocked, payload)
    await executeHandlers(TodoLifecycle.Blocked.type, payload)
  }

  // -------------------------------------------------------------------------
  // Helper Functions
  // -------------------------------------------------------------------------

  function generateReminderMessage(completed: number, total: number, remaining: number): string {
    const lines: string[] = [
      "[SYSTEM REMINDER - TODO CONTINUATION]",
      "",
      "Incomplete tasks remain in your todo list. Continue working on the next pending task.",
      "",
      "- Proceed without asking for permission",
      "- Mark each task complete when finished",
      "- Do not stop until all tasks are done",
      "",
      `[Status: ${completed}/${total} completed, ${remaining} remaining]`,
    ]
    return lines.join("\n")
  }

  /**
   * Check all sessions for incomplete todos and trigger continuation hooks
   * Called on daemon startup
   */
  export async function checkAllSessionsForContinuation(): Promise<number> {
    let continuationCount = 0

    try {
      const sessionsWithTodos = await Persistence.getSessionsWithIncompleteTodos()

      for (const { session, incompleteTodos } of sessionsWithTodos) {
        if (incompleteTodos.length > 0) {
          log.info("Session has incomplete todos", {
            sessionId: session.id,
            title: session.title,
            incomplete: incompleteTodos.length,
          })
          continuationCount++
        }
      }
    } catch (e) {
      log.error("Failed to check sessions for continuation", { error: String(e) })
    }

    return continuationCount
  }

  /**
   * Format a todo continuation reminder for injection into conversation
   */
  export function formatContinuationReminder(payload: TodoLifecycle.ContinuationPayload): string {
    return `<system-reminder>
${payload.reminderMessage}
</system-reminder>`
  }
}
