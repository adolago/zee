import type { Argv } from "yargs"
import path from "path"
import { UI } from "../ui"
import { cmd } from "./cmd"
import { bootstrap } from "../bootstrap"
import { Command } from "../../command"
import { EOL } from "os"
import { createZeeClient as createEventClient } from "@zee/sdk"
import { createZeeClient, type ZeeClient } from "@zee/sdk/v2"
import { Server } from "../../server/server"
import { Provider } from "../../provider/provider"
import { Agent } from "../../agent/agent"
import { checkEnvironment } from "./check"
import { GlobalBus } from "../../bus/global"
import { ExperimentalHooks } from "@/hooks/experimental-hooks"
import { Instance } from "@/project/instance"

// ---------------------------------------------------------------------------
// Typed tool rendering helpers
// ---------------------------------------------------------------------------

type ToolPart = {
  tool: string
  state: {
    status: string
    input: Record<string, any>
    output?: string
    title?: string
    metadata?: Record<string, any>
  }
}

type Inline = { type: "inline"; tool: string; description: string }
type Block = { type: "block"; tool: string; description: string; body?: string }
type ToolResult = Inline | Block

function inline(tool: string, description: string): Inline {
  return { type: "inline", tool, description }
}

function block(tool: string, description: string, body?: string): Block {
  return { type: "block", tool, description, body }
}

function normalizePath(input?: string): string {
  if (!input) return ""
  const relative = path.relative(process.cwd(), input)
  if (relative.startsWith("..")) return input
  return relative || "."
}

function fallback(part: ToolPart): ToolResult {
  const title =
    part.state.title ||
    (Object.keys(part.state.input).length > 0 ? JSON.stringify(part.state.input) : "")
  return inline(part.tool, title)
}

function renderGlob(part: ToolPart): ToolResult {
  const input = part.state.input
  let desc = input.pattern || ""
  if (input.path) desc += ` in ${normalizePath(input.path)}`
  return inline("Glob", desc)
}

function renderGrep(part: ToolPart): ToolResult {
  const input = part.state.input
  let desc = input.pattern || ""
  if (input.path) desc += ` in ${normalizePath(input.path)}`
  return inline("Grep", desc)
}

function renderList(part: ToolPart): ToolResult {
  return inline("List", normalizePath(part.state.input.path) || ".")
}

function renderRead(part: ToolPart): ToolResult {
  const fp = normalizePath(part.state.input.filePath || part.state.input.file_path)
  return inline("Read", fp)
}

function renderWrite(part: ToolPart): ToolResult {
  const fp = normalizePath(part.state.input.filePath || part.state.input.file_path)
  return block("Write", fp)
}

function renderEdit(part: ToolPart): ToolResult {
  const fp = normalizePath(part.state.input.filePath || part.state.input.file_path)
  return block("Edit", fp)
}

function renderBash(part: ToolPart): ToolResult {
  const input = part.state.input
  const desc = input.description || input.command || ""
  return block("Bash", desc, part.state.output?.trim() || undefined)
}

function renderWebFetch(part: ToolPart): ToolResult {
  return inline("Fetch", part.state.input.url || "")
}

function renderWebSearch(part: ToolPart): ToolResult {
  return inline("Search", part.state.input.query || "")
}

function renderCodeSearch(part: ToolPart): ToolResult {
  return inline("CodeSearch", part.state.input.query || "")
}

function renderTask(part: ToolPart): ToolResult {
  return inline("Task", part.state.input.description || part.state.title || "")
}

function renderSkill(part: ToolPart): ToolResult {
  const input = part.state.input
  return inline("Skill", input.name || input.query || part.state.title || "")
}

function renderTodo(part: ToolPart): ToolResult {
  return inline("Todo", part.state.title || "")
}

const TOOL_RENDERERS: Record<string, (part: ToolPart) => ToolResult> = {
  glob: renderGlob,
  grep: renderGrep,
  list: renderList,
  read: renderRead,
  write: renderWrite,
  edit: renderEdit,
  bash: renderBash,
  webfetch: renderWebFetch,
  websearch: renderWebSearch,
  codesearch: renderCodeSearch,
  task: renderTask,
  skill: renderSkill,
  todowrite: renderTodo,
  todoread: renderTodo,
}

