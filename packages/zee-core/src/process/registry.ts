/**
 * Process Registry
 *
 * Centralized registry for managing running agents, swarms, and workers.
 * Uses in-memory Map for fast access with optional Qdrant persistence.
 */

import { EventEmitter } from "events"
import { randomUUID } from "crypto"
import {
  ProcessInfo,
  ProcessRegisterInput,
  ProcessUpdateInput,
  ProcessEvent,
  ProcessEventType,
  ProcessQueryFilter,
  ProcessType,
  ProcessStatus,
  HEARTBEAT_TIMEOUT_MS,
  HEARTBEAT_CHECK_INTERVAL_MS,
} from "./types"
import type { ProcessStats } from "./types"
import { Log } from "../util/log"

const log = Log.create({ service: "process-registry" })

/**
 * Event names emitted by ProcessRegistry
 */
export const ProcessRegistryEvents = {
  Registered: "process:registered",
  Deregistered: "process:deregistered",
  Heartbeat: "process:heartbeat",
  StatusChanged: "process:status_changed",
  Offline: "process:offline",
} as const

/**
 * Process Registry class
 *
 * Manages registration, heartbeats, and status of all running processes.
 */
export class ProcessRegistry extends EventEmitter {
  private processes: Map<string, ProcessInfo> = new Map()
  private heartbeatChecker: ReturnType<typeof setInterval> | null = null
  private static instance: ProcessRegistry | null = null

  private constructor() {
    super()
  }

  /**
   * Get singleton instance
   */
  static getInstance(): ProcessRegistry {
    if (!ProcessRegistry.instance) {
      ProcessRegistry.instance = new ProcessRegistry()
      ProcessRegistry.instance.startHeartbeatChecker()
    }
    return ProcessRegistry.instance
  }

  /**
   * Register a new process
   */
  register(input: ProcessRegisterInput): ProcessInfo {
    const now = Date.now()
    const id = input.id || randomUUID()

    // Check if already registered
    if (this.processes.has(id)) {
      const existing = this.processes.get(id)!
      log.warn("Process already registered, updating", { id, name: existing.name })
      // Preserve existing status to avoid race conditions in task assignment
      // Only update capabilities and metadata, not status
      return this.update(id, {
        capabilities: input.capabilities,
        metadata: input.metadata,
      })!
    }

    const processInfo: ProcessInfo = {
      id,
      type: input.type,
      name: input.name,
      swarmId: input.swarmId,
      parentId: input.parentId,
      capabilities: input.capabilities || [],
      status: "active",
      metadata: input.metadata || {},
      lastHeartbeat: now,
      registeredAt: now,
      host: input.host,
    }

    this.processes.set(id, processInfo)

    log.info("Process registered", {
      id,
      type: input.type,
      name: input.name,
      swarmId: input.swarmId,
    })

    this.emitEvent("registered", id, processInfo)

    return processInfo
  }

  /**
   * Deregister a process
   */
  deregister(id: string): boolean {
    const process = this.processes.get(id)
    if (!process) {
      log.warn("Process not found for deregistration", { id })
      return false
    }

    this.processes.delete(id)

    log.info("Process deregistered", { id, name: process.name })

    this.emitEvent("deregistered", id, process)

    return true
  }

  /**
   * Update process heartbeat
   */
  heartbeat(id: string): ProcessInfo | null {
    const process = this.processes.get(id)
    if (!process) {
      log.warn("Heartbeat for unknown process", { id })
      return null
    }

    const wasOffline = process.status === "offline"
    process.lastHeartbeat = Date.now()

    // If was offline, mark as active
    if (wasOffline) {
      process.status = "active"
      this.emitEvent("status_changed", id, process, { oldStatus: "offline", newStatus: "active" })
    }

    this.emitEvent("heartbeat", id, process)

    return process
  }

  /**
   * Update process info
   */
  update(id: string, input: ProcessUpdateInput): ProcessInfo | null {
    const process = this.processes.get(id)
    if (!process) {
      log.warn("Process not found for update", { id })
      return null
    }

    const oldStatus = process.status

    if (input.status !== undefined) {
      process.status = input.status
    }
    if (input.currentTask !== undefined) {
      process.currentTask = input.currentTask ?? undefined
    }
    if (input.capabilities !== undefined) {
      process.capabilities = input.capabilities
    }
    if (input.metadata !== undefined) {
      process.metadata = { ...process.metadata, ...input.metadata }
    }

    // Update heartbeat on any update
    process.lastHeartbeat = Date.now()

    if (oldStatus !== process.status) {
      this.emitEvent("status_changed", id, process, { oldStatus, newStatus: process.status })
    }

    return process
  }

  /**
   * Get process by ID
   */
  get(id: string): ProcessInfo | null {
    return this.processes.get(id) || null
  }

