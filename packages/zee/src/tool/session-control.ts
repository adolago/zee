import z from "zod"
import { Tool } from "./tool"
import { SessionControlClient, SessionControlError } from "@/session-control/client"
import { SessionControlTypes } from "@/session-control/types"
import { Session } from "@/session"

export const ListSessionsTool = Tool.define("list_sessions", {
  description: "List live sessions that currently expose a session-control socket",
  parameters: z.object({}),
  async execute(_params, ctx) {
    await ctx.ask({
      permission: "list_sessions",
      patterns: ["*"],
      always: ["*"],
      metadata: {},
    })

    const sessions = await SessionControlClient.list()
    return {
      title: `${sessions.length} sessions`,
      output: JSON.stringify(sessions, null, 2),
      metadata: { sessions },
    }
  },
})

const SendToSessionInput = z
  .object({
    sessionID: z.string().optional().describe("Target session id"),
    sessionName: z.string().optional().describe("Target session alias/name"),
    action: z
      .enum(["send", "get_message", "get_summary", "clear", "abort"])
      .default("send")
      .describe("Action to perform"),
    message: z.string().optional().describe("Message to deliver to the target session"),
    mode: z.enum(["steer", "follow_up"]).optional().describe("Delivery mode"),
    wait_until: SessionControlTypes.WaitUntil.optional().describe("Wait behavior for send action"),
    expectedTurnID: z.string().optional().describe("Optional expected active turn id for steer mode"),
    include_sender_info: z.boolean().optional().describe("Whether to include sender metadata in the delivered text"),
  })
  .refine((v) => Boolean(v.sessionID || v.sessionName), {
    message: "sessionID or sessionName is required",
    path: ["sessionID"],
  })
  .superRefine((v, ctx) => {
    if (v.action === "send" && (!v.message || v.message.trim().length === 0)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "message is required for action=send",
        path: ["message"],
      })
    }

    if (v.action !== "send" && v.wait_until) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "wait_until is only valid for action=send",
        path: ["wait_until"],
      })
    }

    if (v.action !== "send" && v.include_sender_info !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "include_sender_info is only valid for action=send",
        path: ["include_sender_info"],
      })
    }
  })

async function buildSenderInfo(
  ctx: Tool.Context,
  includeSenderInfo?: boolean,
): Promise<SessionControlTypes.SenderInfo | undefined> {
  if (includeSenderInfo === false) return undefined

  const senderInfo: SessionControlTypes.SenderInfo = {
    sessionID: ctx.sessionID,
  }

  try {
    const senderSession = await Session.get(ctx.sessionID)
    if (senderSession.slug) {
      senderInfo.sessionName = senderSession.slug
    }
  } catch {
    // ignore sender session lookup failures
  }

  return senderInfo
}

type SendToSessionMetadata = {
  action: "send" | "get_message" | "get_summary" | "clear" | "abort"
  message: SessionControlTypes.LastAssistantMessage | null
  summary?: string
  cleared?: boolean
  removedMessages?: number
  removedParts?: number
  aborted?: boolean
  wasBusy?: boolean
  status?: SessionControlTypes.LiveSession["status"]
  delivered?: boolean
  mode?: SessionControlTypes.SendMode
  activeTurnID?: string
  waitUntil?: SessionControlTypes.WaitUntil
}

export const SendToSessionTool = Tool.define<typeof SendToSessionInput, SendToSessionMetadata>("send_to_session", {
  description: "Send a message to another live session, or fetch its last assistant message",
  parameters: SendToSessionInput,
  async execute(params, ctx) {
    const target = params.sessionID ?? params.sessionName ?? "*"
    await ctx.ask({
      permission: "send_to_session",
      patterns: [target],
      always: ["*"],
      metadata: {
        action: params.action,
        target,
        mode: params.mode ?? "steer",
        waitUntil: params.wait_until,
      },
    })

    try {
      if (params.action === "get_message") {
        const result = await SessionControlClient.getMessage({
          sessionID: params.sessionID,
          sessionName: params.sessionName,
        })

        return {
          title: result.message ? "message fetched" : "no message",
          output: JSON.stringify(result, null, 2),
          metadata: {
            action: "get_message" as const,
            message: result.message,
          },
        }
      }

      if (params.action === "get_summary") {
        const result = await SessionControlClient.getSummary({
          sessionID: params.sessionID,
          sessionName: params.sessionName,
        })

        return {
          title: "summary fetched",
          output: JSON.stringify(result, null, 2),
          metadata: {
            action: "get_summary" as const,
            message: null,
            summary: result.summary,
          },
        }
      }

      if (params.action === "clear") {
        const result = await SessionControlClient.clear({
          sessionID: params.sessionID,
          sessionName: params.sessionName,
        })

        return {
          title: "session cleared",
          output: JSON.stringify(result, null, 2),
          metadata: {
            action: "clear" as const,
            message: null,
            ...result,
          },
        }
      }

      if (params.action === "abort") {
        const result = await SessionControlClient.abort({
          sessionID: params.sessionID,
          sessionName: params.sessionName,
        })

        return {
          title: "session aborted",
          output: JSON.stringify(result, null, 2),
          metadata: {
            action: "abort" as const,
            message: null,
            ...result,
          },
        }
      }

      const message = params.message?.trim()
      if (!message) {
        throw new Error("message is required for action=send")
      }

      const senderInfo = await buildSenderInfo(ctx, params.include_sender_info)
      const result = await SessionControlClient.send({
        sessionID: params.sessionID,
        sessionName: params.sessionName,
        message,
        mode: params.mode,
        expectedTurnID: params.expectedTurnID,
        waitUntil: params.wait_until,
        senderInfo,
      })

      return {
        title: result.waitUntil ? `sent (${result.mode}) + ${result.waitUntil}` : `sent (${result.mode})`,
        output: JSON.stringify(result, null, 2),
        metadata: {
          action: "send" as const,
          ...result,
          message: result.message ?? null,
        },
      }
    } catch (error) {
      if (error instanceof SessionControlError) {
        throw new Error(error.message)
      }
      throw error
    }
  },
})
