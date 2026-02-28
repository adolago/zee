import { Hono } from "hono"
import { describeRoute, validator } from "hono-openapi"
import { z } from "zod"
import { streamSSE } from "hono/streaming"
import { streamText, jsonSchema, type ModelMessage, type ToolSet } from "ai"
import { Provider } from "../../provider/provider"
import { Log } from "../../util/log"
import { Fallback } from "../../provider/fallback"

const log = Log.create({ service: "server:llm" })

// -----------------------------------------------------------------------------
// Input schemas (intentionally permissive: this is an internal bridge surface).
// -----------------------------------------------------------------------------

const ThinkingLevelSchema = z.enum(["minimal", "low", "medium", "high", "xhigh"])

const PiToolSchema = z
  .object({
    name: z.string(),
    description: z.string().optional(),
    // TypeBox schemas are JSONSchema-shaped objects; accept unknown and pass through.
    parameters: z.any(),
  })
  .passthrough()

const PiContextSchema = z
  .object({
    systemPrompt: z.string().optional(),
    messages: z.array(z.any()),
    tools: z.array(PiToolSchema).optional(),
  })
  .passthrough()

const PiStreamOptionsSchema = z
  .object({
    temperature: z.number().optional(),
    maxTokens: z.number().optional(),
    reasoning: ThinkingLevelSchema.optional(),
    cacheRetention: z.enum(["none", "short", "long"]).optional(),
    sessionId: z.string().optional(),
    headers: z.record(z.string(), z.string()).optional(),
    toolChoice: z.any().optional(),
    maxRetryDelayMs: z.number().optional(),
    // Ignore provider API keys at this boundary; Zee owns auth.
    apiKey: z.string().optional(),
  })
  .passthrough()

const FallbackRuleSchema = z.object({
  condition: z.enum(["rate_limit", "unavailable", "timeout", "error", "circuit_open", "any"]),
  fallbacks: z.array(z.string()),
})

const LlmFallbackSchema = z
  .object({
    enabled: z.boolean().optional(),
    maxAttempts: z.number().int().positive().optional(),
    rules: z.array(FallbackRuleSchema).optional(),
    costAware: z.boolean().optional(),
    notifyOnFallback: z.boolean().optional(),
    skipFallback: z.boolean().optional(),
  })
  .passthrough()

const LlmStreamInputSchema = z
  .object({
    provider: z.string(),
    model: z.string(),
    // pi-ai api identifier (e.g. "openai-responses", "anthropic-messages")
    api: z.string().optional(),
    context: PiContextSchema,
    options: PiStreamOptionsSchema.optional(),
    fallback: LlmFallbackSchema.optional(),
  })
  .passthrough()

type PiStreamInput = z.infer<typeof LlmStreamInputSchema>

// -----------------------------------------------------------------------------
// pi-ai -> AI SDK prompt conversion
// -----------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value)
}

function truncateString(input: string, maxLen: number): string {
  if (input.length <= maxLen) return input
  return input.slice(0, Math.max(0, maxLen - 1)) + "…"
}

function describeProviderError(err: unknown): string {
  if (err instanceof Error) {
    const anyErr = err as any
    const statusCode = typeof anyErr?.statusCode === "number" ? anyErr.statusCode : undefined
    const url = typeof anyErr?.url === "string" ? anyErr.url : undefined
    const responseBody = typeof anyErr?.responseBody === "string" ? anyErr.responseBody : undefined
    const parts: string[] = [err.message || "Error"]
    if (statusCode) parts.push(`status=${statusCode}`)
    if (url) parts.push(`url=${url}`)
    if (responseBody) parts.push(`responseBody=${truncateString(responseBody.trim(), 800)}`)
    return parts.join(" | ")
  }
  if (typeof err === "string") return err
  try {
    return JSON.stringify(err)
  } catch {
    return String(err)
  }
}