  /**
   * List all processes with optional filters
   */
  list(filter?: ProcessQueryFilter): ProcessInfo[] {
    let results = Array.from(this.processes.values())

    if (filter) {
      if (filter.type) {
        results = results.filter((p) => p.type === filter.type)
      }
      if (filter.swarmId) {
        results = results.filter((p) => p.swarmId === filter.swarmId)
      }
      if (filter.status) {
        results = results.filter((p) => p.status === filter.status)
      }
      if (filter.parentId) {
        results = results.filter((p) => p.parentId === filter.parentId)
      }
      if (filter.capabilities && filter.capabilities.length > 0) {
        results = results.filter((p) => filter.capabilities!.every((c) => p.capabilities.includes(c)))
      }
    }

    return results
  }

  /**
   * Get processes by swarm ID
   */
  getBySwarm(swarmId: string): ProcessInfo[] {
    return this.list({ swarmId })
  }

  /**
   * Get all swarms
   */
  getSwarms(): ProcessInfo[] {
    return this.list({ type: "swarm" })
  }

  /**
   * Get statistics
   */
  getStats(): ProcessStats {
    const processes = Array.from(this.processes.values())

    const byType: Record<ProcessType, number> = {
      agent: 0,
      swarm: 0,
      worker: 0,
      daemon: 0,
      queen: 0,
    }

    const byStatus: Record<ProcessStatus, number> = {
      active: 0,
      busy: 0,
      idle: 0,
      offline: 0,
      error: 0,
    }

    for (const p of processes) {
      byType[p.type]++
      byStatus[p.status]++
    }

    return {
      total: processes.length,
      byType,
      byStatus,
      swarms: byType.swarm,
      activeAgents: processes.filter((p) => p.type === "agent" && p.status !== "offline").length,
    }
  }

  /**
   * Find available agents with required capabilities
   */
  findAvailable(capabilities: string[] = []): ProcessInfo[] {
    return this.list({
      type: "agent",
      status: "idle",
    }).filter((p) => capabilities.every((c) => p.capabilities.includes(c)))
  }

  /**
   * Start heartbeat checker interval
   */
  private startHeartbeatChecker(): void {
    if (this.heartbeatChecker) return

    this.heartbeatChecker = setInterval(() => {
      this.checkHeartbeats()
    }, HEARTBEAT_CHECK_INTERVAL_MS)

    log.info("Heartbeat checker started", { interval: HEARTBEAT_CHECK_INTERVAL_MS })
  }

  /**
   * Stop heartbeat checker
   */
  stopHeartbeatChecker(): void {
    if (this.heartbeatChecker) {
      clearInterval(this.heartbeatChecker)
      this.heartbeatChecker = null
      log.info("Heartbeat checker stopped")
    }
  }

  /**
   * Check all processes for heartbeat timeout
   */
  private checkHeartbeats(): void {
    const now = Date.now()

    for (const process of this.processes.values()) {
      if (process.status === "offline") continue

      const timeSinceHeartbeat = now - process.lastHeartbeat

      if (timeSinceHeartbeat > HEARTBEAT_TIMEOUT_MS) {
        const oldStatus = process.status
        process.status = "offline"

        log.warn("Process marked offline (heartbeat timeout)", {
          id: process.id,
          name: process.name,
          lastHeartbeat: new Date(process.lastHeartbeat).toISOString(),
          timeout: HEARTBEAT_TIMEOUT_MS,
        })

        this.emitEvent("offline", process.id, process, { oldStatus })
        this.emitEvent("status_changed", process.id, process, { oldStatus, newStatus: "offline" })
      }
    }
  }

  /**
   * Emit a process event
   */
  private emitEvent(type: ProcessEventType, processId: string, process: ProcessInfo, data?: Record<string, any>): void {
    const event: ProcessEvent = {
      type,
      processId,
      process,
      timestamp: Date.now(),
      data,
    }

    this.emit(ProcessRegistryEvents[this.eventTypeToName(type)], event)
    this.emit("event", event) // Generic event for SSE streaming
  }

  /**
   * Convert event type to event name
   */
  private eventTypeToName(type: ProcessEventType): keyof typeof ProcessRegistryEvents {
    const map: Record<ProcessEventType, keyof typeof ProcessRegistryEvents> = {
      registered: "Registered",
      deregistered: "Deregistered",
      heartbeat: "Heartbeat",
      status_changed: "StatusChanged",
      task_assigned: "StatusChanged",
      task_completed: "StatusChanged",
      offline: "Offline",
    }
    return map[type]
  }

  /**
   * Clear all processes (for testing)
   */
  clear(): void {
    this.processes.clear()
    log.info("Process registry cleared")
  }

  /**
   * Shutdown registry
   */
  shutdown(): void {
    this.stopHeartbeatChecker()
    this.clear()
    ProcessRegistry.instance = null
    log.info("Process registry shutdown")
  }
}

/**
 * Get the singleton ProcessRegistry instance
 */
export function getProcessRegistry(): ProcessRegistry {
  return ProcessRegistry.getInstance()
}
