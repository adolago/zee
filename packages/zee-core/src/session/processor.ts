import { MessageV2 } from "./message-v2"
import { Log } from "@/util/log"
import { Identifier } from "@/id/id"
import { Session } from "."
import { Agent } from "@/agent/agent"
import { Snapshot } from "@/snapshot"
import { SessionSummary } from "./summary"
import { Bus } from "@/bus"
import { SessionRetry } from "./retry"
import { SessionStatus } from "./status"
import type { Provider } from "@/provider/provider"
import { LLM } from "./llm"
import { Fallback } from "@/provider/fallback"
import { Config } from "@/config/config"
import { SessionCompaction } from "./compaction"
import { PermissionNext } from "@/permission/next"
import { Question } from "@/question"
import { addWideEventFields, finishWideEvent, runWithWideEventContext } from "@/util/wide-events"
import { Flag } from "@/flag/flag"
import { withTimeout } from "@/util/timeout"
import * as UsageTracker from "@/usage/tracker"
import { StreamHealth } from "./stream-health"
import { StreamEvents } from "./stream-events"
import { AppDeps } from "@/app/deps"

export namespace SessionProcessor {
  const DOOM_LOOP_THRESHOLD = 3
  const DEFAULT_LLM_STREAM_START_TIMEOUT_MS = 30_000
  const LLM_STREAM_START_TIMEOUT_BUFFER_MS = 250
  const log = Log.create({ service: "session.processor" })

  export type Info = Awaited<ReturnType<typeof create>>
  export type Result = Awaited<ReturnType<Info["process"]>>