function toUserContent(content: unknown): string | Array<any> {
  if (typeof content === "string") return content
  if (!Array.isArray(content)) return ""
  const parts: any[] = []
  for (const item of content) {
    if (!isRecord(item)) continue
    const type = String(item.type ?? "")
    if (type === "text") {
      const text = typeof item.text === "string" ? item.text : ""
      parts.push({ type: "text", text })
    } else if (type === "image") {
      const data = typeof item.data === "string" ? item.data : ""
      const mediaType =
        typeof item.mimeType === "string"
          ? item.mimeType
          : typeof item.mediaType === "string"
            ? item.mediaType
            : undefined
      parts.push({ type: "image", image: data, ...(mediaType ? { mediaType } : {}) })
    }
  }
  // If we only have text parts, allow the model to treat it as plain string.
  if (parts.every((p) => p.type === "text")) {
    return parts.map((p) => p.text).join("")
  }
  return parts
}

function toAssistantContent(content: unknown): string | Array<any> {
  if (typeof content === "string") return content
  if (!Array.isArray(content)) return ""
  const parts: any[] = []
  for (const item of content) {
    if (!isRecord(item)) continue
    const type = String(item.type ?? "")
    if (type === "text") {
      parts.push({ type: "text", text: typeof item.text === "string" ? item.text : "" })
    } else if (type === "thinking") {
      parts.push({ type: "reasoning", text: typeof item.thinking === "string" ? item.thinking : "" })
    } else if (type === "toolCall") {
      const id = typeof item.id === "string" ? item.id : ""
      const name = typeof item.name === "string" ? item.name : ""
      const args = isRecord(item.arguments) ? item.arguments : {}
      parts.push({ type: "tool-call", toolCallId: id, toolName: name, input: args, providerExecuted: false })
    }
  }
  // If tool-call/reasoning are absent, we can treat as plain string.
  if (parts.every((p) => p.type === "text")) {
    return parts.map((p) => p.text).join("")
  }
  return parts
}

function toToolResultOutput(content: unknown): any {
  if (!Array.isArray(content)) {
    return { type: "text", value: typeof content === "string" ? content : "" }
  }
  const value: any[] = []
  for (const item of content) {
    if (!isRecord(item)) continue
    const type = String(item.type ?? "")
    if (type === "text") {
      value.push({ type: "text", text: typeof item.text === "string" ? item.text : "" })
    } else if (type === "image") {
      const data = typeof item.data === "string" ? item.data : ""
      const mediaType =
        typeof item.mimeType === "string"
          ? item.mimeType
          : typeof item.mediaType === "string"
            ? item.mediaType
            : "application/octet-stream"
      value.push({ type: "image-data", data, mediaType })
    }
  }
  // If we produced no structured parts, fall back to text.
  if (value.length === 0) return { type: "text", value: "" }
  return { type: "content", value }
}

function toModelMessages(piMessages: unknown[]): ModelMessage[] {
  const out: ModelMessage[] = []

  for (const msg of piMessages) {
    if (!isRecord(msg)) continue
    const role = String(msg.role ?? "")

    if (role === "user") {
      out.push({ role: "user", content: toUserContent(msg.content) } as ModelMessage)
      continue
    }

    if (role === "assistant") {
      out.push({ role: "assistant", content: toAssistantContent(msg.content) } as ModelMessage)
      continue
    }

    // pi-ai uses role "toolResult"; AI SDK uses role "tool" with tool-result parts.
    if (role === "toolResult") {
      const toolCallId = typeof msg.toolCallId === "string" ? msg.toolCallId : ""
      const toolName = typeof msg.toolName === "string" ? msg.toolName : ""
      out.push({
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId,
            toolName,
            output: toToolResultOutput(msg.content),
          },
        ],
      } as ModelMessage)
      continue
    }

    // If the caller already sent AI SDK compatible messages, pass through the known roles.
    if (role === "tool") {
      out.push(msg as unknown as ModelMessage)
      continue
    }
  }

  return out
}

