import crypto from "node:crypto"
import { Hono } from "hono"
import { streamSSE } from "hono/streaming"
import { describeRoute, resolver, validator } from "hono-openapi"
import { z } from "zod"
import { Bus } from "@/bus"
import { Identifier } from "@/id/id"
import { Instance } from "@/project/instance"
import { MessageV2 } from "../../session/message-v2"
import { SessionPrompt } from "../../session/prompt"
import { Session } from "../../session"
import { SessionStatus } from "../../session/status"
import { Storage } from "../../storage/storage"
import { errors } from "../error"
import { RequestMeta } from "../request-meta"
import { registerSseKeepalive } from "../sse-keepalive"
import { SseLimit } from "../sse-limit"
import { ensureOpenBBRuntimeAvailable } from "../../openbb/runtime"
import { Config } from "../../config/config"

const OpenBBWidgetParam = z
  .object({
    name: z.string(),
    current_value: z.unknown().optional(),
  })
  .passthrough()

const OpenBBWidget = z
  .object({
    uuid: z.string().optional(),
    origin: z.string().optional(),
    widget_id: z.string().optional(),
    name: z.string().optional(),
    description: z.string().optional(),
    params: z.array(OpenBBWidgetParam).optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough()

const OpenBBWidgets = z
  .object({
    primary: z.array(OpenBBWidget).optional(),
    secondary: z.array(OpenBBWidget).optional(),
    extra: z.array(OpenBBWidget).optional(),
  })
  .passthrough()

const OpenBBHumanOrAIMessage = z
  .object({
    role: z.enum(["human", "ai"]),
    content: z.unknown().optional(),
    agent_id: z.string().optional(),
  })
  .passthrough()

const OpenBBToolDataItem = z
  .object({
    content: z.unknown(),
  })
  .passthrough()

const OpenBBToolData = z
  .object({
    items: z.array(OpenBBToolDataItem).default([]),
  })
  .passthrough()

const OpenBBToolMessage = z
  .object({
    role: z.literal("tool"),
    function: z.string().optional(),
    input_arguments: z.record(z.string(), z.unknown()).optional(),
    data: z.array(OpenBBToolData).optional(),
    extra_state: z.record(z.string(), z.unknown()).optional(),
    content: z.unknown().optional(),
  })
  .passthrough()

const OpenBBMessageSchema = z.discriminatedUnion("role", [OpenBBHumanOrAIMessage, OpenBBToolMessage])

const OpenBBQueryRequest = z
  .object({
    messages: z.array(OpenBBMessageSchema).min(1),
    widgets: OpenBBWidgets.optional(),
    urls: z.array(z.string()).optional(),
    timezone: z.string().optional(),
    workspace_state: z
      .object({
        current_page_context: z.string().optional(),
        current_dashboard_uuid: z.string().optional(),
        current_dashboard_info: z
          .object({
            current_tab_id: z.string().optional(),
            tabs: z.array(z.record(z.string(), z.unknown())).optional(),
          })
          .passthrough()
          .optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough()

const OpenBBAgentDescriptor = z.record(
  z.string(),
  z.object({
    name: z.string(),
    description: z.string(),
    image: z.string().optional(),
    endpoints: z.object({
      query: z.string(),
    }),
    features: z.object({
      streaming: z.boolean(),
      "widget-dashboard-select": z.boolean(),
      "widget-dashboard-search": z.boolean(),
    }),
  }),
)

type OpenBBMessage = z.infer<typeof OpenBBMessageSchema>
type OpenBBQueryRequest = z.infer<typeof OpenBBQueryRequest>
type OpenBBWidget = z.infer<typeof OpenBBWidget>

type FingerprintLookup = {
  matchedLength: number
  sessionId?: string
}

type TableArtifact = {
  name: string
  description: string
  rows: Array<Record<string, unknown>>
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue)
  if (value && typeof value === "object" && !(value instanceof Date)) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, inner]) => [key, stableValue(inner)]),
    )
  }
  return value
}

function stableStringify(value: unknown): string {
  return JSON.stringify(stableValue(value))
}

