import { Log } from "@/util/log"
import { Bus } from "@/bus"
import { BusEvent } from "@/bus/bus-event"
import { z } from "zod"
import { Global } from "@/global"
import path from "path"
import fs from "fs/promises"

/**
 * Circuit Breaker pattern for provider health management.
 *
 * States:
 * - CLOSED: Normal operation, requests pass through
 * - OPEN: Provider is failing, requests are blocked
 * - HALF_OPEN: Testing if provider has recovered
 *
 * Adapted from a prior circuit-breaker implementation, standalone for agent-core.
 */
export namespace CircuitBreaker {
  const log = Log.create({ service: "circuit-breaker" })

  export type State = "closed" | "open" | "half_open"

  export type Config = {
    /** Number of consecutive failures before opening the circuit (default: 3) */
    failureThreshold: number
    /** Number of consecutive successes in half_open to close the circuit (default: 2) */
    successThreshold: number
    /** Time in ms before transitioning from open to half_open (default: 60000) */
    timeout: number
    /** Max concurrent requests in half_open state (default: 1) */
    halfOpenLimit: number
  }

  export type ProviderState = {
    state: State
    failures: number
    successes: number
    lastFailure?: number
    lastError?: string
    halfOpenRequests: number
  }

  // Events
  export const Event = {
    StateChanged: BusEvent.define(
      "circuit-breaker.state-changed",
      z.object({
        providerID: z.string(),
        previousState: z.enum(["closed", "open", "half_open"]),
        newState: z.enum(["closed", "open", "half_open"]),
        reason: z.string(),
      }),
    ),
  }

  // Default configuration
  const DEFAULT_CONFIG: Config = {
    failureThreshold: 3,
    successThreshold: 2,
    timeout: 60_000,
    halfOpenLimit: 1,
  }

  // RELIABILITY: Persist circuit breaker state to survive restarts
  // This prevents immediate retries of failing providers after daemon restart
  const STATE_FILE = path.join(Global.Path.state, "circuit-breaker.json")
  const PERSISTENCE_INTERVAL = 30_000 // Save every 30 seconds

  // In-memory state (now persisted across restarts)
  const breakers = new Map<string, ProviderState>()
  let config: Config = { ...DEFAULT_CONFIG }
  let stateMutex: Promise<void> = Promise.resolve()
  let persistenceTimer: NodeJS.Timeout | null = null
  let lastPersistedState = ""

  async function withStateLock<T>(fn: () => T | Promise<T>): Promise<T> {
    const current = stateMutex
    let release!: () => void
    stateMutex = new Promise<void>((resolve) => {
      release = resolve
    })
    await current
    try {
      return await fn()
    } finally {
      release()
    }
  }

  // RELIABILITY: Persist state to disk for crash recovery
  async function saveState(): Promise<void> {
    const state: Record<string, ProviderState> = {}
    for (const [id, s] of breakers) {
      state[id] = { ...s }
    }
    const json = JSON.stringify(state)
    // Only write if state changed
    if (json === lastPersistedState) return
    lastPersistedState = json
    try {
      await fs.mkdir(Global.Path.state, { recursive: true })
      await fs.writeFile(STATE_FILE, json)
    } catch (e) {
      log.warn("failed to persist circuit breaker state", { error: String(e) })
    }
  }

  // RELIABILITY: Load persisted state on startup
  async function loadState(): Promise<void> {
    try {
      const content = await fs.readFile(STATE_FILE, "utf-8")
      const state = JSON.parse(content) as Record<string, ProviderState>
      for (const [id, s] of Object.entries(state)) {
        // Only restore OPEN or HALF_OPEN states - CLOSED is the default
        // Also check if timeout has passed for OPEN states
        if (s.state === "open") {
          if (s.lastFailure && Date.now() - s.lastFailure < config.timeout) {
            breakers.set(id, s)
          }
          // If timeout passed, let it naturally transition to half_open on first check
        } else if (s.state === "half_open") {
          // Reset half-open counters since we don't know if requests completed
          breakers.set(id, { ...s, halfOpenRequests: 0, successes: 0 })
        }
      }
      log.info("loaded persisted circuit breaker state", { providers: breakers.size })
    } catch (e) {
      // File doesn't exist or is corrupt - start fresh
      log.debug("no persisted circuit breaker state found")
    }
  }

  // Schedule periodic persistence
  function startPersistence(): void {
    if (persistenceTimer) return
    persistenceTimer = setInterval(() => {
      void saveState()
    }, PERSISTENCE_INTERVAL)
  }

  /**
   * Initialize the circuit breaker and load persisted state.
   * Must be called before using other functions.
   */
  export async function init(): Promise<void> {
    await loadState()
    startPersistence()
  }

  /**
   * Shutdown the circuit breaker and save final state.
   */
  export async function shutdown(): Promise<void> {
    if (persistenceTimer) {
      clearInterval(persistenceTimer)
      persistenceTimer = null
    }
    await saveState()
  }

  /**
   * Configure circuit breaker settings.
   */
  export function configure(newConfig: Partial<Config>): void {
    config = { ...DEFAULT_CONFIG, ...newConfig }
    log.info("configured", { config })
  }

