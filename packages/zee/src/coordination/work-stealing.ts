/**
 * Work Stealing Service
 *
 * Provides load balancing between agents/workers by periodically checking
 * workload distribution and suggesting task reassignments.
 *
 * Integrates with:
 * - ProcessRegistry: Tracks active agents and their capabilities
 * - Bus: Emits workstealing:request events for task reassignment
 * - Session: Can be used to balance sessions across workers
 *
 * This is a simplified work-stealing coordinator adapted for the zee daemon context.
 */

import { EventEmitter } from "events"
import { Log } from "../util/log"
import { ProcessRegistry } from "../process/registry"

const log = Log.create({ service: "work-stealing" })

// =============================================================================
// Types
// =============================================================================

export interface WorkStealingConfig {
  /** Enable work stealing */
  enabled: boolean
  /** Minimum task count difference to trigger stealing */
  stealThreshold: number
  /** Maximum tasks to steal at once */
  maxStealBatch: number
  /** How often to check for steal opportunities (ms) */
  checkInterval: number
}

export interface AgentWorkload {
  agentId: string
  taskCount: number
  avgTaskDuration: number
  cpuUsage: number
  memoryUsage: number
  capabilities: string[]
}

export interface WorkStealRequest {
  sourceAgent: string
  targetAgent: string
  taskCount: number
  timestamp: number
}

export interface WorkStealingStats {
  enabled: boolean
  totalAgents: number
  totalTasks: number
  avgTasksPerAgent: number
  imbalance: number
  stealRequests: number
  lastCheck: number | null
  workloads: Record<string, { taskCount: number; avgDuration: number }>
}

// =============================================================================
// Default Configuration
// =============================================================================

const DEFAULT_CONFIG: WorkStealingConfig = {
  enabled: false,
  stealThreshold: 3,
  maxStealBatch: 2,
  checkInterval: 30000, // 30 seconds
}

// =============================================================================
// Work Stealing Service
// =============================================================================

export class WorkStealingService extends EventEmitter {
  private static instance: WorkStealingService | null = null

  private config: WorkStealingConfig
  private workloads = new Map<string, AgentWorkload>()
  private taskDurations = new Map<string, number[]>()
  private checkInterval: ReturnType<typeof setInterval> | null = null
  private stealRequestCount = 0
  private lastCheckTime: number | null = null
  private initialized = false

  private constructor(config?: Partial<WorkStealingConfig>) {
    super()
    this.config = { ...DEFAULT_CONFIG, ...config }
  }

  /**
   * Get singleton instance
   */
  static getInstance(config?: Partial<WorkStealingConfig>): WorkStealingService {
    if (!WorkStealingService.instance) {
      WorkStealingService.instance = new WorkStealingService(config)
    } else if (config) {
      // Update config if provided
      WorkStealingService.instance.config = {
        ...WorkStealingService.instance.config,
        ...config,
      }
    }
    return WorkStealingService.instance
  }

  /**
   * Reset singleton (for testing)
   */
  static reset(): void {
    if (WorkStealingService.instance) {
      WorkStealingService.instance.shutdown()
      WorkStealingService.instance = null
    }
  }