function toToolSet(piTools: PiStreamInput["context"]["tools"]): ToolSet | undefined {
  if (!piTools || piTools.length === 0) return undefined
  const tools: Record<string, any> = {}
  for (const toolDef of piTools) {
    const name = String(toolDef.name ?? "").trim()
    if (!name) continue
    tools[name] = {
      description: typeof toolDef.description === "string" ? toolDef.description : undefined,
      // IMPORTANT: no `execute` - we only want tool calls, not tool execution.
      inputSchema: jsonSchema(toolDef.parameters ?? { type: "object", properties: {} }),
    }
  }
  return tools as ToolSet
}

// -----------------------------------------------------------------------------
// AI SDK -> pi-ai streaming event mapping
// -----------------------------------------------------------------------------

type PiAssistantMessage = {
  role: "assistant"
  content: Array<
    | { type: "text"; text: string }
    | { type: "thinking"; thinking: string }
    | { type: "toolCall"; id: string; name: string; arguments: Record<string, any> }
  >
  api: string
  provider: string
  model: string
  usage: {
    input: number
    output: number
    cacheRead: number
    cacheWrite: number
    totalTokens: number
    cost: {
      input: number
      output: number
      cacheRead: number
      cacheWrite: number
      total: number
    }
  }
  stopReason: "stop" | "length" | "toolUse" | "error" | "aborted"
  errorMessage?: string
  timestamp: number
}

type PiAssistantMessageEvent =
  | { type: "start"; partial: PiAssistantMessage }
  | { type: "text_start"; contentIndex: number; partial: PiAssistantMessage }
  | { type: "text_delta"; contentIndex: number; delta: string; partial: PiAssistantMessage }
  | { type: "text_end"; contentIndex: number; content: string; partial: PiAssistantMessage }
  | { type: "thinking_start"; contentIndex: number; partial: PiAssistantMessage }
  | { type: "thinking_delta"; contentIndex: number; delta: string; partial: PiAssistantMessage }
  | { type: "thinking_end"; contentIndex: number; content: string; partial: PiAssistantMessage }
  | { type: "toolcall_start"; contentIndex: number; partial: PiAssistantMessage }
  | { type: "toolcall_delta"; contentIndex: number; delta: string; partial: PiAssistantMessage }
  | {
      type: "toolcall_end"
      contentIndex: number
      toolCall: { type: "toolCall"; id: string; name: string; arguments: Record<string, any> }
      partial: PiAssistantMessage
    }
  | { type: "done"; reason: "stop" | "length" | "toolUse"; message: PiAssistantMessage }
  | { type: "error"; reason: "error" | "aborted"; error: PiAssistantMessage }

function toPiUsage(raw: any): PiAssistantMessage["usage"] {
  const inputTotal = Number(raw?.inputTokens?.total ?? 0)
  const outputTotal = Number(raw?.outputTokens?.total ?? 0)
  const cacheRead = Number(raw?.inputTokens?.cacheRead ?? 0)
  const cacheWrite = Number(raw?.inputTokens?.cacheWrite ?? 0)
  const totalTokens = inputTotal + outputTotal
  return {
    input: inputTotal,
    output: outputTotal,
    cacheRead,
    cacheWrite,
    totalTokens,
    cost: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      total: 0,
    },
  }
}

function mapFinishReason(reason: string | undefined): {
  doneReason: "stop" | "length" | "toolUse"
  stopReason: PiAssistantMessage["stopReason"]
} {
  switch (reason) {
    case "length":
      return { doneReason: "length", stopReason: "length" }
    case "tool-calls":
      return { doneReason: "toolUse", stopReason: "toolUse" }
    case "stop":
    default:
      return { doneReason: "stop", stopReason: "stop" }
  }
}

// -----------------------------------------------------------------------------
// Route
// -----------------------------------------------------------------------------