  /**
   * Get the current configuration.
   */
  export function getConfig(): Config {
    return { ...config }
  }

  /**
   * Get or initialize state for a provider.
   */
  function getOrCreateState(providerID: string): ProviderState {
    let state = breakers.get(providerID)
    if (!state) {
      state = {
        state: "closed",
        failures: 0,
        successes: 0,
        halfOpenRequests: 0,
      }
      breakers.set(providerID, state)
    }
    return state
  }

  /**
   * Check if a provider can accept requests.
   *
   * @returns true if requests should be allowed, false if circuit is open
   */
  export async function canUse(providerID: string): Promise<boolean> {
    return withStateLock(() => {
      const state = getOrCreateState(providerID)

      switch (state.state) {
        case "closed":
          return true

        case "open": {
          // Check if timeout has passed to transition to half_open
          if (state.lastFailure && Date.now() - state.lastFailure >= config.timeout) {
            transitionTo(providerID, state, "half_open", "timeout expired")
            return state.halfOpenRequests < config.halfOpenLimit
          }
          return false
        }

        case "half_open":
          // Allow limited requests in half_open
          return state.halfOpenRequests < config.halfOpenLimit
      }
    })
  }

  /**
   * Record a successful request to a provider.
   */
  export async function recordSuccess(providerID: string): Promise<void> {
    await withStateLock(() => {
      const state = getOrCreateState(providerID)

      switch (state.state) {
        case "closed":
          // Reset failure count on success
          state.failures = 0
          break

        case "half_open":
          state.halfOpenRequests = Math.max(0, state.halfOpenRequests - 1)
          state.successes++

          if (state.successes >= config.successThreshold) {
            transitionTo(providerID, state, "closed", "success threshold reached")
          }
          break

        case "open":
          // Shouldn't happen, but handle gracefully
          log.warn("success recorded in open state", { providerID })
          break
      }

      log.info("success", {
        providerID,
        state: state.state,
        successes: state.successes,
        failures: state.failures,
      })
    })
  }

  /**
   * Record a failed request to a provider.
   */
  export async function recordFailure(providerID: string, error: Error): Promise<void> {
    await withStateLock(() => {
      const state = getOrCreateState(providerID)
      state.lastFailure = Date.now()
      state.lastError = error.message

      switch (state.state) {
        case "closed":
          state.failures++

          if (state.failures >= config.failureThreshold) {
            transitionTo(providerID, state, "open", `failure threshold reached: ${error.message}`)
          }
          break

        case "half_open":
          state.halfOpenRequests = Math.max(0, state.halfOpenRequests - 1)
          // Any failure in half_open immediately opens the circuit
          transitionTo(providerID, state, "open", `failure in half_open: ${error.message}`)
          break

        case "open":
          // Already open, just update failure info
          state.failures++
          break
      }

      log.info("failure", {
        providerID,
        state: state.state,
        failures: state.failures,
        error: error.message,
      })
    })
  }

  /**
   * Increment half-open request counter when starting a request.
   */
  export async function startHalfOpenRequest(providerID: string): Promise<void> {
    await withStateLock(() => {
      const state = getOrCreateState(providerID)
      if (state.state === "half_open") {
        state.halfOpenRequests++
      }
    })
  }

  /**
   * Transition to a new state.
   */
  function transitionTo(providerID: string, state: ProviderState, newState: State, reason: string): void {
    const previousState = state.state
    state.state = newState

    // Reset counters on transition
    if (newState === "closed") {
      state.failures = 0
      state.successes = 0
      state.halfOpenRequests = 0
    } else if (newState === "half_open") {
      state.successes = 0
      state.halfOpenRequests = 0
    } else if (newState === "open") {
      state.successes = 0
      state.halfOpenRequests = 0
    }

    log.info("state transition", {
      providerID,
      previousState,
      newState,
      reason,
    })

    Bus.publish(Event.StateChanged, {
      providerID,
      previousState,
      newState,
      reason,
    })
  }

  /**
   * Get the current state for a provider.
   */
  export async function getState(providerID: string): Promise<ProviderState> {
    return withStateLock(() => ({ ...getOrCreateState(providerID) }))
  }

  /**
   * Get all provider states.
   */
  export async function getAllStates(): Promise<Record<string, ProviderState>> {
    return withStateLock(() => {
      const result: Record<string, ProviderState> = {}
      for (const [id, state] of breakers) {
        result[id] = { ...state }
      }
      return result
    })
  }

  /**
   * Reset state for a specific provider.
   */
  export async function reset(providerID: string): Promise<void> {
    await withStateLock(() => {
      breakers.delete(providerID)
      log.info("reset", { providerID })
    })
  }

  /**
   * Reset all circuit breakers.
   */
  export async function resetAll(): Promise<void> {
    await withStateLock(() => {
      breakers.clear()
      log.info("reset all")
    })
  }

  /**
   * Force a provider into a specific state (for testing/admin).
   */
  export async function forceState(providerID: string, newState: State): Promise<void> {
    await withStateLock(() => {
      const state = getOrCreateState(providerID)
      transitionTo(providerID, state, newState, "forced by admin")
    })
  }
}