  /**
   * Initialize the service
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      log.debug("Work stealing already initialized")
      return
    }

    if (!this.config.enabled) {
      log.info("Work stealing is disabled")
      return
    }

    log.info("Initializing work stealing service", {
      checkInterval: this.config.checkInterval,
      stealThreshold: this.config.stealThreshold,
      maxStealBatch: this.config.maxStealBatch,
    })

    // Subscribe to process registry events
    const registry = ProcessRegistry.getInstance()
    registry.on("process:registered", (event) => {
      this.updateAgentWorkload(event.process.id, {
        agentId: event.process.id,
        taskCount: 0,
        avgTaskDuration: 0,
        cpuUsage: 0,
        memoryUsage: 0,
        capabilities: event.process.capabilities || [],
      })
    })

    registry.on("process:deregistered", (event) => {
      this.workloads.delete(event.processId)
      this.taskDurations.delete(event.processId)
    })

    // Start periodic checks
    this.checkInterval = setInterval(() => this.checkAndSteal(), this.config.checkInterval)

    this.initialized = true
    log.info("Work stealing service initialized")
  }

  /**
   * Shutdown the service
   */
  shutdown(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval)
      this.checkInterval = null
    }

    this.workloads.clear()
    this.taskDurations.clear()
    this.initialized = false

    log.info("Work stealing service shutdown")
  }

  /**
   * Update workload for an agent
   */
  updateAgentWorkload(agentId: string, workload: Partial<AgentWorkload>): void {
    const existing = this.workloads.get(agentId) || {
      agentId,
      taskCount: 0,
      avgTaskDuration: 0,
      cpuUsage: 0,
      memoryUsage: 0,
      capabilities: [],
    }

    this.workloads.set(agentId, { ...existing, ...workload })
    log.debug("Updated agent workload", { agentId, taskCount: workload.taskCount })
  }

  /**
   * Record task duration for an agent
   */
  recordTaskDuration(agentId: string, durationMs: number): void {
    if (!this.taskDurations.has(agentId)) {
      this.taskDurations.set(agentId, [])
    }

    const durations = this.taskDurations.get(agentId)!
    durations.push(durationMs)

    // Keep only last 100 durations
    if (durations.length > 100) {
      durations.shift()
    }

    // Update average
    const avg = durations.reduce((sum, d) => sum + d, 0) / durations.length
    this.updateAgentWorkload(agentId, { avgTaskDuration: avg })
  }

  /**
   * Check for imbalance and emit steal requests
   */
  async checkAndSteal(): Promise<void> {
    this.lastCheckTime = Date.now()

    const workloads = Array.from(this.workloads.values())
    if (workloads.length < 2) {
      return // Need at least 2 agents
    }

    // Sort by task count (ascending)
    workloads.sort((a, b) => a.taskCount - b.taskCount)

    const minLoaded = workloads[0]
    const maxLoaded = workloads[workloads.length - 1]

    // Check if stealing is warranted
    const difference = maxLoaded.taskCount - minLoaded.taskCount
    if (difference < this.config.stealThreshold) {
      return // Not enough imbalance
    }

    // Calculate how many tasks to steal
    const tasksToSteal = Math.min(
      Math.floor(difference / 2),
      this.config.maxStealBatch
    )

    log.info("Initiating work stealing", {
      from: maxLoaded.agentId,
      to: minLoaded.agentId,
      tasksToSteal,
      difference,
    })

    const request: WorkStealRequest = {
      sourceAgent: maxLoaded.agentId,
      targetAgent: minLoaded.agentId,
      taskCount: tasksToSteal,
      timestamp: Date.now(),
    }

    this.stealRequestCount++
    this.emit("workstealing:request", request)
  }

  /**
   * Get current stats
   */
  getStats(): WorkStealingStats {
    const workloads = Array.from(this.workloads.values())
    let totalTasks = 0
    let minTasks = Infinity
    let maxTasks = 0

    const workloadSummary: Record<string, { taskCount: number; avgDuration: number }> = {}

    for (const workload of workloads) {
      totalTasks += workload.taskCount
      minTasks = Math.min(minTasks, workload.taskCount)
      maxTasks = Math.max(maxTasks, workload.taskCount)

      workloadSummary[workload.agentId] = {
        taskCount: workload.taskCount,
        avgDuration: workload.avgTaskDuration,
      }
    }

    return {
      enabled: this.config.enabled,
      totalAgents: workloads.length,
      totalTasks,
      avgTasksPerAgent: workloads.length > 0 ? totalTasks / workloads.length : 0,
      imbalance: maxTasks - (minTasks === Infinity ? 0 : minTasks),
      stealRequests: this.stealRequestCount,
      lastCheck: this.lastCheckTime,
      workloads: workloadSummary,
    }
  }

  /**
   * Find best agent for a task based on current workloads
   */
  findBestAgent(capabilities: string[] = []): string | null {
    const workloads = Array.from(this.workloads.values())
    if (workloads.length === 0) return null

    // Filter by capabilities if specified
    const candidates = capabilities.length > 0
      ? workloads.filter((w) => capabilities.every((cap) => w.capabilities.includes(cap)))
      : workloads

    if (candidates.length === 0) return null

    // Sort by task count (ascending) and return least loaded
    candidates.sort((a, b) => a.taskCount - b.taskCount)
    return candidates[0].agentId
  }
}

// =============================================================================
// Config Loading
// =============================================================================

/**
 * Load work stealing config from environment and config file
 */
export function loadWorkStealingConfig(): Partial<WorkStealingConfig> {
  const config: Partial<WorkStealingConfig> = {}

  // Environment variable overrides
  const envEnabled = process.env.WORK_STEALING_ENABLED
  if (envEnabled !== undefined) {
    config.enabled = envEnabled === "true" || envEnabled === "1"
  }

  const envThreshold = process.env.WORK_STEALING_THRESHOLD
  if (envThreshold) {
    const parsed = parseInt(envThreshold, 10)
    if (!isNaN(parsed) && parsed > 0) {
      config.stealThreshold = parsed
    }
  }

  const envMaxBatch = process.env.WORK_STEALING_MAX_BATCH
  if (envMaxBatch) {
    const parsed = parseInt(envMaxBatch, 10)
    if (!isNaN(parsed) && parsed > 0) {
      config.maxStealBatch = parsed
    }
  }

  const envInterval = process.env.WORK_STEALING_INTERVAL
  if (envInterval) {
    const parsed = parseInt(envInterval, 10)
    if (!isNaN(parsed) && parsed > 0) {
      config.checkInterval = parsed
    }
  }

  return config
}

// =============================================================================
// Convenience Exports
// =============================================================================

export function getWorkStealingService(): WorkStealingService {
  return WorkStealingService.getInstance()
}

export async function initWorkStealing(config?: Partial<WorkStealingConfig>): Promise<WorkStealingService> {
  const mergedConfig = { ...loadWorkStealingConfig(), ...config }
  const service = WorkStealingService.getInstance(mergedConfig)
  await service.initialize()
  return service
}