const TOOL_COLORS: Record<string, string> = {
  Glob: UI.Style.TEXT_INFO_BOLD,
  Grep: UI.Style.TEXT_INFO_BOLD,
  List: UI.Style.TEXT_INFO_BOLD,
  Read: UI.Style.TEXT_HIGHLIGHT_BOLD,
  Write: UI.Style.TEXT_SUCCESS_BOLD,
  Edit: UI.Style.TEXT_SUCCESS_BOLD,
  Bash: UI.Style.TEXT_DANGER_BOLD,
  Fetch: UI.Style.TEXT_DIM_BOLD,
  Search: UI.Style.TEXT_DIM_BOLD,
  CodeSearch: UI.Style.TEXT_DIM_BOLD,
  Task: UI.Style.TEXT_INFO_BOLD,
  Skill: UI.Style.TEXT_WARNING_BOLD,
  Todo: UI.Style.TEXT_WARNING_BOLD,
}

function renderTool(part: ToolPart): ToolResult {
  const renderer = TOOL_RENDERERS[part.tool]
  return renderer ? renderer(part) : fallback(part)
}

// ---------------------------------------------------------------------------
// Permission rules for non-interactive run mode
// ---------------------------------------------------------------------------

const RUN_PERMISSION_RULES = [
  { permission: "question", action: "deny" as const, pattern: "*" },
  { permission: "plan_enter", action: "deny" as const, pattern: "*" },
  { permission: "plan_exit", action: "deny" as const, pattern: "*" },
]

// ---------------------------------------------------------------------------

type AppEvent = {
  type: string
  properties: any
}