function normalizeMessageForFingerprint(message: OpenBBMessage) {
  if (message.role === "tool") {
    return {
      role: message.role,
      function: message.function ?? null,
      input_arguments: stableValue(message.input_arguments ?? null),
      data: stableValue(message.data ?? null),
      extra_state: stableValue(message.extra_state ?? null),
    }
  }

  return {
    role: message.role,
    agent_id: message.agent_id ?? null,
    content: stableValue(message.content ?? null),
  }
}

function fingerprintMessages(messages: OpenBBMessage[]): string {
  return crypto
    .createHash("sha256")
    .update(stableStringify(messages.map(normalizeMessageForFingerprint)))
    .digest("hex")
}

function fingerprintStorageKey(fingerprint: string) {
  return ["openbb", "session_map", Instance.project.id, fingerprint]
}

async function readFingerprintSession(fingerprint: string): Promise<string | undefined> {
  try {
    const record = await Storage.read<{ sessionId?: string }>(fingerprintStorageKey(fingerprint))
    return record.sessionId
  } catch {
    return
  }
}

async function writeFingerprintSession(fingerprint: string, sessionId: string) {
  await Storage.write(fingerprintStorageKey(fingerprint), {
    sessionId,
    updatedAt: Date.now(),
  })
}

async function resolveFingerprintLookup(messages: OpenBBMessage[]): Promise<FingerprintLookup> {
  for (let length = messages.length; length > 0; length--) {
    const sessionId = await readFingerprintSession(fingerprintMessages(messages.slice(0, length)))
    if (!sessionId) continue
    try {
      await Session.get(sessionId)
      return { matchedLength: length, sessionId }
    } catch {
      // Ignore stale mappings and continue with shorter prefixes.
    }
  }

  return { matchedLength: 0 }
}

function stringifyContent(value: unknown): string {
  if (typeof value === "string") return value
  if (value == null) return ""
  return stableStringify(value)
}

function isWidgetDataFunctionCall(content: string): boolean {
  try {
    const parsed = JSON.parse(content) as { function?: string }
    return parsed.function === "get_widget_data"
  } catch {
    return false
  }
}

function summarizeWidgetData(message: z.infer<typeof OpenBBToolMessage>): string {
  const sections: string[] = []

  for (const block of message.data ?? []) {
    for (const item of block.items ?? []) {
      const rendered = stringifyContent(item.content).trim()
      if (!rendered) continue
      sections.push(rendered)
    }
  }

  if (sections.length === 0 && message.content != null) {
    const rendered = stringifyContent(message.content).trim()
    if (rendered) sections.push(rendered)
  }

  return sections.join("\n\n")
}

function normalizeNoteText(message: OpenBBMessage): { role: "user" | "assistant"; text: string } | undefined {
  if (message.role === "human") {
    const text = stringifyContent(message.content).trim()
    if (!text) return
    return { role: "user", text }
  }

  if (message.role === "tool") {
    const summary = summarizeWidgetData(message).trim()
    if (!summary) return
    return {
      role: "user",
      text: `OpenBB widget data (${message.function ?? "tool"}):\n${summary}`,
    }
  }

  const content = stringifyContent(message.content).trim()
  if (!content) return

  if (isWidgetDataFunctionCall(content)) {
    return { role: "assistant", text: "[OpenBB requested widget data.]" }
  }

  return { role: "assistant", text: content }
}

