import z from "zod"

export namespace SessionControlTypes {
  export const SendMode = z.enum(["steer", "follow_up"])
  export type SendMode = z.infer<typeof SendMode>

  export const WaitUntil = z.enum(["turn_end", "message_processed"])
  export type WaitUntil = z.infer<typeof WaitUntil>

  export const SenderInfo = z.object({
    sessionID: z.string().min(1),
    sessionName: z.string().min(1).optional(),
  })
  export type SenderInfo = z.infer<typeof SenderInfo>

  export const SendCommand = z.object({
    type: z.literal("send"),
    message: z.string().min(1),
    mode: SendMode.optional(),
    expectedTurnID: z.string().optional(),
    senderInfo: SenderInfo.optional(),
    id: z.string().optional(),
  })

  export const StatusCommand = z.object({
    type: z.literal("status"),
    id: z.string().optional(),
  })

  export const PingCommand = z.object({
    type: z.literal("ping"),
    id: z.string().optional(),
  })

  export const GetMessageCommand = z.object({
    type: z.literal("get_message"),
    id: z.string().optional(),
  })

  export const GetSummaryCommand = z.object({
    type: z.literal("get_summary"),
    id: z.string().optional(),
  })

  export const ClearCommand = z.object({
    type: z.literal("clear"),
    id: z.string().optional(),
  })

  export const AbortCommand = z.object({
    type: z.literal("abort"),
    id: z.string().optional(),
  })

  export const ListSessionsCommand = z.object({
    type: z.literal("list_sessions"),
    id: z.string().optional(),
  })

  export const Command = z.discriminatedUnion("type", [
    SendCommand,
    StatusCommand,
    PingCommand,
    GetMessageCommand,
    GetSummaryCommand,
    ClearCommand,
    AbortCommand,
    ListSessionsCommand,
  ])
  export type Command = z.infer<typeof Command>

  export const Response = z.object({
    type: z.literal("response"),
    command: z.string(),
    success: z.boolean(),
    error: z.string().optional(),
    data: z.unknown().optional(),
    id: z.string().optional(),
  })
  export type Response = z.infer<typeof Response>

  export interface LiveSession {
    sessionID: string
    socketPath: string
    aliases: string[]
    name?: string
    status?: {
      type: "idle" | "busy" | "retry"
      activeTurnID?: string
    }
  }

  export interface LastAssistantMessage {
    id: string
    text: string
    createdAt: number
    completedAt?: number
  }

  export interface SendResult {
    delivered: boolean
    mode: SendMode
    activeTurnID?: string
    waitUntil?: WaitUntil
    message?: LastAssistantMessage | null
  }
}
