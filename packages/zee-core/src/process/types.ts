/**
 * Process Registry Types
 *
 * Types for managing running agents, swarms, and workers
 * as a centralized registry in agent-core.
 */

import { z } from "zod"

/**
 * Process types that can be registered
 */
export const ProcessType = z.enum(["agent", "swarm", "worker", "daemon", "queen"])
export type ProcessType = z.infer<typeof ProcessType>

/**
 * Process status states
 */
export const ProcessStatus = z.enum(["active", "busy", "idle", "offline", "error"])
export type ProcessStatus = z.infer<typeof ProcessStatus>

/**
 * Process information schema
 */
export const ProcessInfo = z.object({
  /** Unique process identifier */
  id: z.string(),

  /** Type of process */
  type: ProcessType,

  /** Human-readable name */
  name: z.string(),

  /** Swarm ID if this process belongs to a swarm */
  swarmId: z.string().optional(),

  /** Parent process ID (e.g., queen for agents) */
  parentId: z.string().optional(),

  /** Process capabilities/skills */
  capabilities: z.array(z.string()).default([]),

  /** Current status */
  status: ProcessStatus.default("idle"),

  /** Current task ID if busy */
  currentTask: z.string().optional(),

  /** Additional metadata */
  metadata: z.record(z.string(), z.any()).default({}),

  /** Last heartbeat timestamp (ms since epoch) */
  lastHeartbeat: z.number(),

  /** Registration timestamp (ms since epoch) */
  registeredAt: z.number(),

  /** Host/origin of the process */
  host: z.string().optional(),
})
export type ProcessInfo = z.infer<typeof ProcessInfo>

/**
 * Input for registering a new process
 */
export const ProcessRegisterInput = z.object({
  id: z.string().optional(), // Auto-generated if not provided
  type: ProcessType,
  name: z.string(),
  swarmId: z.string().optional(),
  parentId: z.string().optional(),
  capabilities: z.array(z.string()).default([]),
  metadata: z.record(z.string(), z.any()).default({}),
  host: z.string().optional(),
})
export type ProcessRegisterInput = z.infer<typeof ProcessRegisterInput>

/**
 * Input for updating process status
 */
export const ProcessUpdateInput = z.object({
  status: ProcessStatus.optional(),
  currentTask: z.string().nullable().optional(),
  capabilities: z.array(z.string()).optional(),
  metadata: z.record(z.string(), z.any()).optional(),
})
export type ProcessUpdateInput = z.infer<typeof ProcessUpdateInput>

/**
 * Process event types for SSE
 */
export const ProcessEventType = z.enum([
  "registered",
  "deregistered",
  "heartbeat",
  "status_changed",
  "task_assigned",
  "task_completed",
  "offline",
])
export type ProcessEventType = z.infer<typeof ProcessEventType>

/**
 * Process event payload
 */
export const ProcessEvent = z.object({
  type: ProcessEventType,
  processId: z.string(),
  process: ProcessInfo.optional(),
  timestamp: z.number(),
  data: z.record(z.string(), z.any()).optional(),
})
export type ProcessEvent = z.infer<typeof ProcessEvent>

/**
 * Process query filters
 */
export const ProcessQueryFilter = z.object({
  type: ProcessType.optional(),
  swarmId: z.string().optional(),
  status: ProcessStatus.optional(),
  capabilities: z.array(z.string()).optional(),
  parentId: z.string().optional(),
})
export type ProcessQueryFilter = z.infer<typeof ProcessQueryFilter>

/**
 * Process statistics
 */
export interface ProcessStats {
  total: number
  byType: Record<ProcessType, number>
  byStatus: Record<ProcessStatus, number>
  swarms: number
  activeAgents: number
}

/**
 * Heartbeat timeout in milliseconds (60 seconds)
 */
export const HEARTBEAT_TIMEOUT_MS = 60_000

/**
 * Heartbeat check interval in milliseconds (10 seconds)
 */
export const HEARTBEAT_CHECK_INTERVAL_MS = 10_000