async function appendSessionNote(sessionId: string, role: "user" | "assistant", text: string) {
  const session = await Session.get(sessionId)
  const timestamp = Date.now()

  const info =
    role === "assistant"
      ? await (async () => {
          const history = await Session.messages({ sessionID: sessionId })
          const parentID = history.findLast((message) => message.info.role === "user")?.info.id ?? history.at(-1)?.info.id

          if (!parentID) {
            return Session.updateMessage({
              id: Identifier.ascending("message"),
              sessionID: sessionId,
              role: "user",
              agent: "note",
              model: {
                providerID: "zee",
                modelID: "note",
              },
              time: {
                created: timestamp,
              },
            })
          }

          return Session.updateMessage({
            id: Identifier.ascending("message"),
            sessionID: sessionId,
            role: "assistant",
            parentID,
            mode: "note",
            agent: "note",
            path: {
              cwd: session.directory || Instance.directory,
              root: Instance.worktree,
            },
            time: {
              created: timestamp,
              completed: timestamp,
            },
            cost: 0,
            tokens: {
              input: 0,
              output: 0,
              reasoning: 0,
              cache: { read: 0, write: 0 },
            },
            providerID: "zee",
            modelID: "note",
            finish: "note",
          })
        })()
      : await Session.updateMessage({
          id: Identifier.ascending("message"),
          sessionID: sessionId,
          role: "user",
          agent: "note",
          model: {
            providerID: "zee",
            modelID: "note",
          },
          time: {
            created: timestamp,
          },
        })

  await Session.updatePart({
    id: Identifier.ascending("part"),
    sessionID: sessionId,
    messageID: info.id,
    type: "text",
    text,
  })
  await Session.touch(sessionId)
}

async function syncConversationHistory(input: {
  sessionId: string
  messages: OpenBBMessage[]
  matchedLength: number
  syncUntil: number
}) {
  const slice = input.messages.slice(input.matchedLength, input.syncUntil)
  const selected = input.matchedLength === 0 ? slice : slice.filter((message) => message.role !== "ai")

  for (const message of selected) {
    const note = normalizeNoteText(message)
    if (!note) continue
    await appendSessionNote(input.sessionId, note.role, note.text)
  }
}

function messageTitleFromHistory(messages: OpenBBMessage[]): string | undefined {
  const firstHuman = messages.find((message) => message.role === "human")
  const text = firstHuman ? stringifyContent(firstHuman.content).trim() : ""
  if (!text) return
  return text.length > 96 ? `${text.slice(0, 93)}...` : text
}

async function ensureOpenbbSession(messages: OpenBBMessage[]) {
  const lookup = await resolveFingerprintLookup(messages)
  if (lookup.sessionId) return lookup

  const session = await Session.create({
    title: messageTitleFromHistory(messages) ?? "OpenBB Workspace",
    surface: "openbb",
  })

  return {
    matchedLength: 0,
    sessionId: session.id,
  }
}

function widgetInputArgs(widget: OpenBBWidget): Record<string, unknown> {
  return Object.fromEntries((widget.params ?? []).map((param) => [param.name, param.current_value ?? null]))
}

function toFunctionDataSource(widget: OpenBBWidget) {
  return {
    widget_uuid: widget.uuid ?? "",
    origin: widget.origin ?? "openbb",
    id: widget.widget_id ?? widget.name ?? "widget",
    input_args: widgetInputArgs(widget),
  }
}

function hasWidgetToolMessage(messages: OpenBBMessage[]): boolean {
  return messages.some((message) => message.role === "tool" && message.function === "get_widget_data")
}

function shouldRequestWidgetData(request: OpenBBQueryRequest): boolean {
  const primary = request.widgets?.primary ?? []
  if (primary.length === 0) return false
  if (hasWidgetToolMessage(request.messages)) return false
  const lastMessage = request.messages.at(-1)
  if (!lastMessage) return false
  if (lastMessage.role === "human") return true
  return lastMessage.role === "ai" && lastMessage.agent_id === "openbb-copilot"
}

function summarizeWidgets(widgets: OpenBBWidget[] | undefined, label: string): string[] {
  if (!widgets?.length) return []
  return widgets.map((widget) => {
    const args = widgetInputArgs(widget)
    const argsSummary =
      Object.keys(args).length > 0
        ? ` (${Object.entries(args)
            .map(([key, value]) => `${key}=${stringifyContent(value)}`)
            .join(", ")})`
        : ""
    return `${label}: ${widget.name ?? widget.widget_id ?? "Widget"}${argsSummary}`
  })
}

