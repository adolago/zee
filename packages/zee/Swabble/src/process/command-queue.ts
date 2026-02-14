import { CommandLane } from "./lanes.js"
import { diagnosticLogger as diag, logLaneDequeue, logLaneEnqueue } from "../logging/diagnostic.js"

// Minimal in-process queue to serialize command executions.
// Default lane ("main") preserves the existing behavior. Additional lanes allow
// low-risk parallelism (e.g. cron jobs) without interleaving stdin / logs for
// the main auto-reply workflow.

type QueueEntry = {
  task: () => Promise<unknown>
  resolve: (value: unknown) => void
  reject: (reason?: unknown) => void
  enqueuedAt: number
  warnAfterMs: number
  onWait?: (waitMs: number, queuedAhead: number) => void
}

type LaneState = {
  lane: string
  queue: QueueEntry[]
  activeTaskIds: Set<number>
  maxConcurrent: number
  draining: boolean
  generation: number
}

const lanes = new Map<string, LaneState>()
let nextTaskId = 1

function getLaneState(lane: string): LaneState {
  const existing = lanes.get(lane)
  if (existing) return existing
  const created: LaneState = {
    lane,
    queue: [],
    activeTaskIds: new Set(),
    maxConcurrent: 1,
    draining: false,
    generation: 0,
  }
  lanes.set(lane, created)
  return created
}

function completeTask(state: LaneState, taskId: number, taskGeneration: number): boolean {
  if (taskGeneration !== state.generation) {
    return false
  }
  state.activeTaskIds.delete(taskId)
  return true
}

function drainLane(lane: string) {
  const state = getLaneState(lane)
  if (state.draining) return
  state.draining = true

  const pump = () => {
    while (state.activeTaskIds.size < state.maxConcurrent && state.queue.length > 0) {
      const entry = state.queue.shift() as QueueEntry
      const waitedMs = Date.now() - entry.enqueuedAt
      if (waitedMs >= entry.warnAfterMs) {
        entry.onWait?.(waitedMs, state.queue.length)
        diag.warn(`lane wait exceeded: lane=${lane} waitedMs=${waitedMs} queueAhead=${state.queue.length}`)
      }
      logLaneDequeue(lane, waitedMs, state.queue.length)
      const taskId = nextTaskId++
      const taskGeneration = state.generation
      state.activeTaskIds.add(taskId)
      void (async () => {
        const startTime = Date.now()
        try {
          const result = await entry.task()
          const completedCurrentGeneration = completeTask(state, taskId, taskGeneration)
          if (completedCurrentGeneration) {
            diag.debug(
              `lane task done: lane=${lane} durationMs=${Date.now() - startTime} active=${state.activeTaskIds.size} queued=${state.queue.length}`,
            )
            pump()
          }
          entry.resolve(result)
        } catch (err) {
          const completedCurrentGeneration = completeTask(state, taskId, taskGeneration)
          const isProbeLane = lane.startsWith("auth-probe:") || lane.startsWith("session:probe-")
          if (!isProbeLane) {
            diag.error(`lane task error: lane=${lane} durationMs=${Date.now() - startTime} error="${String(err)}"`)
          }
          if (completedCurrentGeneration) {
            pump()
          }
          entry.reject(err)
        }
      })()
    }
    state.draining = false
  }

  pump()
}

export function setCommandLaneConcurrency(lane: string, maxConcurrent: number) {
  const cleaned = lane.trim() || CommandLane.Main
  const state = getLaneState(cleaned)
  state.maxConcurrent = Math.max(1, Math.floor(maxConcurrent))
  drainLane(cleaned)
}

export function enqueueCommandInLane<T>(
  lane: string,
  task: () => Promise<T>,
  opts?: {
    warnAfterMs?: number
    onWait?: (waitMs: number, queuedAhead: number) => void
  },
): Promise<T> {
  const cleaned = lane.trim() || CommandLane.Main
  const warnAfterMs = opts?.warnAfterMs ?? 2_000
  const state = getLaneState(cleaned)
  return new Promise<T>((resolve, reject) => {
    state.queue.push({
      task: () => task(),
      resolve: (value) => resolve(value as T),
      reject,
      enqueuedAt: Date.now(),
      warnAfterMs,
      onWait: opts?.onWait,
    })
    logLaneEnqueue(cleaned, state.queue.length + state.activeTaskIds.size)
    drainLane(cleaned)
  })
}

export function enqueueCommand<T>(
  task: () => Promise<T>,
  opts?: {
    warnAfterMs?: number
    onWait?: (waitMs: number, queuedAhead: number) => void
  },
): Promise<T> {
  return enqueueCommandInLane(CommandLane.Main, task, opts)
}

export function getQueueSize(lane: string = CommandLane.Main) {
  const resolved = lane.trim() || CommandLane.Main
  const state = lanes.get(resolved)
  if (!state) return 0
  return state.queue.length + state.activeTaskIds.size
}

export function getTotalQueueSize() {
  let total = 0
  for (const s of lanes.values()) {
    total += s.queue.length + s.activeTaskIds.size
  }
  return total
}

export function clearCommandLane(lane: string = CommandLane.Main) {
  const cleaned = lane.trim() || CommandLane.Main
  const state = lanes.get(cleaned)
  if (!state) return 0
  const removed = state.queue.length
  state.queue.length = 0
  return removed
}

/**
 * Reset all lanes to an idle runtime state.
 *
 * Used after in-process restarts where interrupted tasks may leave stale
 * active task bookkeeping behind, permanently blocking new queue work.
 * Queued entries are preserved and drained immediately.
 */
export function resetAllLanes(): void {
  const lanesToDrain: string[] = []
  for (const state of lanes.values()) {
    state.generation += 1
    state.activeTaskIds.clear()
    state.draining = false
    if (state.queue.length > 0) {
      lanesToDrain.push(state.lane)
    }
  }
  for (const lane of lanesToDrain) {
    drainLane(lane)
  }
}

export function getActiveTaskCount(): number {
  let total = 0
  for (const state of lanes.values()) {
    total += state.activeTaskIds.size
  }
  return total
}

export function waitForActiveTasks(timeoutMs: number): Promise<{ drained: boolean }> {
  const POLL_INTERVAL_MS = 50
  const deadline = Date.now() + timeoutMs
  const activeAtStart = new Set<number>()
  for (const state of lanes.values()) {
    for (const taskId of state.activeTaskIds) {
      activeAtStart.add(taskId)
    }
  }

  return new Promise((resolve) => {
    const check = () => {
      if (activeAtStart.size === 0) {
        resolve({ drained: true })
        return
      }

      let hasPending = false
      for (const state of lanes.values()) {
        for (const taskId of state.activeTaskIds) {
          if (activeAtStart.has(taskId)) {
            hasPending = true
            break
          }
        }
        if (hasPending) {
          break
        }
      }

      if (!hasPending) {
        resolve({ drained: true })
        return
      }
      if (Date.now() >= deadline) {
        resolve({ drained: false })
        return
      }
      setTimeout(check, POLL_INTERVAL_MS)
    }
    check()
  })
}
