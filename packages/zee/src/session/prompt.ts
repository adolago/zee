import path from "path"
import os from "os"
import fs from "fs/promises"
import z from "zod"
import { Identifier } from "../id/id"
import { MessageV2 } from "./message-v2"
import { Log } from "../util/log"
import { SessionRevert } from "./revert"
import { Session } from "."
import { Storage } from "../storage/storage"
import { Agent } from "../agent/agent"
import { Provider } from "../provider/provider"
import { type Tool as AITool, tool, jsonSchema, type ToolCallOptions, asSchema } from "ai"
import { SessionCompaction } from "./compaction"
import { Instance } from "../project/instance"
import { Bus } from "../bus"
import { LifecycleHooks } from "../hooks/lifecycle"
import { ProviderTransform } from "../provider/transform"
import { SystemPrompt } from "./system"
import { InstructionPrompt } from "./instruction"
import { Plugin } from "../plugin"
// NOTE: PROMPT_PLAN and BUILD_SWITCH removed - replaced by hold/release mode in TUI
import MAX_STEPS from "../session/prompt/max-steps.txt"
import HOLD_MODE_PROMPT from "./prompt/hold-mode.txt"
import FIRST_TURN_PLAN_PROMPT from "./prompt/first-turn-plan.txt"
import { defer } from "../util/defer"
import { clone, mergeDeep } from "remeda"
import { ToolRegistry } from "../tool/registry"
import { MCP } from "../mcp"
import { LSP } from "../lsp"
import { ReadTool } from "../tool/read"
import { ListTool } from "../tool/ls"
import { FileTime } from "../file/time"
import { Flag } from "../flag/flag"
import { AuthScope, getAuthConfig, hasScope } from "../server/auth"
import { ulid } from "ulid"
import { spawn } from "child_process"
import { Command } from "../command"
import { $, fileURLToPath } from "bun"
import { Config } from "../config/config"
import { ConfigMarkdown } from "../config/markdown"
import { SessionSummary } from "./summary"
import { Todo } from "./todo"
import { NamedError } from "@zee/util/error"
import { fn } from "@/util/fn"
import { SessionProcessor } from "./processor"
import { TaskTool, resolveAgentType } from "@/tool/task"
import { Tool } from "@/tool/tool"
import { PermissionNext } from "@/permission/next"
import { SessionStatus } from "./status"
import { SessionSteering } from "./steering"
import { LLM } from "./llm"
import { iife } from "@/util/iife"
import { Shell } from "@/shell/shell"
import { Truncate } from "@/tool/truncation"
import { withTimeout } from "@/util/timeout"
import { createSafeEnv } from "@/security/env-sanitize"
import { buildSessionSystemContext } from "./session-context"
import { runTaskViaDaemon } from "@/orchestration/daemon-ipc"

// @ts-ignore
globalThis.AI_SDK_LOG_WARNINGS = false

export namespace SessionPrompt {
  const log = Log.create({ service: "session.prompt" })
  export const OUTPUT_TOKEN_MAX = Flag.ZEE_OUTPUT_TOKEN_MAX || 32_000

  function daemonSubtasksEnabled(): boolean {
    const raw = process.env.ZEE_SUBTASK_DAEMON
    if (!raw) return true
    const normalized = raw.trim().toLowerCase()
    return !["0", "false", "off", "no"].includes(normalized)
  }

  function shouldFallbackToLocalSubtask(error: Error): boolean {
    const msg = error.message.toLowerCase()
    return (
      msg.includes("orchestration daemon not running") ||
      msg.includes("socket missing") ||
      msg.includes("refused connection") ||
      msg.includes("unknown command: run_task")
    )
  }

  async function executeSubtaskViaDaemon(input: {
    persona: "zee" | "stanley" | "johny"
    description: string
    prompt: string
    parentSessionID: string
    parentMessageID: string
    timeoutMs?: number
  }): Promise<{
    title: string
    metadata: Record<string, unknown>
    output: string
  }> {
    const response = await runTaskViaDaemon({
      persona: input.persona,
      description: input.description,
      prompt: input.prompt,
      parentSessionId: input.parentSessionID,
      parentMessageId: input.parentMessageID,
      timeoutMs: input.timeoutMs,
      waitTimeoutMs: input.timeoutMs,
    })

    return {
      title: input.description,
      metadata: {
        taskId: response.task.id,
        workerId: response.task.workerId,
        orchestrator: "daemon",
        status: response.task.status,
        attempt: response.task.attempt,
      },
      output: response.output,
    }
  }

  const state = Instance.state(
    () => {
      const data: Record<
        string,
        {
          abort: AbortController
          callbacks: {
            resolve(input: MessageV2.WithParts): void
            reject(reason?: any): void
          }[]
        }
      > = {}
      return data
    },
    async (current) => {
      for (const item of Object.values(current)) {
        item.abort.abort()
        for (const callback of item.callbacks) {
          callback.reject(new DOMException("Aborted", "AbortError"))
        }
      }
    },
  )

  const sessionLifecycleEmitted = new Set<string>()

  function normalizePersona(value?: string): LifecycleHooks.SessionLifecycle.StartPayload["persona"] | null {
    switch ((value ?? "").toLowerCase()) {
      case "zee":
        return "zee"
      case "stanley":
        return "stanley"
      case "johny":
        return "johny"
      default:
        return null
    }
  }

  async function resolvePersona(agentName?: string): Promise<LifecycleHooks.SessionLifecycle.StartPayload["persona"]> {
    // Persona is ALWAYS required - no non-persona mode exists
    const fromInput = normalizePersona(agentName)
    if (fromInput) return fromInput

    const defaultAgent = await Agent.defaultAgent()
    const persona = normalizePersona(defaultAgent)
    if (!persona) {
      throw new Error(`Agent "${defaultAgent}" must map to a persona (zee, stanley, or johny)`)
    }
    return persona
  }

  function resolveSessionSource(): LifecycleHooks.SessionLifecycle.StartPayload["source"] {
    const client = (Flag.ZEE_CLIENT ?? "cli").toLowerCase()
    if (client === "tui") return "tui"
    if (client === "cli") return "cli"
    if (client === "daemon") return "daemon"
    if (client === "whatsapp") return "whatsapp"
    if (client === "app" || client === "desktop") return "tui"
    return "daemon"
  }

  async function emitSessionStartOnce(session: Session.Info, agentName?: string): Promise<void> {
    if (sessionLifecycleEmitted.has(session.id)) return
    sessionLifecycleEmitted.add(session.id)

    const resolvedAgentName = agentName ?? (await Agent.defaultAgent())
    await LifecycleHooks.emitSessionStart({
      sessionId: session.id,
      persona: await resolvePersona(resolvedAgentName),
      source: resolveSessionSource(),
      directory: session.directory,
    })

  }

  /**
   * Resolve whether hold mode is active for a given session and message.
   * Priority: per-message tools override > per-session mode > surface default.
   */
  export function resolveHoldMode(session: Session.Info, messageTools?: Record<string, boolean>): boolean {
    // Explicit per-message tools override (TUI backward compat)
    if (messageTools?.edit === false) return true
    if (messageTools?.edit === true) return false

    // Per-session mode
    if (session.mode === "hold") return true
    if (session.mode === "release") return false

    // Surface defaults: safe-by-default (hold mode).
    // Sessions can explicitly opt into release mode via session.mode="release".
    return true
  }

  /**
   * Resolve whether permission checks should be skipped ("no cuffs" mode).
   *
   * Priority: per-message options override > inferred from hold/release mode.
   *
   * Convention: RELEASE mode implies skipPermissions=true by default.
   */
  export function resolveSkipPermissions(
    session: Session.Info,
    messageTools?: Record<string, boolean>,
    messageOptions?: Record<string, any>,
  ): boolean {
    const opt = messageOptions?.skipPermissions
    if (typeof opt === "boolean") return opt
    return resolveHoldMode(session, messageTools) === false
  }

  async function hasPlanFile(planPath: string): Promise<boolean> {
    try {
      const stat = await fs.stat(planPath)
      return stat.isFile() && stat.size > 0
    } catch {
      return false
    }
  }

  function hasRealUserContent(message: MessageV2.WithParts): boolean {
    for (const part of message.parts) {
      if (part.type === "text") {
        const text = (part as MessageV2.TextPart).text?.trim()
        if ((part as MessageV2.TextPart).synthetic) continue
        if (text) return true
        continue
      }
      return true
    }
    return false
  }