export const RunCommand = cmd({
  command: "run [message..]",
  describe: "run zee with a message",
  builder: (yargs: Argv) => {
    return yargs
      .positional("message", {
        describe: "message to send",
        type: "string",
        array: true,
        default: [],
      })
      .option("command", {
        describe: "the command to run, use message for args",
        type: "string",
      })
      .option("continue", {
        alias: ["c"],
        describe: "continue the last session",
        type: "boolean",
      })
      .option("session", {
        alias: ["s"],
        describe: "session id to continue",
        type: "string",
      })
      .option("share", {
        type: "boolean",
        describe: "share the session",
      })
      .option("model", {
        type: "string",
        alias: ["m"],
        describe: "model to use in the format of provider/model",
      })
      .option("agent", {
        type: "string",
        describe: "agent to use",
      })
      .option("format", {
        type: "string",
        choices: ["default", "json"],
        default: "default",
        describe: "format: default (formatted) or json (raw JSON events)",
      })
      .option("file", {
        alias: ["f"],
        type: "string",
        array: true,
        describe: "file(s) to attach to message",
      })
      .option("title", {
        type: "string",
        describe: "title for the session (uses truncated prompt if no value provided)",
      })
      .option("attach", {
        type: "string",
        describe: "attach to a running zee server (e.g., http://localhost:3456)",
      })
      .option("port", {
        type: "number",
        describe: "port for the local server (defaults to random port if no value provided)",
      })
      .option("variant", {
        type: "string",
        describe: "model variant (provider-specific reasoning effort, e.g., high, max, minimal)",
      })
      .option("skip-permissions", {
        type: "boolean",
        describe: "skip all permission checks (no cuffs mode, equivalent to release mode)",
      })
      .option("thinking", {
        type: "boolean",
        describe: "show thinking blocks",
        default: false,
      })
  },
  handler: async (args) => {
    await checkEnvironment()

    let message = [...args.message, ...(args["--"] || [])]
      .map((arg) => (arg.includes(" ") ? `"${arg.replace(/"/g, '\\"')}"` : arg))
      .join(" ")

    const fileParts: any[] = []
    if (args.file) {
      const files = Array.isArray(args.file) ? args.file : [args.file]

      for (const filePath of files) {
        const resolvedPath = path.resolve(process.cwd(), filePath)
        const file = Bun.file(resolvedPath)
        const stats = await file.stat().catch(() => {})
        if (!stats) {
          UI.error(`File not found: ${filePath}`)
          process.exit(1)
        }
        if (!(await file.exists())) {
          UI.error(`File not found: ${filePath}`)
          process.exit(1)
        }

        const stat = await file.stat()
        const mime = stat.isDirectory() ? "application/x-directory" : "text/plain"

        fileParts.push({
          type: "file",
          url: `file://${resolvedPath}`,
          filename: path.basename(resolvedPath),
          mime,
        })
      }
    }

    if (!process.stdin.isTTY) message += "\n" + (await Bun.stdin.text())

    if (message.trim().length === 0 && !args.command) {
      UI.error("You must provide a message or a command")
      process.exit(1)
    }

    const execute = async (
      sdk: ZeeClient,
      eventClient: ReturnType<typeof createEventClient> | null,
      sessionID: string,
      resolvedAgent: string | undefined,
      localEvents?: { stream: AsyncIterable<any> },
    ) => {
      const printToolEvent = (result: ToolResult) => {
        const color = TOOL_COLORS[result.tool] ?? UI.Style.TEXT_INFO_BOLD
        UI.println(
          color + `|`,
          UI.Style.TEXT_NORMAL + UI.Style.TEXT_DIM + ` ${result.tool.padEnd(7, " ")}`,
          "",
          UI.Style.TEXT_NORMAL + result.description,
        )
        if (result.type === "block" && result.body) {
          UI.println()
          UI.println(result.body)
        }
      }

      const outputJsonEvent = (type: string, data: any) => {
        if (args.format === "json") {
          process.stdout.write(JSON.stringify({ type, timestamp: Date.now(), sessionID, ...data }) + EOL)
          return true
        }
        return false
      }

      // Use local events stream if provided (bootstrap mode), otherwise use SSE (attach mode)
      const events = localEvents ?? (await eventClient!.event.subscribe())
      let errorMsg: string | undefined
      const resolveEvent = (input: any): AppEvent | undefined => {
        if (!input || typeof input !== "object") return
        if (input.payload && typeof input.payload === "object") {
          const payload = input.payload as AppEvent
          if (payload?.type) return payload
        }
        if (typeof input.type === "string") {
          return input as AppEvent
        }
      }

      // Track running tasks so we show them once when started
      const taskToggles = new Map<string, boolean>()

      const eventProcessor = (async () => {
        for await (const event of events.stream) {
          const resolved = resolveEvent(event)
          if (!resolved) continue
          if (resolved.type === "message.part.updated") {
            const part = resolved.properties.part
            if (part.sessionID !== sessionID) continue

            if (part.type === "tool" && part.state.status === "completed") {
              if (outputJsonEvent("tool_use", { part })) continue
              const result = renderTool(part as ToolPart)
              printToolEvent(result)
            }

            if (part.type === "tool" && part.state.status === "running" && part.tool === "task") {
              const taskKey = part.callID || part.id
              if (!taskToggles.has(taskKey)) {
                taskToggles.set(taskKey, true)
                const desc = part.state.input?.description || "running task..."
                UI.println(
                  UI.Style.TEXT_INFO_BOLD + "|",
                  UI.Style.TEXT_NORMAL + UI.Style.TEXT_DIM + ` Task   `,
                  "",
                  UI.Style.TEXT_NORMAL + desc,
                )
              }
            }

            if (part.type === "step-start") {
              if (outputJsonEvent("step_start", { part })) continue
            }

            if (part.type === "step-finish") {
              if (outputJsonEvent("step_finish", { part })) continue
            }

            if (part.type === "text" && part.time?.end) {
              if (outputJsonEvent("text", { part })) continue
              const isPiped = !process.stdout.isTTY
              if (!isPiped) UI.println()
              process.stdout.write((isPiped ? part.text : UI.markdown(part.text)) + EOL)
              if (!isPiped) UI.println()
            }

            if (part.type === "reasoning" && part.time?.end && args.thinking) {
              if (outputJsonEvent("reasoning", { part })) continue
              const text = (part.text || "").trim()
              if (!text) continue
              const isPiped = !process.stdout.isTTY
              if (isPiped) {
                process.stdout.write("Thinking: " + text + EOL)
              } else {
                UI.println()
                UI.println(UI.Style.TEXT_DIM + "Thinking:" + UI.Style.TEXT_NORMAL)
                UI.println(UI.Style.TEXT_DIM + text + UI.Style.TEXT_NORMAL)
                UI.println()
              }
            }
          }

          if (resolved.type === "session.error") {
            const props = resolved.properties
            if (props.sessionID !== sessionID || !props.error) continue
            let err = String(props.error.name)
            if ("data" in props.error && props.error.data && "message" in props.error.data) {
              err = String(props.error.data.message)
            }
            errorMsg = errorMsg ? errorMsg + EOL + err : err
            if (outputJsonEvent("error", { error: props.error })) continue
            UI.error(err)
          }

          if (resolved.type === "session.idle" && resolved.properties.sessionID === sessionID) {
            break
          }

          if (resolved.type === "permission.asked") {
            const permission = resolved.properties
            if (permission.sessionID !== sessionID) continue
            UI.warn(
              `Permission denied in non-interactive mode: ${permission.permission} (${permission.patterns.join(", ")})`,
            )
            await sdk.permission.respond({
              sessionID,
              permissionID: permission.id,
              response: "reject",
            })
          }
        }
      })()

      // Hold mode: first message in new session restricts edit/write tools
      // This mirrors TUI behavior - agents must plan before executing
      const isNewSession = !args.continue && !args.session
      const holdModeTools = isNewSession
        ? { edit: false, write: false, notebook_edit: false }
        : undefined

      if (args.command) {
        await sdk.session.command({
          sessionID,
          agent: resolvedAgent,
          model: args.model,
          command: args.command,
          arguments: message,
          variant: args.variant,
          tools: holdModeTools,
        })
      } else {
        const modelParam = args.model ? Provider.parseModel(args.model) : undefined
        await sdk.session.prompt({
          sessionID,
          agent: resolvedAgent,
          model: modelParam,
          variant: args.variant,
          tools: holdModeTools,
          options: { skipPermissions: args.skipPermissions },
          parts: [...fileParts, { type: "text", text: message }],
        })
      }

      await eventProcessor
      if (errorMsg) process.exit(1)
    }

    const maybeTriggerSessionCompletedHooks = async (sdk: ZeeClient, sessionID: string) => {
      try {
        const todoResult = await sdk.session.todo({ sessionID })
        const todos = todoResult.data ?? []

        const todosRemaining = todos.filter((t) => t.status !== "completed" && t.status !== "cancelled").length
        if (todosRemaining !== 0) return

        const todosCompleted = todos.filter((t) => t.status === "completed").length

        const runHooks = async () => {
          await ExperimentalHooks.triggerSessionCompleted({
            sessionID,
            todosCompleted,
            todosRemaining,
          })
        }

        // `zee run --attach` does not create an Instance context. Hooks rely on Config + Instance paths.
        try {
          void Instance.directory
          await runHooks()
        } catch {
          await Instance.provide({
            directory: process.cwd(),
            fn: async () => {
              await runHooks()
            },
          })
        }
      } catch {
        // Best-effort: hooks must not affect `zee run` exit status.
      }
    }

    if (args.attach) {
      const sdk = createZeeClient({ baseUrl: args.attach })
      const eventClient = createEventClient({ baseUrl: args.attach })

      const sessionID = await (async () => {
        if (args.continue) {
          const result = await sdk.session.list()
          return result.data?.find((s) => !s.parentID)?.id
        }
        if (args.session) return args.session

        const title =
          args.title !== undefined
            ? args.title === ""
              ? message.slice(0, 50) + (message.length > 50 ? "..." : "")
              : args.title
            : undefined

        const result = await sdk.session.create(
          title
            ? {
                title,
                permission: RUN_PERMISSION_RULES,
              }
            : {
                permission: RUN_PERMISSION_RULES,
              },
        )
        return result.data?.id
      })()

      if (!sessionID) {
        UI.error("Session not found")
        process.exit(1)
      }

      const result = await execute(sdk, eventClient, sessionID, args.agent)
      await maybeTriggerSessionCompletedHooks(sdk, sessionID)

      if (args.share) {
        const shareResult = await sdk.session.share({ sessionID })
        if (shareResult.data) {
          UI.info(`Session shared: ${shareResult.data}`)
        }
      }

      return result
    }

    await bootstrap(process.cwd(), async () => {
      const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const request = new Request(input, init)
        return Server.App().fetch(request)
      }) as typeof globalThis.fetch
      const sdk = createZeeClient({ baseUrl: "http://zee.internal", fetch: fetchFn })

      // Create a local event stream using GlobalBus directly instead of SSE
      // This avoids issues with Server.App().fetch() not properly streaming SSE
      const createLocalEventStream = () => {
        const queue: any[] = []
        let resolver: ((value: IteratorResult<any>) => void) | null = null
        let done = false

        const handler = (event: { directory?: string; payload: any }) => {
          if (resolver) {
            resolver({ value: event.payload, done: false })
            resolver = null
          } else {
            queue.push(event.payload)
          }
        }

        GlobalBus.on("event", handler)

        const stream = {
          [Symbol.asyncIterator]() {
            return {
              async next() {
                if (done) return { value: undefined, done: true }
                if (queue.length > 0) {
                  return { value: queue.shift(), done: false }
                }
                return new Promise<IteratorResult<any>>((resolve) => {
                  resolver = resolve
                })
              },
              async return() {
                done = true
                GlobalBus.off("event", handler)
                return { value: undefined, done: true }
              },
            }
          },
        }

        return { stream }
      }

      const events = createLocalEventStream()

      if (args.command) {
        const exists = await Command.get(args.command)
        if (!exists) {
          UI.error(`Command "${args.command}" not found`)
          process.exit(1)
        }
      }

      const sessionID = await (async () => {
        if (args.continue) {
          const result = await sdk.session.list()
          return result.data?.find((s) => !s.parentID)?.id
        }
        if (args.session) return args.session

        const title =
          args.title !== undefined
            ? args.title === ""
              ? message.slice(0, 50) + (message.length > 50 ? "..." : "")
              : args.title
            : undefined

        const result = await sdk.session.create(
          title
            ? { title, permission: RUN_PERMISSION_RULES }
            : { permission: RUN_PERMISSION_RULES },
        )
        return result.data?.id
      })()

      if (!sessionID) {
        UI.error("Session not found")
        process.exit(1)
      }

      // Validate agent if specified (only in bootstrap mode where Instance context exists)
      const resolvedAgent = await (async () => {
        if (!args.agent) return undefined
        const agent = await Agent.get(args.agent)
        if (!agent) {
          UI.println(
            UI.Style.TEXT_WARNING_BOLD + "!",
            UI.Style.TEXT_NORMAL,
            `agent "${args.agent}" not found. Falling back to default agent`,
          )
          return undefined
        }
        if (agent.mode === "subagent") {
          UI.println(
            UI.Style.TEXT_WARNING_BOLD + "!",
            UI.Style.TEXT_NORMAL,
            `agent "${args.agent}" is a subagent, not a primary agent. Falling back to default agent`,
          )
          return undefined
        }
        return args.agent
      })()

      await execute(sdk, null, sessionID, resolvedAgent, events)
      await maybeTriggerSessionCompletedHooks(sdk, sessionID)

      if (args.share) {
        const shareResult = await sdk.session.share({ sessionID })
        if (shareResult.data) {
          UI.info(`Session shared: ${shareResult.data}`)
        }
      }
    })
  },
})
