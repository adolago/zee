import { BusEvent } from "@/bus/bus-event"
import { Bus } from "@/bus"
import { Instance } from "@/project/instance"
import z from "zod"

export namespace SessionStatus {
  /**
   * Embedding model configuration.
   */
  export const EmbeddingConfig = z.object({
    model: z.string(),
    maxContext: z.number(),
  })
  export type EmbeddingConfig = z.infer<typeof EmbeddingConfig>

  /**
   * Stream health information for busy sessions.
   */
  export const StreamHealth = z.object({
    isStalled: z.boolean(),
    isThinking: z.boolean().optional(), // True when reasoning events are arriving but no text/tool output
    timeSinceLastEventMs: z.number(),
    timeSinceContentMs: z.number().optional(), // Time since last meaningful content (text/tool)
    eventsReceived: z.number(),
    stallWarnings: z.number(),
    phase: z.enum(["starting", "thinking", "tool_calling", "generating"]).optional(),
    charsReceived: z.number().optional(), // Characters received for activity indication
    estimatedTokens: z.number().optional(), // Estimated output tokens (chars/4)
    requestCount: z.number().optional(), // Number of LLM API requests in this session
    embeddingConfig: EmbeddingConfig.optional(), // Current embedding model config
  })
  export type StreamHealth = z.infer<typeof StreamHealth>

  export const Info = z
    .union([
      z.object({
        type: z.literal("idle"),
      }),
      z.object({
        type: z.literal("retry"),
        attempt: z.number(),
        message: z.string(),
        next: z.number(),
      }),
      z.object({
        type: z.literal("busy"),
        streamHealth: StreamHealth.optional(),
      }),
    ])
    .meta({
      ref: "SessionStatus",
    })
  export type Info = z.infer<typeof Info>

  export const Event = {
    Status: BusEvent.define(
      "session.status",
      z.object({
        sessionID: z.string(),
        status: Info,
      }),
    ),
    // deprecated
    Idle: BusEvent.define(
      "session.idle",
      z.object({
        sessionID: z.string(),
      }),
    ),
  }

  const state = Instance.state(() => {
    const data: Record<string, Info> = {}
    return data
  })

  export function get(sessionID: string) {
    return (
      state()[sessionID] ?? {
        type: "idle",
      }
    )
  }

  export function list() {
    return state()
  }

  export function set(sessionID: string, status: Info) {
    Bus.publish(Event.Status, {
      sessionID,
      status,
    })
    if (status.type === "idle") {
      // deprecated
      Bus.publish(Event.Idle, {
        sessionID,
      })
      delete state()[sessionID]
      return
    }
    state()[sessionID] = status
  }
}
