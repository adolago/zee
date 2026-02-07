/**
 * Process Registry API Routes
 *
 * HTTP API for managing the centralized process registry.
 */

import { Hono } from "hono"
import { describeRoute, resolver, validator } from "hono-openapi"
import { z } from "zod"
import { streamSSE } from "hono/streaming"
import {
  ProcessInfo,
  ProcessRegisterInput,
  ProcessUpdateInput,
  ProcessQueryFilter,
  ProcessType,
  ProcessStatus,
} from "../../process/types"
import { getProcessRegistry, ProcessRegistryEvents } from "../../process/registry"
import { getWorkStealingService, getConsensusGate } from "../../coordination"
import { errors } from "../error"
import { Log } from "../../util/log"
import { SseLimit } from "../sse-limit"
import { registerSseKeepalive } from "../sse-keepalive"

const log = Log.create({ service: "server:process" })

export const ProcessRoute = new Hono()
  // Register a new process
  .post(
    "/process/register",
    describeRoute({
      summary: "Register process",
      description: "Register a new agent, swarm, worker, or daemon process with the central registry.",
      operationId: "process.register",
      tags: ["Process"],
      responses: {
        200: {
          description: "Successfully registered process",
          content: {
            "application/json": {
              schema: resolver(ProcessInfo),
            },
          },
        },
        ...errors(400),
      },
    }),
    validator("json", ProcessRegisterInput),
    async (c) => {
      const input = c.req.valid("json")
      const registry = getProcessRegistry()
      const process = registry.register(input)
      return c.json(process)
    },
  )

  // List all processes
  .get(
    "/process",
    describeRoute({
      summary: "List processes",
      description: "Get a list of all registered processes with optional filters.",
      operationId: "process.list",
      tags: ["Process"],
      responses: {
        200: {
          description: "List of processes",
          content: {
            "application/json": {
              schema: resolver(ProcessInfo.array()),
            },
          },
        },
      },
    }),
    validator(
      "query",
      z.object({
        type: ProcessType.optional(),
        swarmId: z.string().optional(),
        status: ProcessStatus.optional(),
        parentId: z.string().optional(),
      }),
    ),
    async (c) => {
      const filter = c.req.valid("query")
      const registry = getProcessRegistry()
      const processes = registry.list(filter as ProcessQueryFilter)
      return c.json(processes)
    },
  )

  // Get process statistics
  .get(
    "/process/stats",
    describeRoute({
      summary: "Get process statistics",
      description: "Get statistics about registered processes by type and status.",
      operationId: "process.stats",
      tags: ["Process"],
      responses: {
        200: {
          description: "Process statistics",
          content: {
            "application/json": {
              schema: resolver(
                z.object({
                  total: z.number(),
                  byType: z.record(ProcessType, z.number()),
                  byStatus: z.record(ProcessStatus, z.number()),
                  swarms: z.number(),
                  activeAgents: z.number(),
                }),
              ),
            },
          },
        },
      },
    }),
    async (c) => {
      const registry = getProcessRegistry()
      const stats = registry.getStats()
      return c.json(stats)
    },
  )

  // SSE stream for process events
  .get(
    "/process/events",
    describeRoute({
      summary: "Process events stream (SSE)",
      description: "Subscribe to real-time process events via Server-Sent Events.",
      operationId: "process.events",
      tags: ["Process"],
      responses: {
        200: {
          description: "Event stream (text/event-stream)",
        },
      },
    }),
    async (c) => {
      const slot = SseLimit.acquire(c.req.raw)
      if (!slot.ok) {
        return c.json({ error: slot.error }, slot.status)
      }

      try {
        return streamSSE(c, async (stream) => {
          const unregisterKeepalive = registerSseKeepalive(stream)

          try {
            const registry = getProcessRegistry()

            const handler = async (event: any) => {
              try {
                await stream.writeSSE({
                  event: event.type,
                  data: JSON.stringify(event),
                })
              } catch (err) {
                log.error("SSE write error", { error: err })
              }
            }

            // Subscribe to all events
            registry.on("event", handler)

            // Send initial connected event with current stats
            await stream.writeSSE({
              event: "connected",
              data: JSON.stringify({
                timestamp: Date.now(),
                stats: registry.getStats(),
              }),
            })

            stream.onAbort(() => {
              slot.release()
              unregisterKeepalive()
              registry.off("event", handler)
            })

            // Keep stream open
            await new Promise(() => {})
          } catch (err) {
            unregisterKeepalive()
            throw err
          }
        })
      } catch (err) {
        slot.release()
        throw err
      }
    },
  )

  // Get processes by swarm
  .get(
    "/process/swarm/:swarmId",
    describeRoute({
      summary: "Get swarm processes",
      description: "Get all processes belonging to a specific swarm.",
      operationId: "process.bySwarm",
      tags: ["Process"],
      responses: {
        200: {
          description: "List of processes in swarm",
          content: {
            "application/json": {
              schema: resolver(ProcessInfo.array()),
            },
          },
        },
      },
    }),
    validator("param", z.object({ swarmId: z.string() })),
    async (c) => {
      const { swarmId } = c.req.valid("param")
      const registry = getProcessRegistry()
      const processes = registry.getBySwarm(swarmId)
      return c.json(processes)
    },
  )

  // Find available agents with capabilities
  .post(
    "/process/find-available",
    describeRoute({
      summary: "Find available agents",
      description: "Find idle agents with specific capabilities.",
      operationId: "process.findAvailable",
      tags: ["Process"],
      responses: {
        200: {
          description: "List of available agents",
          content: {
            "application/json": {
              schema: resolver(ProcessInfo.array()),
            },
          },
        },
      },
    }),
    validator(
      "json",
      z.object({
        capabilities: z.array(z.string()).optional(),
      }),
    ),
    async (c) => {
      const { capabilities } = c.req.valid("json")
      const registry = getProcessRegistry()
      const agents = registry.findAvailable(capabilities)
      return c.json(agents)
    },
  )

  // Get specific process
  .get(
    "/process/:id",
    describeRoute({
      summary: "Get process",
      description: "Get detailed information about a specific process.",
      operationId: "process.get",
      tags: ["Process"],
      responses: {
        200: {
          description: "Process information",
          content: {
            "application/json": {
              schema: resolver(ProcessInfo),
            },
          },
        },
        ...errors(404),
      },
    }),
    validator("param", z.object({ id: z.string() })),
    async (c) => {
      const { id } = c.req.valid("param")
      const registry = getProcessRegistry()
      const process = registry.get(id)

      if (!process) {
        return c.json({ error: "Process not found" }, 404)
      }

      return c.json(process)
    },
  )

  // Update process heartbeat
  .post(
    "/process/:id/heartbeat",
    describeRoute({
      summary: "Process heartbeat",
      description: "Update the heartbeat timestamp for a process to indicate it's still alive.",
      operationId: "process.heartbeat",
      tags: ["Process"],
      responses: {
        200: {
          description: "Heartbeat updated",
          content: {
            "application/json": {
              schema: resolver(ProcessInfo),
            },
          },
        },
        ...errors(404),
      },
    }),
    validator("param", z.object({ id: z.string() })),
    async (c) => {
      const { id } = c.req.valid("param")
      const registry = getProcessRegistry()
      const process = registry.heartbeat(id)

      if (!process) {
        return c.json({ error: "Process not found" }, 404)
      }

      return c.json(process)
    },
  )

  // Update process status/info
  .patch(
    "/process/:id",
    describeRoute({
      summary: "Update process",
      description: "Update process status, current task, or other information.",
      operationId: "process.update",
      tags: ["Process"],
      responses: {
        200: {
          description: "Process updated",
          content: {
            "application/json": {
              schema: resolver(ProcessInfo),
            },
          },
        },
        ...errors(400, 404),
      },
    }),
    validator("param", z.object({ id: z.string() })),
    validator("json", ProcessUpdateInput),
    async (c) => {
      const { id } = c.req.valid("param")
      const input = c.req.valid("json")
      const registry = getProcessRegistry()
      const process = registry.update(id, input)

      if (!process) {
        return c.json({ error: "Process not found" }, 404)
      }

      return c.json(process)
    },
  )

  // Deregister process
  .delete(
    "/process/:id",
    describeRoute({
      summary: "Deregister process",
      description: "Remove a process from the registry.",
      operationId: "process.deregister",
      tags: ["Process"],
      responses: {
        200: {
          description: "Process deregistered",
          content: {
            "application/json": {
              schema: resolver(z.boolean()),
            },
          },
        },
        ...errors(404),
      },
    }),
    validator("param", z.object({ id: z.string() })),
    async (c) => {
      const { id } = c.req.valid("param")
      const registry = getProcessRegistry()
      const success = registry.deregister(id)

      if (!success) {
        return c.json({ error: "Process not found" }, 404)
      }

      return c.json(true)
    },
  )

  // =========================================================================
  // Work Stealing Endpoints
  // =========================================================================

  // Get work stealing stats
  .get(
    "/process/workstealing/stats",
    describeRoute({
      summary: "Get work stealing statistics",
      description: "Get current work stealing service statistics including workload distribution.",
      operationId: "process.workstealing.stats",
      tags: ["Process", "WorkStealing"],
      responses: {
        200: {
          description: "Work stealing statistics",
          content: {
            "application/json": {
              schema: resolver(
                z.object({
                  enabled: z.boolean(),
                  totalAgents: z.number(),
                  totalTasks: z.number(),
                  avgTasksPerAgent: z.number(),
                  imbalance: z.number(),
                  stealRequests: z.number(),
                  lastCheck: z.number().nullable(),
                  workloads: z.record(
                    z.string(),
                    z.object({
                      taskCount: z.number(),
                      avgDuration: z.number(),
                    }),
                  ),
                }),
              ),
            },
          },
        },
      },
    }),
    async (c) => {
      try {
        const service = getWorkStealingService()
        const stats = service.getStats()
        return c.json(stats)
      } catch {
        return c.json({
          enabled: false,
          totalAgents: 0,
          totalTasks: 0,
          avgTasksPerAgent: 0,
          imbalance: 0,
          stealRequests: 0,
          lastCheck: null,
          workloads: {},
        })
      }
    },
  )

  // Update agent workload
  .post(
    "/process/workstealing/workload",
    describeRoute({
      summary: "Update agent workload",
      description: "Update the workload metrics for an agent for load balancing.",
      operationId: "process.workstealing.updateWorkload",
      tags: ["Process", "WorkStealing"],
      responses: {
        200: {
          description: "Workload updated",
          content: {
            "application/json": {
              schema: resolver(z.object({ success: z.boolean() })),
            },
          },
        },
      },
    }),
    validator(
      "json",
      z.object({
        agentId: z.string(),
        taskCount: z.number().optional(),
        avgTaskDuration: z.number().optional(),
        cpuUsage: z.number().optional(),
        memoryUsage: z.number().optional(),
        capabilities: z.array(z.string()).optional(),
      }),
    ),
    async (c) => {
      const workload = c.req.valid("json")
      try {
        const service = getWorkStealingService()
        service.updateAgentWorkload(workload.agentId, workload)
        return c.json({ success: true })
      } catch {
        return c.json({ success: false })
      }
    },
  )

  // Record task duration
  .post(
    "/process/workstealing/task-duration",
    describeRoute({
      summary: "Record task duration",
      description: "Record the duration of a completed task for workload estimation.",
      operationId: "process.workstealing.recordDuration",
      tags: ["Process", "WorkStealing"],
      responses: {
        200: {
          description: "Duration recorded",
          content: {
            "application/json": {
              schema: resolver(z.object({ success: z.boolean() })),
            },
          },
        },
      },
    }),
    validator(
      "json",
      z.object({
        agentId: z.string(),
        durationMs: z.number(),
      }),
    ),
    async (c) => {
      const { agentId, durationMs } = c.req.valid("json")
      try {
        const service = getWorkStealingService()
        service.recordTaskDuration(agentId, durationMs)
        return c.json({ success: true })
      } catch {
        return c.json({ success: false })
      }
    },
  )

  // Find best agent for task
  .post(
    "/process/workstealing/find-best",
    describeRoute({
      summary: "Find best agent for task",
      description: "Find the least loaded agent with matching capabilities.",
      operationId: "process.workstealing.findBest",
      tags: ["Process", "WorkStealing"],
      responses: {
        200: {
          description: "Best agent ID or null",
          content: {
            "application/json": {
              schema: resolver(
                z.object({
                  agentId: z.string().nullable(),
                }),
              ),
            },
          },
        },
      },
    }),
    validator(
      "json",
      z.object({
        capabilities: z.array(z.string()).optional(),
      }),
    ),
    async (c) => {
      const { capabilities } = c.req.valid("json")
      try {
        const service = getWorkStealingService()
        const agentId = service.findBestAgent(capabilities)
        return c.json({ agentId })
      } catch {
        return c.json({ agentId: null })
      }
    },
  )

  // =========================================================================
  // Consensus Gate Endpoints
  // =========================================================================

  // Get consensus stats
  .get(
    "/process/consensus/stats",
    describeRoute({
      summary: "Get consensus gate statistics",
      description: "Get current consensus gate statistics including approval/rejection counts.",
      operationId: "process.consensus.stats",
      tags: ["Process", "Consensus"],
      responses: {
        200: {
          description: "Consensus statistics",
          content: {
            "application/json": {
              schema: resolver(
                z.object({
                  enabled: z.boolean(),
                  mode: z.string(),
                  totalProposals: z.number(),
                  approved: z.number(),
                  rejected: z.number(),
                  pending: z.number(),
                  voterCount: z.number(),
                }),
              ),
            },
          },
        },
      },
    }),
    async (c) => {
      try {
        const gate = getConsensusGate()
        const stats = gate.getStats()
        return c.json(stats)
      } catch {
        return c.json({
          enabled: false,
          mode: "auto",
          totalProposals: 0,
          approved: 0,
          rejected: 0,
          pending: 0,
          voterCount: 0,
        })
      }
    },
  )

  // Submit a proposal for approval
  .post(
    "/process/consensus/propose",
    describeRoute({
      summary: "Submit proposal for consensus",
      description: "Submit an action for approval through the consensus gate.",
      operationId: "process.consensus.propose",
      tags: ["Process", "Consensus"],
      responses: {
        200: {
          description: "Decision result",
          content: {
            "application/json": {
              schema: resolver(
                z.object({
                  proposalId: z.string(),
                  approved: z.boolean(),
                  reason: z.string(),
                  mode: z.string(),
                }),
              ),
            },
          },
        },
      },
    }),
    validator(
      "json",
      z.object({
        type: z.string(),
        description: z.string(),
        content: z.unknown(),
        proposer: z.string().optional(),
        metadata: z.record(z.string(), z.unknown()).optional(),
      }),
    ),
    async (c) => {
      const input = c.req.valid("json")
      try {
        const gate = getConsensusGate()
        const decision = await gate.propose({
          type: input.type as any,
          description: input.description,
          content: input.content,
          proposer: input.proposer ?? "api",
          metadata: input.metadata,
        })
        return c.json({
          proposalId: decision.proposalId,
          approved: decision.approved,
          reason: decision.reason,
          mode: decision.mode,
        })
      } catch (error) {
        return c.json({
          proposalId: "",
          approved: false,
          reason: error instanceof Error ? error.message : "Unknown error",
          mode: "error",
        })
      }
    },
  )

  // Register a voter
  .post(
    "/process/consensus/voter",
    describeRoute({
      summary: "Register a voter",
      description: "Register an agent as a voter for consensus decisions.",
      operationId: "process.consensus.registerVoter",
      tags: ["Process", "Consensus"],
      responses: {
        200: {
          description: "Voter registered",
          content: {
            "application/json": {
              schema: resolver(z.object({ success: z.boolean() })),
            },
          },
        },
      },
    }),
    validator(
      "json",
      z.object({
        id: z.string(),
        name: z.string(),
        capabilities: z.array(z.string()).optional(),
      }),
    ),
    async (c) => {
      const { id, name, capabilities } = c.req.valid("json")
      try {
        const gate = getConsensusGate()
        gate.registerVoter(id, name, capabilities)
        return c.json({ success: true })
      } catch {
        return c.json({ success: false })
      }
    },
  )

  // Cast a vote
  .post(
    "/process/consensus/vote",
    describeRoute({
      summary: "Cast a vote",
      description: "Cast a vote on a pending proposal.",
      operationId: "process.consensus.vote",
      tags: ["Process", "Consensus"],
      responses: {
        200: {
          description: "Vote recorded",
          content: {
            "application/json": {
              schema: resolver(z.object({ success: z.boolean() })),
            },
          },
        },
      },
    }),
    validator(
      "json",
      z.object({
        proposalId: z.string(),
        voterId: z.string(),
        approved: z.boolean(),
        confidence: z.number().optional(),
        reason: z.string().optional(),
      }),
    ),
    async (c) => {
      const { proposalId, voterId, approved, confidence, reason } = c.req.valid("json")
      try {
        const gate = getConsensusGate()
        const success = gate.vote(proposalId, voterId, approved, { confidence, reason })
        return c.json({ success })
      } catch {
        return c.json({ success: false })
      }
    },
  )

  // Get decision history
  .get(
    "/process/consensus/history",
    describeRoute({
      summary: "Get decision history",
      description: "Get recent consensus decision history.",
      operationId: "process.consensus.history",
      tags: ["Process", "Consensus"],
      responses: {
        200: {
          description: "Decision history",
          content: {
            "application/json": {
              schema: resolver(
                z.array(
                  z.object({
                    proposalId: z.string(),
                    approved: z.boolean(),
                    mode: z.string(),
                    decidedAt: z.number(),
                    reason: z.string(),
                  }),
                ),
              ),
            },
          },
        },
      },
    }),
    validator(
      "query",
      z.object({
        limit: z.coerce.number().optional().default(100),
      }),
    ),
    async (c) => {
      const { limit } = c.req.valid("query")
      try {
        const gate = getConsensusGate()
        const history = gate.getDecisionHistory(limit)
        return c.json(
          history.map((d) => ({
            proposalId: d.proposalId,
            approved: d.approved,
            mode: d.mode,
            decidedAt: d.decidedAt,
            reason: d.reason,
          })),
        )
      } catch {
        return c.json([])
      }
    },
  )