export const LlmRoute = new Hono().post(
  "/v1/llm/stream",
  describeRoute({
    summary: "LLM stream (pi-ai bridge)",
    description:
      "Stream a single-step model response with tool-call support. This is an internal bridge API for OpenClaw.",
    operationId: "llm.stream",
    responses: {
      200: {
        description: "SSE stream of pi-ai AssistantMessageEvent JSON payloads",
      },
    },
  }),
  validator("json", LlmStreamInputSchema),
  async (c) => {
    const input = c.req.valid("json")

    const providerID = input.provider.trim()
    const modelID = input.model.trim()
    const apiId = (input.api ?? "openai-responses").trim() || "openai-responses"
    const fallbackSessionID = (input.options?.sessionId ?? "").trim() || `llm-bridge:${providerID}/${modelID}`

    const model = await Provider.getModel(providerID, modelID)

    const tools = toToolSet(input.context.tools)
    const messages = toModelMessages(input.context.messages)
    const system = input.context.systemPrompt

    const abortController = new AbortController()
    const requestAbort = c.req.raw.signal
    if (requestAbort?.aborted) abortController.abort()
    requestAbort?.addEventListener("abort", () => abortController.abort(), { once: true })

    return streamSSE(c, async (stream) => {
      stream.onAbort(() => abortController.abort())

      const startedAt = Date.now()
      const partial: PiAssistantMessage = {
        role: "assistant",
        content: [],
        api: apiId,
        provider: providerID,
        model: modelID,
        usage: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        stopReason: "stop",
        timestamp: startedAt,
      }

      const send = async (evt: PiAssistantMessageEvent) => {
        await stream.writeSSE({
          data: JSON.stringify(evt),
        })
      }

      await send({ type: "start", partial })

      // Track content indices by AI SDK segment id.
      const textIndexById = new Map<string, number>()
      const thinkingIndexById = new Map<string, number>()
      const toolIndexByCallId = new Map<string, number>()
      const toolArgsBufferByCallId = new Map<string, string>()

      let finalUsage: any | undefined
      let finalFinishReason: string | undefined

      try {
        const result = await Fallback.stream({
          sessionID: fallbackSessionID,
          abort: abortController.signal,
          model,
          purpose: "bridge_response",
          fallbackConfig: input.fallback
            ? {
                enabled: input.fallback.enabled,
                maxAttempts: input.fallback.maxAttempts,
                rules: input.fallback.rules,
                costAware: input.fallback.costAware,
                notifyOnFallback: input.fallback.notifyOnFallback,
              }
            : undefined,
          skipFallback: input.fallback?.skipFallback,
          streamWithModel: async (candidateModel) => {
            const language = await Provider.getLanguage(candidateModel)
            return streamText({
              model: language,
              tools: tools as any,
              ...(typeof (input.options as any)?.toolChoice !== "undefined"
                ? { toolChoice: (input.options as any).toolChoice }
                : {}),
              system,
              messages,
              abortSignal: abortController.signal,
              // Respect caller-provided sampling hints when possible.
              ...(typeof input.options?.temperature === "number" ? { temperature: input.options.temperature } : {}),
              ...(typeof input.options?.maxTokens === "number" ? { maxOutputTokens: input.options.maxTokens } : {}),
              ...(input.options?.headers ? { headers: input.options.headers } : {}),
              // OpenAI Responses requires `store=false` for most personal/dev use-cases.
              // Set it explicitly to avoid provider defaults (some SDKs default to store=true).
              providerOptions: {
                openai: { store: false },
                "openai-compatible": { store: false },
              },
              maxRetries: 2,
            })
          },
        })

        for await (const part of result.fullStream) {
          switch (part.type) {
            case "text-start": {
              const index = partial.content.length
              textIndexById.set(part.id, index)
              partial.content.push({ type: "text", text: "" })
              await send({ type: "text_start", contentIndex: index, partial })
              break
            }
            case "text-delta": {
              const index = textIndexById.get(part.id)
              if (typeof index !== "number") break
              const block = partial.content[index]
              if (block && block.type === "text") {
                block.text += part.text
              }
              await send({ type: "text_delta", contentIndex: index, delta: part.text, partial })
              break
            }
            case "text-end": {
              const index = textIndexById.get(part.id)
              if (typeof index !== "number") break
              const block = partial.content[index]
              const content = block && block.type === "text" ? block.text : ""
              await send({ type: "text_end", contentIndex: index, content, partial })
              break
            }

            case "reasoning-start": {
              const index = partial.content.length
              thinkingIndexById.set(part.id, index)
              partial.content.push({ type: "thinking", thinking: "" })
              await send({ type: "thinking_start", contentIndex: index, partial })
              break
            }
            case "reasoning-delta": {
              const index = thinkingIndexById.get(part.id)
              if (typeof index !== "number") break
              const block = partial.content[index]
              if (block && block.type === "thinking") {
                block.thinking += part.text
              }
              await send({ type: "thinking_delta", contentIndex: index, delta: part.text, partial })
              break
            }
            case "reasoning-end": {
              const index = thinkingIndexById.get(part.id)
              if (typeof index !== "number") break
              const block = partial.content[index]
              const content = block && block.type === "thinking" ? block.thinking : ""
              await send({ type: "thinking_end", contentIndex: index, content, partial })
              break
            }

            case "tool-input-start": {
              const index = partial.content.length
              toolIndexByCallId.set(part.id, index)
              toolArgsBufferByCallId.set(part.id, "")
              partial.content.push({ type: "toolCall", id: part.id, name: part.toolName, arguments: {} })
              await send({ type: "toolcall_start", contentIndex: index, partial })
              break
            }
            case "tool-input-delta": {
              const index = toolIndexByCallId.get(part.id)
              if (typeof index !== "number") break
              toolArgsBufferByCallId.set(part.id, (toolArgsBufferByCallId.get(part.id) ?? "") + part.delta)
              await send({ type: "toolcall_delta", contentIndex: index, delta: part.delta, partial })
              break
            }
            case "tool-call": {
              const callId = String((part as any).toolCallId ?? "")
              const toolName = String((part as any).toolName ?? "")
              const inputObj = (part as any).input
              const index = toolIndexByCallId.get(callId)
              const args = inputObj && typeof inputObj === "object" ? (inputObj as Record<string, any>) : {}
              if (typeof index === "number") {
                const block = partial.content[index]
                if (block && block.type === "toolCall") {
                  block.arguments = args
                }
                const toolCall = { type: "toolCall" as const, id: callId, name: toolName, arguments: args }
                await send({ type: "toolcall_end", contentIndex: index, toolCall, partial })
              }
              break
            }

            case "finish": {
              finalUsage = part.totalUsage
              finalFinishReason = part.finishReason
              break
            }
            case "abort": {
              partial.stopReason = "aborted"
              partial.errorMessage = part.reason ?? "aborted"
              partial.timestamp = Date.now()
              await send({ type: "error", reason: "aborted", error: partial })
              return
            }
            case "error": {
              const msg = describeProviderError(part.error)
              log.error("llm stream error part", { providerID, modelID, error: msg })
              partial.stopReason = "error"
              partial.errorMessage = msg
              partial.timestamp = Date.now()
              await send({ type: "error", reason: "error", error: partial })
              return
            }
          }
        }

        const { doneReason, stopReason } = mapFinishReason(finalFinishReason)
        partial.usage = toPiUsage(finalUsage)
        partial.stopReason = stopReason
        partial.timestamp = Date.now()
        await send({ type: "done", reason: doneReason, message: partial })
      } catch (err) {
        const msg = describeProviderError(err)
        log.error("llm stream failed", { providerID, modelID, error: msg })
        partial.stopReason = abortController.signal.aborted ? "aborted" : "error"
        partial.errorMessage = msg
        partial.timestamp = Date.now()
        await send({ type: "error", reason: abortController.signal.aborted ? "aborted" : "error", error: partial })
      }
    })
  },
)