  export function create(input: {
    assistantMessage: MessageV2.Assistant
    sessionID: string
    model: Provider.Model
    abort: AbortSignal
  }) {
    const deps = AppDeps.use()
    const toolcalls: Record<string, MessageV2.ToolPart> = {}
    let snapshot: string | undefined
    let blocked = false
    let attempt = 0
    let needsCompaction = false

    const result = {
      get message() {
        return input.assistantMessage
      },
      partFromToolCall(toolCallID: string) {
        return toolcalls[toolCallID]
      },
      async process(streamInput: LLM.StreamInput) {
        const traceId = input.assistantMessage.parentID || input.assistantMessage.id
        const toolNames = Object.keys(streamInput.tools ?? {})
        const toolStats = {
          calls: 0,
          errors: 0,
          names: new Set<string>(),
        }
        const baseEvent = {
          service: "agent-core",
          traceId,
          requestId: input.assistantMessage.id,
          sessionId: input.sessionID,
          messageId: input.assistantMessage.id,
          parentId: input.assistantMessage.parentID,
          agent: input.assistantMessage.agent,
          providerId: input.model.providerID,
          modelId: input.model.id,
          request: {
            small: streamInput.small ?? false,
            toolCount: toolNames.length,
            toolNames: toolNames.length <= 12 ? toolNames : toolNames.slice(0, 12),
          },
        }

        return await runWithWideEventContext(baseEvent, async () => {
          log.info("process")
          needsCompaction = false
          const shouldBreak = (await Config.get()).experimental?.continue_loop_on_deny !== true
          // Initialize stream health monitor - always enabled to detect hanging streams
          // Pass model's reasoning capability for extended timeouts on thinking models
          const healthMonitor = StreamHealth.getOrCreate({
            sessionID: input.sessionID,
            messageID: input.assistantMessage.id,
            isReasoningModel: input.model.capabilities.reasoning,
          })

          // Set up timeout abort controller to abort stream on timeout
          const timeoutAbortController = new AbortController()
          const unsubscribeTimeout = Bus.subscribe(StreamEvents.Timeout, (event) => {
            const { sessionID, messageID, elapsed, eventsReceived } = event.properties
            if (sessionID === input.sessionID && messageID === input.assistantMessage.id) {
              log.warn("aborting stream due to timeout", {
                sessionID,
                messageID,
                elapsed,
                eventsReceived,
              })
              timeoutAbortController.abort(
                new Error(`Stream timeout: no response received for ${Math.round(elapsed / 1000)}s`),
              )
            }
          })
          while (true) {
            try {
              let currentText: MessageV2.TextPart | undefined
              let currentReasoning: MessageV2.ReasoningPart | undefined
              let reasoningMap: Record<string, MessageV2.ReasoningPart> = {}
              const getDelta = (value: { text?: string; textDelta?: string; delta?: string }) => {
                if (typeof value.text === "string") return value.text
                if (typeof value.textDelta === "string") return value.textDelta
                if (typeof value.delta === "string") return value.delta
                return undefined
              }
              const ensureTextPart = (metadata?: Record<string, any>) => {
                if (!currentText) {
                  currentText = {
                    id: Identifier.ascending("part"),
                    messageID: input.assistantMessage.id,
                    sessionID: input.assistantMessage.sessionID,
                    type: "text",
                    text: "",
                    time: {
                      start: Date.now(),
                    },
                    metadata,
                  }
                }
                return currentText
              }
              const ensureReasoningPart = (metadata?: Record<string, any>) => {
                if (!currentReasoning) {
                  currentReasoning = {
                    id: Identifier.ascending("part"),
                    messageID: input.assistantMessage.id,
                    sessionID: input.assistantMessage.sessionID,
                    type: "reasoning",
                    text: "",
                    time: {
                      start: Date.now(),
                    },
                    metadata,
                  }
                }
                return currentReasoning
              }
              const finalizeTextPart = async (metadata?: Record<string, any>) => {
                if (!currentText) return
                currentText.text = currentText.text.trimEnd()
                const textOutput = await deps.pluginTrigger(
                  "experimental.text.complete",
                  {
                    sessionID: input.sessionID,
                    messageID: input.assistantMessage.id,
                    partID: currentText.id,
                  },
                  { text: currentText.text },
                )
                currentText.text = textOutput.text
                currentText.time = {
                  start: Date.now(),
                  end: Date.now(),
                }
                if (metadata) currentText.metadata = metadata
                await Session.updatePart(currentText)
                currentText = undefined
              }
              const finalizeReasoningPart = async (metadata?: Record<string, any>) => {
                if (!currentReasoning) return
                currentReasoning.text = currentReasoning.text.trimEnd()
                currentReasoning.time = {
                  ...currentReasoning.time,
                  end: Date.now(),
                }
                if (metadata) currentReasoning.metadata = metadata
                await Session.updatePart(currentReasoning)
                currentReasoning = undefined
              }
              const streamStartTimeoutMs =
                Flag.ZEE_LLM_STREAM_START_TIMEOUT_MS ?? DEFAULT_LLM_STREAM_START_TIMEOUT_MS
              const streamStartController = new AbortController()
	              const streamStartTimer = setTimeout(() => {
	                streamStartController.abort(
	                  new DOMException(`LLM stream did not start within ${streamStartTimeoutMs}ms`, "AbortError"),
	                )
	              }, streamStartTimeoutMs)
	              const streamAbort = AbortSignal.any([input.abort, streamStartController.signal, timeoutAbortController.signal])
	              let removeAbortListener: (() => void) | undefined
	              const abortPromise = new Promise<never>((_, reject) => {
	                const onAbort = () => {
	                  const reason = streamAbort.reason ?? new DOMException("Aborted", "AbortError")
	                  reject(reason)
	                }

	                if (streamAbort.aborted) {
	                  onAbort()
	                  return
	                }

	                streamAbort.addEventListener("abort", onAbort, { once: true })
	                removeAbortListener = () => streamAbort.removeEventListener("abort", onAbort)
	              })
	              let streamStartTimerCleared = false
	              try {
	                const stream = await withTimeout(
	                  Fallback.stream({ ...streamInput, abort: streamAbort }),
	                  streamStartTimeoutMs + LLM_STREAM_START_TIMEOUT_BUFFER_MS,
	                )

	                const iterator = stream.fullStream[Symbol.asyncIterator]()
	                while (true) {
	                  const result = await Promise.race([iterator.next(), abortPromise])
	                  if (result.done) {
	                    healthMonitor.complete()
	                    break
	                  }
	                  const value = result.value
	                  // Record event for health monitoring (chars tracked for delta events)
	                  const deltaChars = (value as any).delta?.length ?? (value as any).textDelta?.length ?? 0
	                  healthMonitor.recordEvent(value.type, undefined, deltaChars)
	                  if (!streamStartTimerCleared) {
	                    streamStartTimerCleared = true
	                    clearTimeout(streamStartTimer)
	                  }
	                  streamAbort.throwIfAborted()
	                  switch (value.type) {
                  case "start":
                    SessionStatus.set(input.sessionID, { type: "busy" })
                    break

                  case "reasoning-start":
                    if (value.id in reasoningMap) {
                      continue
                    }
                    reasoningMap[value.id] = {
                      id: Identifier.ascending("part"),
                      messageID: input.assistantMessage.id,
                      sessionID: input.assistantMessage.sessionID,
                      type: "reasoning",
                      text: "",
                      time: {
                        start: Date.now(),
                      },
                      metadata: value.providerMetadata,
                    }
                    break

                  case "reasoning-delta": {
                    if (value.id in reasoningMap) {
                      const part = reasoningMap[value.id]
                      const delta = getDelta(value)
                      if (!delta) break
                      part.text += delta
                      if (value.providerMetadata) part.metadata = value.providerMetadata
                      if (part.text) await Session.updatePart({ part, delta })
                    }
                    break
                  }

                  case "reasoning-end":
                    if (value.id in reasoningMap) {
                      const part = reasoningMap[value.id]
                      part.text = part.text.trimEnd()

                      part.time = {
                        ...part.time,
                        end: Date.now(),
                      }
                      if (value.providerMetadata) part.metadata = value.providerMetadata
                      await Session.updatePart(part)
                      delete reasoningMap[value.id]
                    }
                    break

                  case "tool-input-start":
                    const part = await Session.updatePart({
                      id: toolcalls[value.id]?.id ?? Identifier.ascending("part"),
                      messageID: input.assistantMessage.id,
                      sessionID: input.assistantMessage.sessionID,
                      type: "tool",
                      tool: value.toolName,
                      callID: value.id,
                      state: {
                        status: "pending",
                        input: {},
                        raw: "",
                      },
                    })
                    toolcalls[value.id] = part as MessageV2.ToolPart
                    break

                  case "tool-input-delta":
                    break

                  case "tool-input-end":
                    break

                  case "tool-call": {
                    toolStats.calls += 1
                    toolStats.names.add(value.toolName)
                    const match = toolcalls[value.toolCallId]
                    if (match) {
                      const part = await Session.updatePart({
                        ...match,
                        tool: value.toolName,
                        state: {
                          status: "running",
                          input: value.input ?? match.state.input,
                          time: {
                            start: Date.now(),
                          },
                        },
                        metadata: value.providerMetadata,
                      })
                      toolcalls[value.toolCallId] = part as MessageV2.ToolPart
                      // Pause stall detection while tool is executing
                      healthMonitor.toolStarted()

                      const parts = await MessageV2.parts(input.assistantMessage.id)
                      const lastThree = parts.slice(-DOOM_LOOP_THRESHOLD)

                      if (
                        lastThree.length === DOOM_LOOP_THRESHOLD &&
                        lastThree.every(
                          (p) =>
                            p.type === "tool" &&
                            p.tool === value.toolName &&
                            p.state.status !== "pending" &&
                            JSON.stringify(p.state.input) === JSON.stringify(value.input),
                        )
                      ) {
                        const agent = await Agent.get(input.assistantMessage.agent)
                        await PermissionNext.ask({
                          permission: "doom_loop",
                          patterns: [value.toolName],
                          sessionID: input.assistantMessage.sessionID,
                          metadata: {
                            tool: value.toolName,
                            input: value.input,
                          },
                          always: [value.toolName],
                          ruleset: agent.permission,
                          holdMode: true, // doom_loop check is always in hold mode (safety feature)
                        })
                      }
                    }
                    break
                  }
                  case "tool-result": {
                    const match = toolcalls[value.toolCallId]
                    if (match && match.state.status === "running") {
                      await Session.updatePart({
                        ...match,
                        state: {
                          status: "completed",
                          input: value.input ?? match.state.input,
                          output: value.output.output,
                          metadata: value.output.metadata,
                          title: value.output.title,
                          time: {
                            start: match.state.time.start,
                            end: Date.now(),
                          },
                          attachments: value.output.attachments,
                        },
                      })

                      // Resume stall detection after tool completes
                      healthMonitor.toolCompleted()
                      delete toolcalls[value.toolCallId]
                    }
                    break
                  }

                  case "tool-error": {
                    toolStats.errors += 1
                    const match = toolcalls[value.toolCallId]
                    if (match && match.state.status === "running") {
                      await Session.updatePart({
                        ...match,
                        state: {
                          status: "error",
                          input: value.input,
                          error: value.error instanceof Error ? value.error.message : String(value.error),
                          time: {
                            start: match.state.time.start,
                            end: Date.now(),
                          },
                        },
                      })

                      if (
                        value.error instanceof PermissionNext.RejectedError ||
                        value.error instanceof Question.RejectedError
                      ) {
                        blocked = shouldBreak
                      }
                      // Resume stall detection after tool errors
                      healthMonitor.toolCompleted()
                      delete toolcalls[value.toolCallId]
                    }
                    break
                  }
                  case "error":
                    throw value.error

                  case "start-step":
                    snapshot = await Snapshot.track()
                    await Session.updatePart({
                      id: Identifier.ascending("part"),
                      messageID: input.assistantMessage.id,
                      sessionID: input.sessionID,
                      snapshot,
                      type: "step-start",
                    })
                    break

                  case "finish-step":
                    await finalizeTextPart(value.providerMetadata)
                    await finalizeReasoningPart(value.providerMetadata)
                    const danglingReasoning = Object.values(reasoningMap)
                    reasoningMap = {}
                    for (const part of danglingReasoning) {
                      part.text = part.text.trimEnd()
                      part.time = {
                        ...part.time,
                        end: Date.now(),
                      }
                      if (value.providerMetadata) part.metadata = value.providerMetadata
                      await Session.updatePart(part)
                    }
                    const usage = Session.getUsage({
                      model: input.model,
                      usage: value.usage,
                      metadata: value.providerMetadata,
                    })
                    // AI SDK v6 has a bug where finishReason is undefined for V2 language models
                    // even when the provider correctly sends it. Work around by defaulting to "stop"
                    // when finishReason is undefined.
                    let finishReason = value.finishReason
                    if (finishReason === undefined) {
                      // Check if this looks like a normal completion based on usage
                      // We can't reliably check parts here as they may not all be persisted yet
                      const hasUsage = value.usage && (value.usage.outputTokens ?? 0) > 0
                      finishReason = hasUsage ? "stop" : "other"
                    }
                    input.assistantMessage.finish = finishReason
                    input.assistantMessage.cost += usage.cost
                    input.assistantMessage.tokens = usage.tokens
                    await Session.update(input.sessionID, (session) => {
                      if (!session.tokens) {
                        session.tokens = { input: 0, output: 0, reasoning: 0 }
                      }
                      session.tokens.input += usage.tokens.input
                      session.tokens.output += usage.tokens.output
                      session.tokens.reasoning += usage.tokens.reasoning
                    })
                    // Record usage for analytics
                    if (UsageTracker.isInitialized()) {
                      UsageTracker.record({
                        sessionId: input.sessionID,
                        messageId: input.assistantMessage.id,
                        providerId: input.model.providerID,
                        modelId: input.model.id,
                        modelName: input.model.name,
                        inputTokens: usage.tokens.input,
                        outputTokens: usage.tokens.output,
                        cacheReadTokens: usage.tokens.cache.read,
                        cacheWriteTokens: usage.tokens.cache.write,
                        reasoningTokens: usage.tokens.reasoning,
                        inputCost: usage.cost * (usage.tokens.input / (usage.tokens.input + usage.tokens.output + usage.tokens.reasoning || 1)),
                        outputCost: usage.cost * ((usage.tokens.output + usage.tokens.reasoning) / (usage.tokens.input + usage.tokens.output + usage.tokens.reasoning || 1)),
                        cacheCost: 0, // Cache cost already included in inputCost for Anthropic
                        durationMs: Date.now() - (input.assistantMessage.time.created || Date.now()),
                        streaming: true,
                        toolCalls: Object.keys(toolcalls).length || undefined,
                      }).catch((e) => log.warn("failed to record usage", { error: String(e) }))
                    }
                    addWideEventFields({
                      meta: {
                        tokens: usage.tokens,
                        cost: usage.cost,
                        finishReason,
                      },
                    })
                    await Session.updatePart({
                      id: Identifier.ascending("part"),
                      reason: finishReason ?? "unknown",
                      snapshot: await Snapshot.track(),
                      messageID: input.assistantMessage.id,
                      sessionID: input.assistantMessage.sessionID,
                      type: "step-finish",
                      tokens: usage.tokens,
                      cost: usage.cost,
                    })
                    await Session.updateMessage(input.assistantMessage)
                    if (snapshot) {
                      const patch = await Snapshot.patch(snapshot)
                      if (patch.files.length) {
                        await Session.updatePart({
                          id: Identifier.ascending("part"),
                          messageID: input.assistantMessage.id,
                          sessionID: input.sessionID,
                          type: "patch",
                          hash: patch.hash,
                          files: patch.files,
                        })
                      }
                      snapshot = undefined
                    }
                    SessionSummary.summarize({
                      sessionID: input.sessionID,
                      messageID: input.assistantMessage.parentID,
                    })
                    if (await SessionCompaction.isOverflow({ tokens: usage.tokens, model: input.model })) {
                      needsCompaction = true
                    }
                    break

                  case "text-start":
                    currentText = ensureTextPart(value.providerMetadata)
                    break

                  case "text-delta": {
                    const delta = getDelta(value)
                    if (!delta) break
                    const part = ensureTextPart(value.providerMetadata)
                    part.text += delta
                    if (value.providerMetadata) part.metadata = value.providerMetadata
                    if (part.text)
                      await Session.updatePart({
                        part,
                        delta,
                      })
                    break
                  }

                  case "text-end":
                    await finalizeTextPart(value.providerMetadata)
                    break

                  case "finish":
                    await finalizeTextPart()
                    await finalizeReasoningPart()
                    break

                  default:
	                    log.info("unhandled", {
	                      ...value,
	                    })
	                    continue
	                }
	                // NOTE: Compaction is handled after stream completes naturally (see line ~647)
	                // Do NOT break the loop early here - extended thinking models (kimi-k2-thinking,
	                // gpt-5.2 xhigh) produce long reasoning chains that may exceed compaction
	                // thresholds mid-stream. Breaking early would lose buffered content.
	                }
	              } finally {
	                clearTimeout(streamStartTimer)
	                removeAbortListener?.()
	              }
	            } catch (e: any) {
	              // Record stream failure for diagnostics
	              healthMonitor.fail(e)
	              log.error("process", {
	                error: e,
	                stack: JSON.stringify(e.stack),
              })
              const error = MessageV2.fromError(e, { providerID: input.model.providerID })
              const retry = SessionRetry.retryable(error)
              if (retry !== undefined) {
                attempt++
                const delay = SessionRetry.delay(attempt, error.name === "APIError" ? error : undefined)
                SessionStatus.set(input.sessionID, {
                  type: "retry",
                  attempt,
                  message: retry,
                  next: Date.now() + delay,
                })
                await SessionRetry.sleep(delay, input.abort).catch(() => {})
                continue
              }
              input.assistantMessage.error = error
              Bus.publish(Session.Event.Error, {
                sessionID: input.assistantMessage.sessionID,
                error: input.assistantMessage.error,
              })
              SessionStatus.set(input.sessionID, { type: "idle" })
            }
            if (snapshot) {
              const patch = await Snapshot.patch(snapshot)
              if (patch.files.length) {
                await Session.updatePart({
                  id: Identifier.ascending("part"),
                  messageID: input.assistantMessage.id,
                  sessionID: input.sessionID,
                  type: "patch",
                  hash: patch.hash,
                  files: patch.files,
                })
              }
              snapshot = undefined
            }
            const p = await MessageV2.parts(input.assistantMessage.id)
            for (const part of p) {
              if (part.type === "tool" && part.state.status !== "completed" && part.state.status !== "error") {
                await Session.updatePart({
                  ...part,
                  state: {
                    ...part.state,
                    status: "error",
                    error: "Tool execution aborted",
                    time: {
                      start: Date.now(),
                      end: Date.now(),
                    },
                  },
                })
              }
            }
            input.assistantMessage.time.completed = Date.now()
            await Session.updateMessage(input.assistantMessage)
            const error = input.assistantMessage.error
            const streamReport = healthMonitor.getReport()
            // Clean up health monitor and timeout subscription
            unsubscribeTimeout()
            StreamHealth.remove(input.sessionID, input.assistantMessage.id)
            await finishWideEvent({
              ok: !error,
              error: error
                ? {
                    code: "name" in error ? String(error.name) : undefined,
                    message: "message" in error ? String(error.message) : undefined,
                  }
                : undefined,
              meta: {
                blocked,
                needsCompaction,
                toolCalls: toolStats.calls,
                toolErrors: toolStats.errors,
                toolNames:
                  toolStats.names.size <= 12 ? Array.from(toolStats.names) : Array.from(toolStats.names).slice(0, 12),
                streamHealth: streamReport
                  ? {
                      status: streamReport.status,
                      durationMs: streamReport.timing.durationMs,
                      eventsReceived: streamReport.progress.eventsReceived,
                      stallWarnings: streamReport.stallWarnings,
                    }
                  : undefined,
              },
            })
            if (needsCompaction) return "compact"
            if (blocked) return "stop"
            if (input.assistantMessage.error) return "stop"
            return "continue"
          }
        })
      },
    }
    return result
  }
}