function buildWorkspaceContext(request: OpenBBQueryRequest): string {
  const context: string[] = []
  const page = request.workspace_state?.current_page_context?.trim()
  if (page) context.push(`Workspace page: ${page}`)

  const currentTab = request.workspace_state?.current_dashboard_info?.current_tab_id?.trim()
  if (currentTab) context.push(`Active dashboard tab: ${currentTab}`)

  context.push(...summarizeWidgets(request.widgets?.primary, "Selected widget"))
  context.push(...summarizeWidgets(request.widgets?.secondary, "Dashboard widget"))

  if (request.urls?.length) {
    context.push(`Workspace URLs: ${request.urls.join(", ")}`)
  }

  return context.join("\n")
}

function findLatestHumanMessage(messages: OpenBBMessage[]): string | undefined {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index]
    if (message.role !== "human") continue
    const text = stringifyContent(message.content).trim()
    if (text) return text
  }
  return
}

function buildPromptText(request: OpenBBQueryRequest): string {
  const lastMessage = request.messages.at(-1)
  const workspaceContext = buildWorkspaceContext(request)
  const latestHuman = findLatestHumanMessage(request.messages)

  if (lastMessage?.role === "tool") {
    return [
      latestHuman ? `Latest user request:\n${latestHuman}` : undefined,
      "Continue the OpenBB Workspace conversation using the widget data already provided in the session.",
      workspaceContext ? `Additional workspace context:\n${workspaceContext}` : undefined,
    ]
      .filter(Boolean)
      .join("\n\n")
  }

  const content = stringifyContent(lastMessage?.content).trim()
  if (!workspaceContext) return content
  return [content, `OpenBB Workspace context:\n${workspaceContext}`].filter(Boolean).join("\n\n")
}

function lookupWidgetByUuid(request: OpenBBQueryRequest, widgetUuid: string | undefined): OpenBBWidget | undefined {
  if (!widgetUuid) return
  const widgets = [...(request.widgets?.primary ?? []), ...(request.widgets?.secondary ?? []), ...(request.widgets?.extra ?? [])]
  return widgets.find((widget) => widget.uuid === widgetUuid)
}