  function extractPlanSection(text: string): string | null {
    const match = text.match(/(^|\n)##\\s*Plan\\s*\\n([\\s\\S]*?)(?=\\n#{1,2}\\s+\\S|$)/i)
    if (!match) return null
    const block = match[0].startsWith("\n") ? match[0].slice(1) : match[0]
    return block.trim()
  }

  async function resolveFirstTurnPlanState(input: {
    session: Session.Info
    messages: MessageV2.WithParts[]
    messageTools?: Record<string, boolean>
  }): Promise<{ enabled: boolean; planPath: string }> {
    const planPath = Session.plan(input.session)
    if (!resolveHoldMode(input.session, input.messageTools)) {
      return { enabled: false, planPath }
    }
    if (await hasPlanFile(planPath)) return { enabled: false, planPath }
    const lastUserMsg = input.messages.findLast((msg) => msg.info.role === "user")
    if (!lastUserMsg) return { enabled: false, planPath }
    if (!hasRealUserContent(lastUserMsg)) return { enabled: false, planPath }
    return { enabled: true, planPath }
  }

  async function writeFirstPlanFile(input: {
    session: Session.Info
    planPath: string
    assistantMessageID: string
  }): Promise<boolean> {
    if (await hasPlanFile(input.planPath)) return false
    const parts = await MessageV2.parts(input.assistantMessageID)
    const text = parts
      .filter((part) => part.type === "text")
      .map((part) => (part as MessageV2.TextPart).text)
      .filter(Boolean)
      .join("\n\n")
      .trim()
    if (!text) return false
    const planBlock = extractPlanSection(text) ?? text
    if (!planBlock.trim()) return false
    await fs.mkdir(path.dirname(input.planPath), { recursive: true })
    await fs.writeFile(input.planPath, planBlock.trim() + "\n", "utf-8")
    return true
  }

  const MEMORY_REQUIRED_CHECK_TTL_MS = 30_000
  let memoryRequiredCache: { ok: boolean; error?: string; checkedAt: number } | null = null

  async function checkMemoryAvailability(): Promise<{ ok: boolean; error?: string }> {
    const now = Date.now()
    if (memoryRequiredCache && now - memoryRequiredCache.checkedAt < MEMORY_REQUIRED_CHECK_TTL_MS) {
      return memoryRequiredCache
    }

    let ok = true
    let error: string | undefined

    try {
      const memoryModule = await import("../../../../src/memory/unified.js")
      const memory = memoryModule.getMemory()
      await withTimeout(memory.stats(), 5000)
      if (typeof memory.isAvailable === "function" && !memory.isAvailable()) {
        ok = false
        error = "Memory backend unavailable"
      }
    } catch (err) {
      ok = false
      error = err instanceof Error ? err.message : String(err)
    }

    memoryRequiredCache = { ok, error, checkedAt: now }
    return memoryRequiredCache
  }

  function resolveMemoryMcpName(status: Record<string, MCP.Status>): string {
    const preferred = process.env.ZEE_MEMORY_MCP
    if (preferred && status[preferred]) return preferred
    if (status["memory"]) return "memory"
    return preferred ?? "memory"
  }

  async function ensureRequiredMemory(sessionID: string): Promise<void> {
    // Memory is ALWAYS required - no non-memory mode exists
    const cfg = await Config.get()

    const status = await MCP.status()
    const mcpConfig = cfg.mcp ?? {}
    let memoryServer = resolveMemoryMcpName(status)

    if (!status[memoryServer]) {
      if (mcpConfig["memory"]) memoryServer = "memory"
    }

    let memoryStatus = status[memoryServer]
    if (!memoryStatus || memoryStatus.status !== "connected") {
      const configEntry = mcpConfig[memoryServer]
      const entryDisabled =
        typeof configEntry === "object" &&
        configEntry !== null &&
        "enabled" in configEntry &&
        configEntry.enabled === false
      const hasConfig = Boolean(configEntry)

      if (hasConfig && !entryDisabled) {
        await MCP.connect(memoryServer)
        const refreshed = await MCP.status()
        memoryStatus = refreshed[memoryServer]
      }

      if (!memoryStatus || memoryStatus.status !== "connected") {
        const reason =
          memoryStatus?.status === "failed"
            ? memoryStatus.error
            : memoryStatus?.status ?? (hasConfig ? "missing" : "not configured")
        const message =
          reason === "not configured"
            ? `Memory MCP "${memoryServer}" is required but not configured.`
            : `Memory MCP "${memoryServer}" is required but not connected (${reason}).`
        const error = new NamedError.Unknown({ message })
        Bus.publish(Session.Event.Error, {
          sessionID,
          error: error.toObject(),
        })
        throw error
      }
    }

    const memoryCheck = await checkMemoryAvailability()
    if (!memoryCheck.ok) {
      const message = `Memory backend is required but unavailable${memoryCheck.error ? `: ${memoryCheck.error}` : ""}`
      const error = new NamedError.Unknown({ message })
      Bus.publish(Session.Event.Error, {
        sessionID,
        error: error.toObject(),
      })
      throw error
    }
  }

  export function assertNotBusy(sessionID: string) {
    const match = state()[sessionID]
    if (match) throw new Session.BusyError(sessionID)
  }

  export const PromptInput = z.object({
    sessionID: Identifier.schema("session"),
    messageID: Identifier.schema("message").optional(),
    model: z
      .object({
        providerID: z.string(),
        modelID: z.string(),
      })
      .optional(),
    agent: z.string().optional(),
    noReply: z.boolean().optional(),
    tools: z
      .record(z.string(), z.boolean())
      .optional()
      .describe(
        "@deprecated tools and permissions have been merged, you can set permissions on the session itself now",
      ),
    system: z.string().optional(),
    options: z.record(z.string(), z.any()).optional(),
    variant: z.string().optional(),
    parts: z.array(
      z.discriminatedUnion("type", [
        MessageV2.TextPart.omit({
          messageID: true,
          sessionID: true,
        })
          .partial({
            id: true,
          })
          .meta({
            ref: "TextPartInput",
          }),
        MessageV2.FilePart.omit({
          messageID: true,
          sessionID: true,
        })
          .partial({
            id: true,
          })
          .meta({
            ref: "FilePartInput",
          }),
        MessageV2.AgentPart.omit({
          messageID: true,
          sessionID: true,
        })
          .partial({
            id: true,
          })
          .meta({
            ref: "AgentPartInput",
          }),
        MessageV2.SubtaskPart.omit({
          messageID: true,
          sessionID: true,
        })
          .partial({
            id: true,
          })
          .meta({
            ref: "SubtaskPartInput",
          }),
      ]),
    ),
  })
  export type PromptInput = z.infer<typeof PromptInput>

  export const prompt = fn(PromptInput, async (input) => {
    let session: Session.Info
    try {
      session = await Session.get(input.sessionID)
    } catch (e) {
      if (!Storage.NotFoundError.isInstance(e)) throw e
      log.info("session not found, auto-creating", { sessionID: input.sessionID })
      session = await Session.createNext({
        id: input.sessionID,
        directory: Instance.directory,
      })
    }
    await emitSessionStartOnce(session, input.agent)
    await SessionRevert.cleanup(session)

    // Handle /hold and /release commands early so mode switching still works even if
    // the memory backend/MCP is unavailable.
    const firstText = input.parts.find((p) => p.type === "text")?.text?.trim()
    if (firstText === "/hold" || firstText === "/release") {
      const message = await createUserMessage(input)
      const requestedMode = firstText === "/hold" ? "hold" : "release"

      let allowed = true
      let responseText = ""

      if (requestedMode === "release") {
        const surface = session.surface
        const isMessagingSurface = surface === "whatsapp"
        if (isMessagingSurface && !Flag.ZEE_ALLOW_MESSAGING_RELEASE) {
          allowed = false
          responseText =
            "Refusing to switch to RELEASE mode from messaging surfaces by default. " +
            "Resume this session in the CLI/TUI, or set ZEE_ALLOW_MESSAGING_RELEASE=1 to override."
        } else {
          const authConfig = getAuthConfig()
          if (!authConfig.disabled) {
            const granted = authConfig.scopes ?? [AuthScope.ADMIN]
            if (!hasScope(granted, AuthScope.ADMIN)) {
              allowed = false
              responseText = 'Refusing to switch to RELEASE mode: requires scope "operator.admin".'
            }
          }
        }
      }

      if (allowed) {
        await Session.update(input.sessionID, (draft) => {
          draft.mode = requestedMode
        })
        responseText =
          requestedMode === "hold"
            ? "Switched to HOLD mode. File modifications are restricted."
            : "Switched to RELEASE mode. Full tool access enabled."
      }
      const confirmMsg: MessageV2.Assistant = {
        id: Identifier.ascending("message"),
        sessionID: input.sessionID,
        parentID: message.info.id,
        role: "assistant",
        mode: input.agent ?? "zee",
        agent: input.agent ?? "zee",
        path: { cwd: Instance.directory, root: Instance.worktree },
        cost: 0,
        tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
        modelID: "system",
        providerID: "system",
        finish: "stop",
        time: { created: Date.now(), completed: Date.now() },
      }
      await Session.updateMessage(confirmMsg)
      await Session.updatePart({
        id: Identifier.ascending("part"),
        messageID: confirmMsg.id,
        sessionID: input.sessionID,
        type: "text",
        text: responseText,
      } satisfies MessageV2.TextPart)
      return { info: confirmMsg, parts: [] } as MessageV2.WithParts
    }

    await ensureRequiredMemory(input.sessionID)

    const message = await createUserMessage(input)
    await Session.touch(input.sessionID)

    // this is backwards compatibility for allowing `tools` to be specified when
    // prompting
    const permissions: PermissionNext.Ruleset = []
    for (const [tool, enabled] of Object.entries(input.tools ?? {})) {
      permissions.push({
        permission: tool,
        action: enabled ? "allow" : "deny",
        pattern: "*",
      })
    }
    if (permissions.length > 0) {
      session.permission = permissions
      await Session.update(session.id, (draft) => {
        draft.permission = permissions
      })
    }

    if (input.noReply === true) {
      return message
    }

    return loop(input.sessionID)
  })

  export async function resolvePromptParts(template: string): Promise<PromptInput["parts"]> {
    const parts: PromptInput["parts"] = [
      {
        type: "text",
        text: template,
      },
    ]
    const files = ConfigMarkdown.files(template)
    const seen = new Set<string>()
    await Promise.all(
      files.map(async (match) => {
        const name = match[1]
        if (seen.has(name)) return
        seen.add(name)
        const filepath = name.startsWith("~/")
          ? path.join(os.homedir(), name.slice(2))
          : path.resolve(Instance.worktree, name)

        const stats = await fs.stat(filepath).catch(() => undefined)
        if (!stats) {
          const agent = await Agent.get(name)
          if (agent) {
            parts.push({
              type: "agent",
              name: agent.name,
            })
          }
          return
        }

        if (stats.isDirectory()) {
          parts.push({
            type: "file",
            url: `file://${filepath}`,
            filename: name,
            mime: "application/x-directory",
          })
          return
        }

        parts.push({
          type: "file",
          url: `file://${filepath}`,
          filename: name,
          mime: "text/plain",
        })
      }),
    )
    return parts
  }

  function start(sessionID: string) {
    const s = state()
    if (s[sessionID]) return
    const controller = new AbortController()
    s[sessionID] = {
      abort: controller,
      callbacks: [],
    }
    return controller.signal
  }

  export function cancel(sessionID: string) {
    log.info("cancel", { sessionID })
    SessionSteering.clear(sessionID)
    const s = state()
    const match = s[sessionID]
    if (!match) {
      SessionStatus.set(sessionID, { type: "idle" })
      return
    }
    match.abort.abort()
    for (const item of match.callbacks) {
      item.reject(new DOMException("Aborted", "AbortError"))
    }
    delete s[sessionID]
    SessionStatus.set(sessionID, { type: "idle" })

    // Schedule force-kill after grace period
    forceKillAfterGracePeriod(sessionID)
    return
  }

  const FORCE_KILL_GRACE_PERIOD_MS = 5000
  const pendingForceKills = new Map<string, NodeJS.Timeout>()

  function forceKillAfterGracePeriod(sessionID: string) {
    // Clear any existing force-kill timer for this session
    const existing = pendingForceKills.get(sessionID)
    if (existing) {
      clearTimeout(existing)
    }

    // Schedule force-kill after grace period
    const timer = setTimeout(() => {
      // Forcefully clean up session state
      const s = state()
      const match = s[sessionID]

      // Only emit error and force-kill if session actually still exists
      // (i.e., it didn't clean up properly during the grace period)
      if (match) {
        log.warn("force-killing session after grace period", { sessionID, gracePeriodMs: FORCE_KILL_GRACE_PERIOD_MS })

        // Emit force-killed event for TUI to display
        Bus.publish(Session.Event.Error, {
          sessionID,
          error: new NamedError.Unknown({
            message: "Session force-killed after timeout grace period",
          }).toObject(),
        })

        match.abort.abort()
        for (const item of match.callbacks) {
          item.reject()
        }
        delete s[sessionID]

        // Ensure status is set to idle
        SessionStatus.set(sessionID, { type: "idle" })

        // Recursively force-kill any child sessions
        forceKillChildSessions(sessionID)
      }

      pendingForceKills.delete(sessionID)
    }, FORCE_KILL_GRACE_PERIOD_MS)

    pendingForceKills.set(sessionID, timer)
  }

  async function forceKillChildSessions(parentSessionID: string) {
    try {
      // Find all child sessions using Session.children()
      const childSessions = await Session.children(parentSessionID)

      for (const child of childSessions) {
        log.warn("force-killing child session", { childSessionID: child.id, parentSessionID })
        cancel(child.id)
      }
    } catch (error) {
      log.error("failed to force-kill child sessions", { parentSessionID, error })
    }
  }

  export function clearForceKillTimer(sessionID: string) {
    const timer = pendingForceKills.get(sessionID)
    if (timer) {
      clearTimeout(timer)
      pendingForceKills.delete(sessionID)
    }
  }

  export const loop = fn(Identifier.schema("session"), async (sessionID) => {
    const abort = start(sessionID)
    if (!abort) {
      return new Promise<MessageV2.WithParts>((resolve, reject) => {
        const callbacks = state()[sessionID].callbacks
        callbacks.push({ resolve, reject })
      })
    }

    using _ = defer(() => {
      clearForceKillTimer(sessionID)
      cancel(sessionID)
    })

    let step = 0
    const session = await Session.get(sessionID)
    const sessionSystemContext = await buildSessionSystemContext({
      systemPrompt: session.systemPrompt,
      skills: session.skills,
      contextFiles: session.contextFiles,
    })
    while (true) {
      SessionStatus.set(sessionID, { type: "busy" })
      log.info("loop", { step, sessionID })
      if (abort.aborted) break
      let msgs = await MessageV2.filterCompacted(MessageV2.stream(sessionID))

      let lastUser: MessageV2.User | undefined
      let lastAssistant: MessageV2.Assistant | undefined
      let lastAssistantParts: MessageV2.Part[] | undefined
      let lastFinished: MessageV2.Assistant | undefined
      let tasks: (MessageV2.CompactionPart | MessageV2.SubtaskPart)[] = []
      for (let i = msgs.length - 1; i >= 0; i--) {
        const msg = msgs[i]
        if (!lastUser && msg.info.role === "user") lastUser = msg.info as MessageV2.User
        if (!lastAssistant && msg.info.role === "assistant") {
          lastAssistant = msg.info as MessageV2.Assistant
          lastAssistantParts = msg.parts
        }
        if (!lastFinished && msg.info.role === "assistant" && msg.info.finish)
          lastFinished = msg.info as MessageV2.Assistant
        if (lastUser && lastFinished) break
        const task = msg.parts.filter((part) => part.type === "compaction" || part.type === "subtask")
        if (task && !lastFinished) {
          tasks.push(...task)
        }
      }

      if (!lastUser) throw new Error("No user message found in stream. This should never happen.")
      if (!session.toolPolicySnapshot) {
        const snapshotAgent = await Agent.get(lastUser.agent)
        const mode: "hold" | "release" = resolveHoldMode(session, lastUser.tools) ? "hold" : "release"
        const ruleset = PermissionNext.merge(snapshotAgent.permission, session.permission ?? [])
        const snapshot: NonNullable<Session.Info["toolPolicySnapshot"]> = {
          createdAt: Date.now(),
          mode,
          surface: session.surface,
          agent: snapshotAgent.name,
          permission: ruleset,
        }
        session.toolPolicySnapshot = snapshot
        await Session.update(session.id, (draft) => {
          if (draft.toolPolicySnapshot) return
          draft.toolPolicySnapshot = snapshot
        })
      }
      // Check if we should exit the loop based on assistant's finish reason
      // Continue if: pending tool calls OR pending tasks (subtask/compaction)
      // Exit if: no pending work, even if finish reason is "unknown"
      const needsToolFollowup = lastAssistantParts ? shouldContinueAfterTools(lastAssistantParts) : false
      if (needsToolFollowup && lastAssistant) {
        log.info("tool-only response detected; continuing loop", {
          sessionID,
          messageID: lastAssistant.id,
        })
      }
      const hasPendingToolCalls = lastAssistant?.finish === "tool-calls" || needsToolFollowup
      const hasPendingTasks = tasks.length > 0

      // Debug logging to diagnose tool followup issues
      if (lastAssistant?.finish) {
        const toolParts = lastAssistantParts?.filter((p) => p.type === "tool") ?? []
        const textParts = lastAssistantParts?.filter((p) => p.type === "text" && (p as any).text?.trim()) ?? []
        log.info("loop exit check", {
          sessionID,
          finish: lastAssistant.finish,
          needsToolFollowup,
          hasPendingToolCalls,
          hasPendingTasks,
          toolCount: toolParts.length,
          textCount: textParts.length,
          partsOrder: lastAssistantParts?.map((p) => p.type).join(",") ?? "none",
        })
      }

      if (
        lastAssistant?.finish &&
        !hasPendingToolCalls &&
        !hasPendingTasks &&
        lastUser.id < lastAssistant.id
      ) {
        log.info("exiting loop", { sessionID, finish: lastAssistant.finish })
        break
      }

      step++
      if (step === 1)
        ensureTitle({
          session,
          modelID: lastUser.model.modelID,
          providerID: lastUser.model.providerID,
          history: msgs,
        })

      const model = await Provider.getModel(lastUser.model.providerID, lastUser.model.modelID)
      const task = tasks.pop()

      // pending subtask
      // FUTURE: Consider centralizing tool invocation logic in a dedicated module
      // Currently, tool calls are handled here and in processor.ts
      if (task?.type === "subtask") {
        // Resolve the agent type - maps external types to personas
        // Each persona spawns its own kind: zee→zee, stanley→stanley, johny→johny
        const resolvedAgent = await resolveAgentType(task.agent, lastUser.agent)
        const taskTool = await TaskTool.init()
        const taskModel = task.model ? await Provider.getModel(task.model.providerID, task.model.modelID) : model
        const assistantMessage = (await Session.updateMessage({
          id: Identifier.ascending("message"),
          role: "assistant",
          parentID: lastUser.id,
          sessionID,
          mode: resolvedAgent,
          agent: resolvedAgent,
          path: {
            cwd: Instance.directory,
            root: Instance.worktree,
          },
          cost: 0,
          tokens: {
            input: 0,
            output: 0,
            reasoning: 0,
            cache: { read: 0, write: 0 },
          },
          modelID: taskModel.id,
          providerID: taskModel.providerID,
          time: {
            created: Date.now(),
          },
        })) as MessageV2.Assistant
        let part = (await Session.updatePart({
          id: Identifier.ascending("part"),
          messageID: assistantMessage.id,
          sessionID: assistantMessage.sessionID,
          type: "tool",
          callID: ulid(),
          tool: TaskTool.id,
          state: {
            status: "running",
            input: {
              prompt: task.prompt,
              description: task.description,
              subagent_type: resolvedAgent,
              command: task.command,
            },
            time: {
              start: Date.now(),
            },
          },
        })) as MessageV2.ToolPart
        const taskArgs = {
          prompt: task.prompt,
          description: task.description,
          subagent_type: resolvedAgent,
          command: task.command,
        }
        await Plugin.trigger(
          "before_tool_call",
          {
            tool: "task",
            sessionID,
            callID: part.id,
          },
          { args: taskArgs },
        )
        await Plugin.trigger(
          "tool.execute.before",
          {
            tool: "task",
            sessionID,
            callID: part.id,
          },
          { args: taskArgs },
        )
        let executionError: Error | undefined
        let daemonExecutionError: Error | undefined
        const taskAgent = await Agent.get(resolvedAgent)
        const taskCtx: Tool.Context = {
          agent: resolvedAgent,
          messageID: assistantMessage.id,
          sessionID: sessionID,
          abort,
          callID: part.callID,
          directory: Instance.directory,
          worktree: Instance.worktree,
          extra: { bypassAgentCheck: true },
          messages: msgs,
          async metadata(input) {
            await Session.updatePart({
              ...part,
              type: "tool",
              state: {
                ...part.state,
                ...input,
              },
            } satisfies MessageV2.ToolPart)
          },
          async ask(req) {
            await PermissionNext.ask({
              ...req,
              sessionID: sessionID,
              ruleset: PermissionNext.merge(taskAgent.permission, session.permission ?? []),
              holdMode: false, // Task tools are always in RELEASE mode (they're system-initiated)
            })
          },
        }
        let result:
          | {
              title: string
              metadata: Record<string, unknown>
              output: string
              attachments?: MessageV2.FilePart[]
            }
          | undefined

        const daemonEligibleAgent =
          resolvedAgent === "zee" || resolvedAgent === "stanley" || resolvedAgent === "johny"

        if (daemonSubtasksEnabled() && daemonEligibleAgent) {
          result = await executeSubtaskViaDaemon({
            persona: resolvedAgent,
            description: task.description,
            prompt: task.prompt,
            parentSessionID: sessionID,
            parentMessageID: assistantMessage.id,
            timeoutMs: 300000,
          }).catch((error) => {
            daemonExecutionError = error instanceof Error ? error : new Error(String(error))
            if (shouldFallbackToLocalSubtask(daemonExecutionError)) {
              log.warn("daemon subtask execution unavailable, falling back to local task tool", {
                error: daemonExecutionError.message,
                agent: resolvedAgent,
                description: task.description,
              })
              return undefined
            }
            executionError = daemonExecutionError
            log.error("daemon subtask execution failed", {
              error: daemonExecutionError.message,
              agent: resolvedAgent,
              description: task.description,
            })
            return undefined
          })
        } else if (daemonSubtasksEnabled() && !daemonEligibleAgent) {
          log.debug("daemon subtask execution skipped for non-persona agent", {
            agent: resolvedAgent,
            description: task.description,
          })
        }

        if (!result && !executionError) {
          result = await taskTool.execute(taskArgs, taskCtx).catch((error) => {
            executionError = error
            log.error("subtask execution failed", {
              error,
              agent: resolvedAgent,
              originalAgent: task.agent,
              description: task.description,
              daemonFallback: Boolean(daemonExecutionError),
            })
            return undefined
          })
        }
        await Plugin.trigger(
          "tool.execute.after",
          {
            tool: "task",
            sessionID,
            callID: part.id,
          },
          result,
        )
        assistantMessage.finish = "tool-calls"
        assistantMessage.time.completed = Date.now()
        await Session.updateMessage(assistantMessage)
        if (result && part.state.status === "running") {
          await Session.updatePart({
            ...part,
            state: {
              status: "completed",
              input: part.state.input,
              title: result.title,
              metadata: result.metadata,
              output: result.output,
              attachments: result.attachments,
              time: {
                ...part.state.time,
                end: Date.now(),
              },
            },
          } satisfies MessageV2.ToolPart)
        }
        if (!result) {
          await Session.updatePart({
            ...part,
            state: {
              status: "error",
              error: executionError ? `Tool execution failed: ${executionError.message}` : "Tool execution failed",
              time: {
                start: part.state.status === "running" ? part.state.time.start : Date.now(),
                end: Date.now(),
              },
              metadata: part.metadata,
              input: part.state.input,
            },
          } satisfies MessageV2.ToolPart)
        }

        if (task.command) {
          // Add synthetic user message to prevent certain reasoning models from erroring
          // If we create assistant messages w/ out user ones following mid loop thinking signatures
          // will be missing and it can cause errors for models like gemini for example
          const summaryUserMsg: MessageV2.User = {
            id: Identifier.ascending("message"),
            sessionID,
            role: "user",
            time: {
              created: Date.now(),
            },
            agent: lastUser.agent,
            model: lastUser.model,
          }
          await Session.updateMessage(summaryUserMsg)
          await Session.updatePart({
            id: Identifier.ascending("part"),
            messageID: summaryUserMsg.id,
            sessionID,
            type: "text",
            text: "Summarize the task tool output above and continue with your task.",
            synthetic: true,
          } satisfies MessageV2.TextPart)
        }

        continue
      }

      // pending compaction
      if (task?.type === "compaction") {
        const result = await SessionCompaction.process({
          messages: msgs,
          parentID: lastUser.id,
          abort,
          sessionID,
          auto: task.auto,
        })
        if (result === "stop") break
        continue
      }

      // context overflow, needs compaction
      if (
        lastFinished &&
        lastFinished.summary !== true &&
        (await SessionCompaction.isOverflow({ tokens: lastFinished.tokens, model }))
      ) {
        await SessionCompaction.create({
          sessionID,
          agent: lastUser.agent,
          model: lastUser.model,
          auto: true,
        })
        continue
      }

      // normal processing
      const baseAgent = await Agent.get(lastUser.agent)
      const agent = lastUser.options
        ? { ...baseAgent, options: mergeDeep(baseAgent.options, lastUser.options) }
        : baseAgent
      const maxSteps = agent.steps ?? Infinity
      const isLastStep = step >= maxSteps
      msgs = await insertReminders({
        messages: msgs,
        agent,
        sessionID,
      })

      const processor = SessionProcessor.create({
        assistantMessage: (await Session.updateMessage({
          id: Identifier.ascending("message"),
          parentID: lastUser.id,
          role: "assistant",
          mode: agent.name,
          agent: agent.name,
          path: {
            cwd: Instance.directory,
            root: Instance.worktree,
          },
          cost: 0,
          tokens: {
            input: 0,
            output: 0,
            reasoning: 0,
            cache: { read: 0, write: 0 },
          },
          modelID: model.id,
          providerID: model.providerID,
          time: {
            created: Date.now(),
          },
          sessionID,
        })) as MessageV2.Assistant,
        sessionID: sessionID,
        model,
        abort,
      })
      using _ = defer(() => InstructionPrompt.clear(processor.message.id))

      // Check if user explicitly invoked an agent via @ in this turn
      const lastUserMsg = msgs.findLast((m) => m.info.role === "user")
      const bypassAgentCheck = lastUserMsg?.parts.some((p) => p.type === "agent") ?? false

      const tools = await resolveTools({
        agent,
        session,
        model,
        tools: lastUser.tools,
        options: lastUser.options,
        processor,
        bypassAgentCheck,
        messages: msgs,
      })

      if (step === 1) {
        SessionSummary.summarize({
          sessionID: sessionID,
          messageID: lastUser.id,
        })
      }

      const sessionMessages = clone(msgs)

      // Ephemerally wrap queued user messages with a reminder to stay on track
      if (step > 1 && lastFinished) {
        for (const msg of sessionMessages) {
          if (msg.info.role !== "user" || msg.info.id <= lastFinished.id) continue
          for (const part of msg.parts) {
            if (part.type !== "text" || part.ignored || part.synthetic) continue
            if (!part.text.trim()) continue
            part.text = [
              "<system-reminder>",
              "The user sent the following message:",
              part.text,
              "",
              "Please address this message and continue with your tasks.",
              "</system-reminder>",
            ].join("\n")
          }
        }
      }

      await Plugin.trigger("experimental.chat.messages.transform", {}, { messages: sessionMessages })
      const planState = await resolveFirstTurnPlanState({
        session,
        messages: sessionMessages,
        messageTools: lastUser.tools,
      })

      const result = await processor.process({
        user: lastUser,
        agent,
        abort,
        sessionID,
        system: [
          ...(await SystemPrompt.environment(model)),
          ...(await InstructionPrompt.system()),
          ...sessionSystemContext,
          ...(resolveHoldMode(session, lastUser.tools) ? [HOLD_MODE_PROMPT] : []),
          ...(planState.enabled ? [FIRST_TURN_PLAN_PROMPT] : []),
        ],
        messages: [
          ...(await MessageV2.toModelMessage(sessionMessages, model)),
          ...(isLastStep
            ? [
                {
                  role: "assistant" as const,
                  content: MAX_STEPS,
                },
              ]
            : []),
        ],
        tools,
        model,
      })
      if (planState.enabled) {
        try {
          await writeFirstPlanFile({
            session,
            planPath: planState.planPath,
            assistantMessageID: processor.message.id,
          })
        } catch (error) {
          log.warn("failed to write first-turn plan file", {
            sessionID,
            error: error instanceof Error ? error.message : String(error),
          })
        }
      }
      if (result === "stop") break
      if (result === "steered") {
        SessionSteering.clear(sessionID)
        continue
      }
      if (result === "compact") {
        await SessionCompaction.create({
          sessionID,
          agent: lastUser.agent,
          model: lastUser.model,
          auto: true,
        })
      }
      continue
    }
    SessionCompaction.prune({ sessionID })
    for await (const item of MessageV2.stream(sessionID)) {
      if (item.info.role === "user") continue
      const queued = state()[sessionID]?.callbacks ?? []
      for (const q of queued) {
        q.resolve(item)
      }
      return item
    }
    throw new Error("Impossible")
  })

  function shouldContinueAfterTools(parts: MessageV2.Part[]): boolean {
    let lastToolIndex = -1
    let lastTextIndex = -1
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]
      if (part.type === "tool") lastToolIndex = i
      if (part.type === "text" && (part as any).text?.trim()) lastTextIndex = i
    }
    // Debug: Log what we found
    log.debug("shouldContinueAfterTools", {
      totalParts: parts.length,
      lastToolIndex,
      lastTextIndex,
      partsTypes: parts.map((p) => p.type),
      result: lastToolIndex === -1 ? false : lastTextIndex === -1 ? true : lastTextIndex < lastToolIndex,
    })
    if (lastToolIndex === -1) return false
    if (lastTextIndex === -1) return true
    return lastTextIndex < lastToolIndex
  }

  async function lastModel(sessionID: string) {
    for await (const item of MessageV2.stream(sessionID)) {
      if (item.info.role === "user" && item.info.model) return item.info.model
    }
    return Provider.defaultModel()
  }

  async function resolveTools(input: {
    agent: Agent.Info
    model: Provider.Model
    session: Session.Info
    tools?: Record<string, boolean>
    options?: Record<string, any>
    processor: SessionProcessor.Info
    bypassAgentCheck: boolean
    messages: MessageV2.WithParts[]
  }) {
    using _ = log.time("resolveTools")
    const tools: Record<string, AITool> = {}

    const holdMode = resolveHoldMode(input.session, input.tools)
    const skipPermissions = resolveSkipPermissions(input.session, input.tools, input.options)

    const context = (args: any, options: ToolCallOptions): Tool.Context => ({
      sessionID: input.session.id,
      abort: options.abortSignal!,
      messageID: input.processor.message.id,
      callID: options.toolCallId,
      directory: Instance.directory,
      worktree: Instance.worktree,
      extra: {
        model: input.model,
        bypassAgentCheck: input.bypassAgentCheck,
        holdMode,
        skipPermissions,
      },
      agent: input.agent.name,
      messages: input.messages,
      metadata: async (val: { title?: string; metadata?: any }) => {
        const match = input.processor.partFromToolCall(options.toolCallId)
        if (match && match.state.status === "running") {
          await Session.updatePart({
            ...match,
            state: {
              title: val.title,
              metadata: val.metadata,
              status: "running",
              input: args,
              time: {
                start: Date.now(),
              },
            },
          })
        }
      },
      async ask(req) {
        await PermissionNext.ask({
          ...req,
          sessionID: input.session.id,
          tool: { messageID: input.processor.message.id, callID: options.toolCallId },
          ruleset: PermissionNext.merge(input.agent.permission, input.session.permission ?? []),
          // skipPermissions ("no cuffs") should bypass permission UX entirely.
          holdMode: skipPermissions ? false : holdMode,
        })
      },
    })

    for (const item of await ToolRegistry.tools(
      { modelID: input.model.api.id, providerID: input.model.providerID },
      input.agent,
    )) {
      const schema = ProviderTransform.schema(input.model, z.toJSONSchema(item.parameters))
      tools[item.id] = tool({
        // Type assertion needed: AI SDK tool() requires specific string literal types, but our dynamic IDs are string variables
        id: item.id as any,
        description: item.description,
        // Type assertion needed: AI SDK jsonSchema() expects JSONSchema7 but zod's toJSONSchema output has subtle type differences
        inputSchema: jsonSchema(schema as any),
        async execute(args, options) {
          const ctx = context(args, options)
          await Plugin.trigger(
            "before_tool_call",
            {
              tool: item.id,
              sessionID: ctx.sessionID,
              callID: ctx.callID,
            },
            {
              args,
            },
          )
          await Plugin.trigger(
            "tool.execute.before",
            {
              tool: item.id,
              sessionID: ctx.sessionID,
              callID: ctx.callID,
            },
            {
              args,
            },
          )
          const result = await item.execute(args, ctx)
          await Plugin.trigger(
            "tool.execute.after",
            {
              tool: item.id,
              sessionID: ctx.sessionID,
              callID: ctx.callID,
            },
            result,
          )
          return result
        },
        toModelOutput(result) {
          return {
            type: "text",
            value: result.output,
          }
        },
      })
    }

    for (const [key, item] of Object.entries(await MCP.tools())) {
      const execute = item.execute
      if (!execute) continue

      const inputSchema = asSchema(item.inputSchema)
      const schemaJson = await Promise.resolve(inputSchema.jsonSchema)
      const transformed = ProviderTransform.schema(input.model, schemaJson)
      item.inputSchema = jsonSchema(transformed)
      // Wrap execute to add plugin hooks and format output
      item.execute = async (args, opts) => {
        const ctx = context(args, opts)

        await Plugin.trigger(
          "before_tool_call",
          {
            tool: key,
            sessionID: ctx.sessionID,
            callID: opts.toolCallId,
          },
          {
            args,
          },
        )

        await Plugin.trigger(
          "tool.execute.before",
          {
            tool: key,
            sessionID: ctx.sessionID,
            callID: opts.toolCallId,
          },
          {
            args,
          },
        )

        await ctx.ask({
          permission: key,
          metadata: {},
          patterns: ["*"],
          always: ["*"],
        })

        const result = await execute(args, opts)

        await Plugin.trigger(
          "tool.execute.after",
          {
            tool: key,
            sessionID: ctx.sessionID,
            callID: opts.toolCallId,
          },
          result,
        )

        const textParts: string[] = []
        const attachments: MessageV2.FilePart[] = []

        for (const contentItem of result.content) {
          if (contentItem.type === "text") {
            textParts.push(contentItem.text)
          } else if (contentItem.type === "image") {
            attachments.push({
              id: Identifier.ascending("part"),
              sessionID: input.session.id,
              messageID: input.processor.message.id,
              type: "file",
              mime: contentItem.mimeType,
              url: `data:${contentItem.mimeType};base64,${contentItem.data}`,
            })
          } else if (contentItem.type === "resource") {
            const { resource } = contentItem
            if (resource.text) {
              textParts.push(resource.text)
            }
            if (resource.blob) {
              attachments.push({
                id: Identifier.ascending("part"),
                sessionID: input.session.id,
                messageID: input.processor.message.id,
                type: "file",
                mime: resource.mimeType ?? "application/octet-stream",
                url: `data:${resource.mimeType ?? "application/octet-stream"};base64,${resource.blob}`,
                filename: resource.uri,
              })
            }
          }
        }

        const truncated = await Truncate.output(textParts.join("\n\n"), {}, input.agent)
        const metadata = {
          ...(result.metadata ?? {}),
          truncated: truncated.truncated,
          ...(truncated.truncated && { outputPath: truncated.outputPath }),
        }

        return {
          title: "",
          metadata,
          output: truncated.content,
          attachments,
          content: result.content, // directly return content to preserve ordering when outputting to model
        }
      }
      item.toModelOutput = (result) => {
        return {
          type: "text",
          value: result.output,
        }
      }
      tools[key] = item
    }

    return tools
  }

  async function createUserMessage(input: PromptInput) {
    const agent = await Agent.get(input.agent ?? (await Agent.defaultAgent()))
    const info: MessageV2.Info = {
      id: input.messageID ?? Identifier.ascending("message"),
      role: "user",
      sessionID: input.sessionID,
      time: {
        created: Date.now(),
      },
      tools: input.tools,
      agent: agent.name,
      model: input.model ?? agent.model ?? (await lastModel(input.sessionID)),
      system: input.system,
      options: input.options,
      variant: input.variant,
    }
    using _ = defer(() => InstructionPrompt.clear(info.id))

    const parts = await Promise.all(
      input.parts.map(async (part): Promise<MessageV2.Part[]> => {
        if (part.type === "file") {
          // before checking the protocol we check if this is an mcp resource because it needs special handling
          if (part.source?.type === "resource") {
            const { clientName, uri } = part.source
            log.info("mcp resource", { clientName, uri, mime: part.mime })

            const pieces: MessageV2.Part[] = [
              {
                id: Identifier.ascending("part"),
                messageID: info.id,
                sessionID: input.sessionID,
                type: "text",
                synthetic: true,
                text: `Reading MCP resource: ${part.filename} (${uri})`,
              },
            ]

            try {
              const resourceContent = await MCP.readResource(clientName, uri)
              if (!resourceContent) {
                throw new Error(`Resource not found: ${clientName}/${uri}`)
              }

              // Handle different content types
              const contents = Array.isArray(resourceContent.contents)
                ? resourceContent.contents
                : [resourceContent.contents]

              for (const content of contents) {
                if ("text" in content && content.text) {
                  pieces.push({
                    id: Identifier.ascending("part"),
                    messageID: info.id,
                    sessionID: input.sessionID,
                    type: "text",
                    synthetic: true,
                    text: content.text as string,
                  })
                } else if ("blob" in content && content.blob) {
                  // Handle binary content if needed
                  const mimeType = "mimeType" in content ? content.mimeType : part.mime
                  pieces.push({
                    id: Identifier.ascending("part"),
                    messageID: info.id,
                    sessionID: input.sessionID,
                    type: "text",
                    synthetic: true,
                    text: `[Binary content: ${mimeType}]`,
                  })
                }
              }

              pieces.push({
                ...part,
                id: part.id ?? Identifier.ascending("part"),
                messageID: info.id,
                sessionID: input.sessionID,
              })
            } catch (error: unknown) {
              log.error("failed to read MCP resource", { error, clientName, uri })
              const message = error instanceof Error ? error.message : String(error)
              pieces.push({
                id: Identifier.ascending("part"),
                messageID: info.id,
                sessionID: input.sessionID,
                type: "text",
                synthetic: true,
                text: `Failed to read MCP resource ${part.filename}: ${message}`,
              })
            }

            return pieces
          }
          const url = new URL(part.url)
          switch (url.protocol) {
            case "data:":
              if (part.mime === "text/plain") {
                return [
                  {
                    id: Identifier.ascending("part"),
                    messageID: info.id,
                    sessionID: input.sessionID,
                    type: "text",
                    synthetic: true,
                    text: `Called the Read tool with the following input: ${JSON.stringify({ filePath: part.filename })}`,
                  },
                  {
                    id: Identifier.ascending("part"),
                    messageID: info.id,
                    sessionID: input.sessionID,
                    type: "text",
                    synthetic: true,
                    text: Buffer.from(part.url, "base64url").toString(),
                  },
                  {
                    ...part,
                    id: part.id ?? Identifier.ascending("part"),
                    messageID: info.id,
                    sessionID: input.sessionID,
                  },
                ]
              }
              break
            case "file:":
              log.info("file", { mime: part.mime })
              // have to normalize, symbol search returns absolute paths
              // Decode the pathname since URL constructor doesn't automatically decode it
              const filepath = fileURLToPath(part.url)
              const stat = await Bun.file(filepath)
                .stat()
                .catch(() => undefined)

              if (stat?.isDirectory()) {
                part.mime = "application/x-directory"
              }

              if (part.mime === "text/plain") {
                let offset: number | undefined = undefined
                let limit: number | undefined = undefined
                const range = {
                  start: url.searchParams.get("start"),
                  end: url.searchParams.get("end"),
                }
                if (range.start != null) {
                  const filePathURI = part.url.split("?")[0]
                  let start = parseInt(range.start)
                  let end = range.end ? parseInt(range.end) : undefined
                  // some LSP servers (eg, gopls) don't give full range in
                  // workspace/symbol searches, so we'll try to find the
                  // symbol in the document to get the full range
                  if (start === end) {
                    const symbols = await LSP.documentSymbol(filePathURI).catch(() => [])
                    for (const symbol of symbols) {
                      let range: LSP.Range | undefined
                      if ("range" in symbol) {
                        range = symbol.range
                      } else if ("location" in symbol) {
                        range = symbol.location.range
                      }
                      if (range?.start?.line && range?.start?.line === start) {
                        start = range.start.line
                        end = range?.end?.line ?? start
                        break
                      }
                    }
                  }
                  offset = Math.max(start - 1, 0)
                  if (end) {
                    limit = end - offset
                  }
                }
                const args = { filePath: filepath, offset, limit }

                const pieces: MessageV2.Part[] = [
                  {
                    id: Identifier.ascending("part"),
                    messageID: info.id,
                    sessionID: input.sessionID,
                    type: "text",
                    synthetic: true,
                    text: `Called the Read tool with the following input: ${JSON.stringify(args)}`,
                  },
                ]

                await ReadTool.init()
                  .then(async (t) => {
                    const model = await Provider.getModel(info.model.providerID, info.model.modelID)
                    const readCtx: Tool.Context = {
                      sessionID: input.sessionID,
                      abort: new AbortController().signal,
                      agent: input.agent!,
                      messageID: info.id,
                      directory: Instance.directory,
                      worktree: Instance.worktree,
                      extra: { bypassCwdCheck: true, model },
                      messages: [],
                      metadata: async () => {},
                      ask: async () => {},
                    }
                    const result = await t.execute(args, readCtx)
                    pieces.push({
                      id: Identifier.ascending("part"),
                      messageID: info.id,
                      sessionID: input.sessionID,
                      type: "text",
                      synthetic: true,
                      text: result.output,
                    })
                    if (result.attachments?.length) {
                      pieces.push(
                        ...result.attachments.map((attachment) => ({
                          ...attachment,
                          synthetic: true,
                          filename: attachment.filename ?? part.filename,
                          messageID: info.id,
                          sessionID: input.sessionID,
                        })),
                      )
                    } else {
                      pieces.push({
                        ...part,
                        id: part.id ?? Identifier.ascending("part"),
                        messageID: info.id,
                        sessionID: input.sessionID,
                      })
                    }
                  })
                  .catch((error) => {
                    log.error("failed to read file", { error })
                    const message = error instanceof Error ? error.message : error.toString()
                    Bus.publish(Session.Event.Error, {
                      sessionID: input.sessionID,
                      error: new NamedError.Unknown({
                        message,
                      }).toObject(),
                    })
                    pieces.push({
                      id: Identifier.ascending("part"),
                      messageID: info.id,
                      sessionID: input.sessionID,
                      type: "text",
                      synthetic: true,
                      text: `Read tool failed to read ${filepath} with the following error: ${message}`,
                    })
                  })

                return pieces
              }

              if (part.mime === "application/x-directory") {
                const args = { path: filepath }
                const listCtx: Tool.Context = {
                  sessionID: input.sessionID,
                  abort: new AbortController().signal,
                  agent: input.agent!,
                  messageID: info.id,
                  directory: Instance.directory,
                  worktree: Instance.worktree,
                  extra: { bypassCwdCheck: true },
                  messages: [],
                  metadata: async () => {},
                  ask: async () => {},
                }
                const result = await ListTool.init().then((t) => t.execute(args, listCtx))
                return [
                  {
                    id: Identifier.ascending("part"),
                    messageID: info.id,
                    sessionID: input.sessionID,
                    type: "text",
                    synthetic: true,
                    text: `Called the list tool with the following input: ${JSON.stringify(args)}`,
                  },
                  {
                    id: Identifier.ascending("part"),
                    messageID: info.id,
                    sessionID: input.sessionID,
                    type: "text",
                    synthetic: true,
                    text: result.output,
                  },
                  {
                    ...part,
                    id: part.id ?? Identifier.ascending("part"),
                    messageID: info.id,
                    sessionID: input.sessionID,
                  },
                ]
              }

              const file = Bun.file(filepath)
              FileTime.read(input.sessionID, filepath)
              return [
                {
                  id: Identifier.ascending("part"),
                  messageID: info.id,
                  sessionID: input.sessionID,
                  type: "text",
                  text: `Called the Read tool with the following input: {\"filePath\":\"${filepath}\"}`,
                  synthetic: true,
                },
                {
                  id: part.id ?? Identifier.ascending("part"),
                  messageID: info.id,
                  sessionID: input.sessionID,
                  type: "file",
                  url: `data:${part.mime};base64,` + Buffer.from(await file.bytes()).toString("base64"),
                  mime: part.mime,
                  filename: part.filename!,
                  source: part.source,
                },
              ]
          }
        }

        if (part.type === "agent") {
          // Check if this agent would be denied by task permission
          const perm = PermissionNext.evaluate("task", part.name, agent.permission)
          const hint = perm.action === "deny" ? " . Invoked by user; guaranteed to exist." : ""
          return [
            {
              id: Identifier.ascending("part"),
              ...part,
              messageID: info.id,
              sessionID: input.sessionID,
            },
            {
              id: Identifier.ascending("part"),
              messageID: info.id,
              sessionID: input.sessionID,
              type: "text",
              synthetic: true,
              // An extra space is added here. Otherwise the 'Use' gets appended
              // to user's last word; making a combined word
              text:
                " Use the above message and context to generate a prompt and call the task tool with subagent: " +
                part.name +
                hint,
            },
          ]
        }

        return [
          {
            id: Identifier.ascending("part"),
            ...part,
            messageID: info.id,
            sessionID: input.sessionID,
          },
        ]
      }),
    ).then((x) => x.flat())

    await Plugin.trigger(
      "chat.message",
      {
        sessionID: input.sessionID,
        agent: input.agent,
        model: input.model,
        messageID: input.messageID,
        variant: input.variant,
      },
      {
        message: info,
        parts,
      },
    )

    await Session.updateMessage(info)
    for (const part of parts) {
      await Session.updatePart(part)
    }

    return {
      info,
      parts,
    }
  }

  async function insertReminders(input: { messages: MessageV2.WithParts[]; agent: Agent.Info; sessionID: string }) {
    const userMessage = input.messages.findLast((msg) => msg.info.role === "user")
    if (!userMessage) return input.messages

    // NOTE: Plan/build agent reminders removed - hold/release mode now handles this in the TUI

    // Todo continuation reminder
    const todos = await Todo.get(input.sessionID)
    if (todos.length > 0) {
      const incompleteTodos = todos.filter((t) => t.status !== "completed" && t.status !== "cancelled")
      const inProgress = todos.filter((t) => t.status === "in_progress")
      const pending = todos.filter((t) => t.status === "pending")
      const completedCount = todos.filter((t) => t.status === "completed").length

      if (incompleteTodos.length > 0) {
        const todoList = incompleteTodos
          .slice(0, 5)
          .map((t) => `- [${t.status === "in_progress" ? "IN PROGRESS" : "PENDING"}] ${t.content}`)
          .join("\n")

        const reminderText = [
          "<system-reminder>",
          "[TODO CONTINUATION]",
          "",
          `You have ${incompleteTodos.length} incomplete tasks (${completedCount}/${todos.length} completed):`,
          todoList,
          incompleteTodos.length > 5 ? `... and ${incompleteTodos.length - 5} more` : "",
          "",
          "Continue working on these tasks:",
          "- Proceed without asking for permission",
          "- Mark each task complete when finished",
          "- Do not stop until all tasks are done",
          "</system-reminder>",
        ]
          .filter(Boolean)
          .join("\n")

        userMessage.parts.push({
          id: Identifier.ascending("part"),
          messageID: userMessage.info.id,
          sessionID: userMessage.info.sessionID,
          type: "text",
          text: reminderText,
          synthetic: true,
        })
      }
    }

    return input.messages
  }

  export const ShellInput = z.object({
    sessionID: Identifier.schema("session"),
    agent: z.string(),
    model: z
      .object({
        providerID: z.string(),
        modelID: z.string(),
      })
      .optional(),
    command: z.string(),
  })
  export type ShellInput = z.infer<typeof ShellInput>
  export async function shell(input: ShellInput) {
    const abort = start(input.sessionID)
    if (!abort) {
      throw new Session.BusyError(input.sessionID)
    }
    using _ = defer(() => cancel(input.sessionID))

    const session = await Session.get(input.sessionID)
    if (session.revert) {
      await SessionRevert.cleanup(session)
    }
    const agent = await Agent.get(input.agent)
    const model = input.model ?? agent.model ?? (await lastModel(input.sessionID))
    const userMsg: MessageV2.User = {
      id: Identifier.ascending("message"),
      sessionID: input.sessionID,
      time: {
        created: Date.now(),
      },
      role: "user",
      agent: input.agent,
      model: {
        providerID: model.providerID,
        modelID: model.modelID,
      },
    }
    await Session.updateMessage(userMsg)
    const userPart: MessageV2.Part = {
      type: "text",
      id: Identifier.ascending("part"),
      messageID: userMsg.id,
      sessionID: input.sessionID,
      text: "The following tool was executed by the user",
      synthetic: true,
    }
    await Session.updatePart(userPart)

    const msg: MessageV2.Assistant = {
      id: Identifier.ascending("message"),
      sessionID: input.sessionID,
      parentID: userMsg.id,
      mode: input.agent,
      agent: input.agent,
      cost: 0,
      path: {
        cwd: Instance.directory,
        root: Instance.worktree,
      },
      time: {
        created: Date.now(),
      },
      role: "assistant",
      tokens: {
        input: 0,
        output: 0,
        reasoning: 0,
        cache: { read: 0, write: 0 },
      },
      modelID: model.modelID,
      providerID: model.providerID,
    }
    await Session.updateMessage(msg)
    const part: MessageV2.Part = {
      type: "tool",
      id: Identifier.ascending("part"),
      messageID: msg.id,
      sessionID: input.sessionID,
      tool: "bash",
      callID: ulid(),
      state: {
        status: "running",
        time: {
          start: Date.now(),
        },
        input: {
          command: input.command,
        },
      },
    }
    await Session.updatePart(part)
    const shell = Shell.preferred()
    const shellName = (
      process.platform === "win32" ? path.win32.basename(shell, ".exe") : path.basename(shell)
    ).toLowerCase()

    const invocations: Record<string, { args: string[] }> = {
      nu: {
        args: ["-c", input.command],
      },
      fish: {
        args: ["-c", input.command],
      },
      zsh: {
        args: [
          "-c",
          "-l",
          `
            [[ -f ~/.zshenv ]] && source ~/.zshenv >/dev/null 2>&1 || true
            [[ -f "\${ZDOTDIR:-$HOME}/.zshrc" ]] && source "\${ZDOTDIR:-$HOME}/.zshrc" >/dev/null 2>&1 || true
            eval ${JSON.stringify(input.command)}
          `,
        ],
      },
      bash: {
        args: [
          "-c",
          "-l",
          `
            shopt -s expand_aliases
            [[ -f ~/.bashrc ]] && source ~/.bashrc >/dev/null 2>&1 || true
            eval ${JSON.stringify(input.command)}
          `,
        ],
      },
      // Windows cmd
      cmd: {
        args: ["/c", input.command],
      },
      // Windows PowerShell
      powershell: {
        args: ["-NoProfile", "-Command", input.command],
      },
      pwsh: {
        args: ["-NoProfile", "-Command", input.command],
      },
      // Fallback: any shell that doesn't match those above
      //  - No -l, for max compatibility
      "": {
        args: ["-c", `${input.command}`],
      },
    }

    const matchingInvocation = invocations[shellName] ?? invocations[""]
    const args = matchingInvocation?.args

    const cwd = Instance.directory
    const shellEnv = await Plugin.trigger("shell.env", { cwd }, { env: {} })
    const safeEnv = createSafeEnv(process.env, { validatePath: process.platform !== "win32" })
    const proc = spawn(shell, args, {
      cwd,
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...safeEnv,
        ...shellEnv.env,
        TERM: "dumb",
      },
    })

    let output = ""

    proc.stdout?.on("data", (chunk) => {
      output += chunk.toString()
      if (part.state.status === "running") {
        part.state.metadata = {
          output: output,
          description: "",
        }
        Session.updatePart(part)
      }
    })

    proc.stderr?.on("data", (chunk) => {
      output += chunk.toString()
      if (part.state.status === "running") {
        part.state.metadata = {
          output: output,
          description: "",
        }
        Session.updatePart(part)
      }
    })

    let aborted = false
    let exited = false

    const kill = () => Shell.killTree(proc, { exited: () => exited })

    if (abort.aborted) {
      aborted = true
      await kill()
    }

    const abortHandler = () => {
      aborted = true
      void kill()
    }

    abort.addEventListener("abort", abortHandler, { once: true })

    await new Promise<void>((resolve) => {
      proc.on("close", () => {
        exited = true
        abort.removeEventListener("abort", abortHandler)
        resolve()
      })
    })

    if (aborted) {
      output += "\n\n" + ["<metadata>", "User aborted the command", "</metadata>"].join("\n")
    }
    msg.time.completed = Date.now()
    await Session.updateMessage(msg)
    if (part.state.status === "running") {
      part.state = {
        status: "completed",
        time: {
          ...part.state.time,
          end: Date.now(),
        },
        input: part.state.input,
        title: "",
        metadata: {
          output,
          description: "",
        },
        output,
      }
      await Session.updatePart(part)
    }
    return { info: msg, parts: [part] }
  }

  export const CommandInput = z.object({
    messageID: Identifier.schema("message").optional(),
    sessionID: Identifier.schema("session"),
    agent: z.string().optional(),
    model: z.string().optional(),
    arguments: z.string(),
    command: z.string(),
    variant: z.string().optional(),
    tools: z.record(z.string(), z.boolean()).optional(),
    parts: z
      .array(
        z.discriminatedUnion("type", [
          MessageV2.FilePart.omit({
            messageID: true,
            sessionID: true,
          }).partial({
            id: true,
          }),
        ]),
      )
      .optional(),
  })
  export type CommandInput = z.infer<typeof CommandInput>
  const bashRegex = /!`([^`]+)`/g
  const placeholderRegex = /\$(\d+)/g
  const imageTokenRegex = /^\[image\s+\d+\]/i

  function tokenizeArguments(input: string): string[] {
    const tokens: string[] = []
    const length = input.length
    let index = 0

    const isWhitespace = (value: string) => /\s/.test(value)

    while (index < length) {
      while (index < length && isWhitespace(input[index]!)) index++
      if (index >= length) break

      const imageMatch = imageTokenRegex.exec(input.slice(index))
      if (imageMatch) {
        tokens.push(imageMatch[0])
        index += imageMatch[0].length
        continue
      }

      let quote: "'" | '"' | null = null
      if (input[index] === "'" || input[index] === '"') {
        quote = input[index] as "'" | '"'
        index++
      }

      let token = ""
      while (index < length) {
        const char = input[index]!
        if (quote) {
          if (char === quote) {
            index++
            break
          }
          token += char
          index++
          continue
        }

        if (isWhitespace(char)) break
        if (char === "'" || char === '"') break
        token += char
        index++
      }

      if (token.length > 0 || quote) {
        tokens.push(token)
      }
    }

    return tokens
  }
  /**
   * Regular expression to match @ file references in text
   * Matches @ followed by file paths, excluding commas, periods at end of sentences, and backticks
   * Does not match when preceded by word characters or backticks (to avoid email addresses and quoted references)
   */

  export async function command(input: CommandInput) {
    log.info("command", input)
    const command = await Command.get(input.command)
    const agentName = command.agent ?? input.agent ?? (await Agent.defaultAgent())
    const session = await Session.get(input.sessionID)
    await emitSessionStartOnce(session, agentName)

    const args = tokenizeArguments(input.arguments)

    const templateCommand = await command.template

    const placeholders = templateCommand.match(placeholderRegex) ?? []
    let last = 0
    for (const item of placeholders) {
      const value = Number(item.slice(1))
      if (value > last) last = value
    }

    // Let the final placeholder swallow any extra arguments so prompts read naturally
    const withArgs = templateCommand.replaceAll(placeholderRegex, (_, index) => {
      const position = Number(index)
      const argIndex = position - 1
      if (argIndex >= args.length) return ""
      if (position === last) return args.slice(argIndex).join(" ")
      return args[argIndex]
    })
    const usesArgumentsPlaceholder = templateCommand.includes("$ARGUMENTS")
    let template = withArgs.replaceAll("$ARGUMENTS", input.arguments)

    // If command doesn't explicitly handle arguments (no $N or $ARGUMENTS placeholders)
    // but user provided arguments, append them to the template
    if (placeholders.length === 0 && !usesArgumentsPlaceholder && input.arguments.trim()) {
      template = template + "\n\n" + input.arguments
    }

    const shell = ConfigMarkdown.shell(template)
    if (shell.length > 0) {
      const results = await Promise.all(
        shell.map(async ([, cmd]) => {
          try {
            return await $`${{ raw: cmd }}`.quiet().nothrow().text()
          } catch (error) {
            return `Error executing command: ${error instanceof Error ? error.message : String(error)}`
          }
        }),
      )
      let index = 0
      template = template.replace(bashRegex, () => results[index++])
    }
    template = template.trim()

    const taskModel = await (async () => {
      if (command.model) {
        return Provider.parseModel(command.model)
      }
      if (command.agent) {
        const cmdAgent = await Agent.get(command.agent)
        if (cmdAgent?.model) {
          return cmdAgent.model
        }
      }
      if (input.model) return input.model
      return await lastModel(input.sessionID)
    })()

    // Handle both legacy string format ("provider/model") and object format
    const resolvedModel = typeof taskModel === "string" ? Provider.parseModel(taskModel) : taskModel

    try {
      await Provider.getModel(resolvedModel.providerID, resolvedModel.modelID)
    } catch (e) {
      if (Provider.ModelNotFoundError.isInstance(e)) {
        const { providerID, modelID, suggestions } = e.data
        const hint = suggestions?.length ? ` Did you mean: ${suggestions.join(", ")}?` : ""
        Bus.publish(Session.Event.Error, {
          sessionID: input.sessionID,
          error: new NamedError.Unknown({ message: `Model not found: ${providerID}/${modelID}.${hint}` }).toObject(),
        })
      }
      throw e
    }
    const agent = await Agent.get(agentName)
    if (!agent) {
      const available = await Agent.list().then((agents) => agents.filter((a) => !a.hidden).map((a) => a.name))
      const hint = available.length ? ` Available agents: ${available.join(", ")}` : ""
      const error = new NamedError.Unknown({ message: `Agent not found: "${agentName}".${hint}` })
      Bus.publish(Session.Event.Error, {
        sessionID: input.sessionID,
        error: error.toObject(),
      })
      throw error
    }

    const templateParts = await resolvePromptParts(template)
    const isSubtask = (agent.mode === "subagent" && command.subtask !== false) || command.subtask === true
    const parts = isSubtask
      ? [
          {
            type: "subtask" as const,
            agent: agent.name,
            description: command.description ?? "",
            command: input.command,
            model: {
              providerID: resolvedModel.providerID,
              modelID: resolvedModel.modelID,
            },
            // LIMITATION: Task tool currently only takes text prompt, not complex parts
            // This is intentional for simplicity; subagents get minimal context
            prompt: templateParts.find((y) => y.type === "text")?.text ?? "",
          },
        ]
      : [...templateParts, ...(input.parts ?? [])]

    const userAgent = isSubtask ? (input.agent ?? (await Agent.defaultAgent())) : agentName
    const userModel = isSubtask
      ? input.model
        ? Provider.parseModel(input.model)
        : await lastModel(input.sessionID)
      : resolvedModel

    await Plugin.trigger(
      "command.execute.before",
      {
        command: input.command,
        sessionID: input.sessionID,
        arguments: input.arguments,
      },
      { parts },
    )

    const result = (await prompt({
      sessionID: input.sessionID,
      messageID: input.messageID,
      model: userModel,
      agent: userAgent,
      parts,
      variant: input.variant,
      tools: input.tools,
    })) as MessageV2.WithParts

    Bus.publish(Command.Event.Executed, {
      name: input.command,
      sessionID: input.sessionID,
      arguments: input.arguments,
      messageID: result.info.id,
    })

    return result
  }

  async function ensureTitle(input: {
    session: Session.Info
    history: MessageV2.WithParts[]
    providerID: string
    modelID: string
  }) {
    if (input.session.parentID) return
    if (!Session.isDefaultTitle(input.session.title)) return

    // Find first non-synthetic user message
    const firstRealUserIdx = input.history.findIndex(
      (m) => m.info.role === "user" && !m.parts.every((p) => "synthetic" in p && p.synthetic),
    )
    if (firstRealUserIdx === -1) return

    const isFirst =
      input.history.filter((m) => m.info.role === "user" && !m.parts.every((p) => "synthetic" in p && p.synthetic))
        .length === 1
    if (!isFirst) return

    // Gather all messages up to and including the first real user message for context
    // This includes any shell/subtask executions that preceded the user's first prompt
    const contextMessages = input.history.slice(0, firstRealUserIdx + 1)
    const firstRealUser = contextMessages[firstRealUserIdx]

    // For subtask-only messages (from command invocations), extract the prompt directly
    // since toModelMessage converts subtask parts to generic "The following tool was executed by the user"
    const subtaskParts = firstRealUser.parts.filter((p) => p.type === "subtask") as MessageV2.SubtaskPart[]
    const hasOnlySubtaskParts = subtaskParts.length > 0 && firstRealUser.parts.every((p) => p.type === "subtask")

    const agent = await Agent.get("title")
    if (!agent) return
    const titleModel = await iife(async () => {
      if (agent.model) return await Provider.getModel(agent.model.providerID, agent.model.modelID)
      return (
        (await Provider.getSmallModel(input.providerID)) ?? (await Provider.getModel(input.providerID, input.modelID))
      )
    })
    const result = await LLM.stream({
      agent,
      user: firstRealUser.info as MessageV2.User,
      system: [],
      small: true,
      tools: {},
      model: titleModel,
      abort: new AbortController().signal,
      sessionID: input.session.id,
      retries: 2,
      messages: [
        {
          role: "user",
          content: "Generate a title for this conversation:\n",
        },
        ...(hasOnlySubtaskParts
          ? [{ role: "user" as const, content: subtaskParts.map((p) => p.prompt).join("\n") }]
          : await MessageV2.toModelMessage(contextMessages, titleModel)),
      ],
    })
    const text = await Promise.resolve(result.text).catch((err: unknown) => log.error("failed to generate title", { error: err }))
    if (text)
      return Session.update(input.session.id, (draft) => {
        const cleaned = text
          .replace(/<think>[\s\S]*?<\/think>\s*/g, "")
          .split("\n")
          .map((line: string) => line.trim())
          .find((line: string) => line.length > 0)
        if (!cleaned) return

        const title = cleaned.length > 100 ? cleaned.substring(0, 97) + "..." : cleaned
        draft.title = title
      }, { touch: false })
  }
}