function citationSignature(origin: string, widgetId: string, inputArgs: Record<string, unknown>): string {
  const args = Object.entries(inputArgs)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key.toLowerCase()}=${stringifyContent(value).trim().toLowerCase()}`)
    .join("&")
  return `origin=${origin.toLowerCase()}&widget_id=${widgetId}&args=[${args}]`
}

function buildCitations(request: OpenBBQueryRequest): Array<Record<string, unknown>> {
  const citations = new Map<string, Record<string, unknown>>()

  for (const message of request.messages) {
    if (message.role !== "tool" || message.function !== "get_widget_data") continue
    const dataSources = (message.input_arguments?.data_sources as Array<Record<string, unknown>> | undefined) ?? []
    for (const dataSource of dataSources) {
      const widget = lookupWidgetByUuid(request, typeof dataSource.widget_uuid === "string" ? dataSource.widget_uuid : undefined)
      const origin = String(widget?.origin ?? dataSource.origin ?? "openbb")
      const widgetId = String(widget?.widget_id ?? dataSource.id ?? widget?.name ?? "widget")
      const inputArgs = (dataSource.input_args as Record<string, unknown> | undefined) ?? {}
      const signature = citationSignature(origin, widgetId, inputArgs)
      if (citations.has(signature)) continue

      citations.set(signature, {
        source_info: {
          type: "widget",
          origin: origin.toLowerCase(),
          widget_id: widgetId,
          metadata: {
            input_args: inputArgs,
          },
          citable: true,
        },
        details: [
          {
            "Widget Name": widget?.name ?? widgetId,
            "Widget Input Arguments": inputArgs,
          },
        ],
        signature,
      })
    }
  }

  return [...citations.values()]
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  return value as Record<string, unknown>
}

function coerceTableArtifact(output: unknown, toolName: string): TableArtifact | undefined {
  let parsed = output
  if (typeof parsed === "string") {
    const trimmed = parsed.trim()
    if (!trimmed.startsWith("[") && !trimmed.startsWith("{")) return
    try {
      parsed = JSON.parse(trimmed)
    } catch {
      return
    }
  }

  if (Array.isArray(parsed) && parsed.every((row) => asRecord(row))) {
    const rows = parsed as Array<Record<string, unknown>>
    if (rows.length === 0) return
    return {
      name: toolName,
      description: `Structured output from ${toolName}`,
      rows: rows.slice(0, 50),
    }
  }

  const record = asRecord(parsed)
  if (!record) return

  for (const [key, value] of Object.entries(record)) {
    if (!Array.isArray(value) || !value.every((row) => asRecord(row))) continue
    const rows = value as Array<Record<string, unknown>>
    if (rows.length === 0) continue
    return {
      name: `${toolName}:${key}`,
      description: `Structured output from ${toolName}`,
      rows: rows.slice(0, 50),
    }
  }

  return
}

export const OpenBBRoute = new Hono()
  .get(
    "/agents.json",
    describeRoute({
      summary: "Get OpenBB agent metadata",
      description: "Returns the OpenBB Workspace copilot agent descriptor for Zee.",
      operationId: "openbb.agents",
      responses: {
        200: {
          description: "OpenBB agent descriptor",
          content: {
            "application/json": {
              schema: resolver(OpenBBAgentDescriptor),
            },
          },
        },
      },
    }),
    async (c) => {
      return c.json({
        zee: {
          name: "Zee",
          description: "Zee investing copilot for OpenBB Workspace with shared memory and multimodal retrieval.",
          endpoints: {
            query: "/openbb/query",
          },
          features: {
            streaming: true,
            "widget-dashboard-select": true,
            "widget-dashboard-search": true,
          },
        },
      })
    },
  )
  .post(
    "/query",
    describeRoute({
      summary: "Run an OpenBB copilot query",
      description: "Accepts a stateless OpenBB QueryRequest and streams copilot SSE events from Zee.",
      operationId: "openbb.query",
      responses: {
        200: {
          description: "Copilot SSE stream",
        },
        ...errors(400),
      },
    }),
    validator("json", OpenBBQueryRequest),
    async (c) => {
      const request = c.req.valid("json")
      const slot = SseLimit.acquire(c.req.raw)
      if (!slot.ok) {
        return c.json({ error: slot.error }, slot.status)
      }

      const resolved = await ensureOpenbbSession(request.messages)
      const sessionId = resolved.sessionId!
      const fullFingerprint = fingerprintMessages(request.messages)
      RequestMeta.setSessionID(c.req.raw, sessionId)

      const writeSingleSse = async (event: string, payload: unknown) => {
        try {
          return streamSSE(c, async (stream) => {
            const unregisterKeepalive = registerSseKeepalive(stream)
            try {
              await stream.writeSSE({
                event,
                data: JSON.stringify(payload),
              })
            } finally {
              unregisterKeepalive()
              slot.release()
            }
          })
        } catch (error) {
          slot.release()
          throw error
        }
      }

      if (shouldRequestWidgetData(request)) {
        await syncConversationHistory({
          sessionId,
          messages: request.messages,
          matchedLength: resolved.matchedLength,
          syncUntil: request.messages.length,
        })
        await writeFingerprintSession(fullFingerprint, sessionId)
        return writeSingleSse("copilotFunctionCall", {
          function: "get_widget_data",
          input_arguments: {
            data_sources: (request.widgets?.primary ?? []).map(toFunctionDataSource),
          },
        })
      }

      const shouldPromptWithHuman = request.messages.at(-1)?.role === "human"
      const syncUntil = shouldPromptWithHuman ? request.messages.length - 1 : request.messages.length
      await syncConversationHistory({
        sessionId,
        messages: request.messages,
        matchedLength: resolved.matchedLength,
        syncUntil,
      })
      await writeFingerprintSession(fullFingerprint, sessionId)

      const promptText = buildPromptText(request).trim()
      if (!promptText) {
        slot.release()
        return c.json({ error: "Query produced no actionable content." }, 400)
      }
      const openbbConfig = (await Config.get().catch(() => undefined))?.openbb
      const openbbAvailability = await ensureOpenBBRuntimeAvailable(openbbConfig)

      try {
        return streamSSE(c, async (stream) => {
          let assistantMessageId: string | undefined
          const reasoningSeen = new Set<string>()
          const emittedArtifacts = new Set<string>()
          const subscriptions: Array<() => void> = []
          const unregisterKeepalive = registerSseKeepalive(stream)

          const writeStatus = async (message: string, eventType: "INFO" | "WARNING" | "ERROR" = "INFO") => {
            await stream.writeSSE({
              event: "copilotStatusUpdate",
              data: JSON.stringify({
                event_type: eventType,
                group: "reasoning",
                message,
              }),
            })
          }

          subscriptions.push(
            Bus.subscribe(MessageV2.Event.Updated, async (event) => {
              const info = event.properties.info
              if (info.sessionID !== sessionId || info.role !== "assistant") return
              assistantMessageId = info.id
            }),
          )

          subscriptions.push(
            Bus.subscribe(MessageV2.Event.PartUpdated, async (event) => {
              const { part, delta } = event.properties
              if (part.sessionID !== sessionId) return
              if (assistantMessageId && part.messageID !== assistantMessageId) return
              if (!assistantMessageId) assistantMessageId = part.messageID

              if (part.type === "text" && delta) {
                await stream.writeSSE({
                  event: "copilotMessageChunk",
                  data: JSON.stringify({ delta }),
                })
                return
              }

              if (part.type === "reasoning") {
                const text = (delta ?? part.text).trim()
                if (text && !reasoningSeen.has(part.id)) {
                  reasoningSeen.add(part.id)
                  await writeStatus(text)
                }
                return
              }

              if (part.type !== "tool") return

              if (part.state.status === "running") {
                await writeStatus(part.state.title ?? `Running ${part.tool}...`)
                return
              }

              if (part.state.status === "error") {
                await writeStatus(part.state.error || `Tool ${part.tool} failed.`, "WARNING")
                return
              }

              if (part.state.status !== "completed" || emittedArtifacts.has(part.id)) return
              const artifact = coerceTableArtifact(part.state.output, part.tool)
              if (!artifact) return

              emittedArtifacts.add(part.id)
              await stream.writeSSE({
                event: "copilotMessageArtifact",
                data: JSON.stringify({
                  type: "table",
                  uuid: crypto.randomUUID(),
                  name: artifact.name,
                  description: artifact.description,
                  content: artifact.rows,
                }),
              })
            }),
          )

          subscriptions.push(
            Bus.subscribe(SessionStatus.Event.Status, async (event) => {
              if (event.properties.sessionID !== sessionId) return
              const status = event.properties.status
              if (status.type === "retry") {
                await writeStatus(status.message)
                return
              }
              if (status.type === "busy" && status.streamHealth?.phase === "thinking") {
                await writeStatus("Zee is reasoning about the OpenBB request.")
              }
            }),
          )

          const promptPromise = SessionPrompt.prompt({
            sessionID: sessionId,
            mode: "plan",
            parts: [
              {
                id: Identifier.ascending("part"),
                type: "text",
                text: promptText,
              },
            ],
          })

          try {
            if (!openbbAvailability.available) {
              const detail = [openbbAvailability.error, openbbAvailability.action].filter(Boolean).join(" ")
              await writeStatus(`OpenBB Platform API unavailable. ${detail}`.trim(), "WARNING")
            }
            await writeStatus("Zee is analyzing the OpenBB request.")
            await promptPromise

            const citations = buildCitations(request)
            if (citations.length > 0) {
              await stream.writeSSE({
                event: "copilotCitationCollection",
                data: JSON.stringify({ citations }),
              })
            }
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            await writeStatus(message, "ERROR")
            await stream.writeSSE({
              event: "copilotMessageChunk",
              data: JSON.stringify({ delta: `Error: ${message}` }),
            })
          } finally {
            subscriptions.forEach((unsubscribe) => unsubscribe())
            unregisterKeepalive()
            slot.release()
          }
        })
      } catch (error) {
        slot.release()
        throw error
      }
    },
  )
