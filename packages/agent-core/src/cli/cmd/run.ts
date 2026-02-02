import type { Argv } from "yargs"
import path from "path"
import { UI } from "../ui"
import { cmd } from "./cmd"
import { Flag } from "../../flag/flag"
import { bootstrap } from "../bootstrap"
import { Command } from "../../command"
import { EOL } from "os"
import { select } from "@clack/prompts"
import { createAgentCoreClient as createEventClient } from "@agent-core/sdk"
import { createAgentCoreClient, type AgentCoreClient } from "@agent-core/sdk/v2"
import { Server } from "../../server/server"
import { Provider } from "../../provider/provider"
import { Agent } from "../../agent/agent"
import { checkEnvironment } from "./check"
import { GlobalBus } from "../../bus/global"

const TOOL: Record<string, [string, string]> = {
  todowrite: ["Todo", UI.Style.TEXT_WARNING_BOLD],
  todoread: ["Todo", UI.Style.TEXT_WARNING_BOLD],
  bash: ["Bash", UI.Style.TEXT_DANGER_BOLD],
  edit: ["Edit", UI.Style.TEXT_SUCCESS_BOLD],
  glob: ["Glob", UI.Style.TEXT_INFO_BOLD],
  grep: ["Grep", UI.Style.TEXT_INFO_BOLD],
  list: ["List", UI.Style.TEXT_INFO_BOLD],
  read: ["Read", UI.Style.TEXT_HIGHLIGHT_BOLD],
  write: ["Write", UI.Style.TEXT_SUCCESS_BOLD],
  websearch: ["Search", UI.Style.TEXT_DIM_BOLD],
}

type AppEvent = {
  type: string
  properties: any
}

export const RunCommand = cmd({
  command: "run [message..]",
  describe: "run agent-core with a message",
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
        describe: "attach to a running agent-core server (e.g., http://localhost:3456)",
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
      sdk: AgentCoreClient,
      eventClient: ReturnType<typeof createEventClient> | null,
      sessionID: string,
      resolvedAgent: string | undefined,
      localEvents?: { stream: AsyncIterable<any> },
    ) => {
      const printEvent = (color: string, type: string, title: string) => {
        UI.println(
          color + `|`,
          UI.Style.TEXT_NORMAL + UI.Style.TEXT_DIM + ` ${type.padEnd(7, " ")}`,
          "",
          UI.Style.TEXT_NORMAL + title,
        )
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

      const eventProcessor = (async () => {
        for await (const event of events.stream) {
          const resolved = resolveEvent(event)
          if (!resolved) continue
          if (resolved.type === "message.part.updated") {
            const part = resolved.properties.part
            if (part.sessionID !== sessionID) continue

            if (part.type === "tool" && part.state.status === "completed") {
              if (outputJsonEvent("tool_use", { part })) continue
              const [tool, color] = TOOL[part.tool] ?? [part.tool, UI.Style.TEXT_INFO_BOLD]
              const title =
                part.state.title ||
                (Object.keys(part.state.input).length > 0 ? JSON.stringify(part.state.input) : "Unknown")
              printEvent(color, tool, title)
              if (part.tool === "bash" && part.state.output?.trim()) {
                UI.println()
                UI.println(part.state.output)
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
            const result = await select({
              message: `Permission required: ${permission.permission} (${permission.patterns.join(", ")})`,
              options: [
                { value: "once", label: "Allow once" },
                { value: "always", label: "Always allow: " + permission.always.join(", ") },
                { value: "reject", label: "Reject" },
              ],
              initialValue: "once",
            }).catch(() => "reject")
            const response = (result.toString().includes("cancel") ? "reject" : result) as "once" | "always" | "reject"
            await sdk.permission.respond({
              sessionID,
              permissionID: permission.id,
              response,
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

    if (args.attach) {
      const sdk = createAgentCoreClient({ baseUrl: args.attach })
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
                permission: [
                  {
                    permission: "question",
                    action: "deny",
                    pattern: "*",
                  },
                ],
              }
            : {
                permission: [
                  {
                    permission: "question",
                    action: "deny",
                    pattern: "*",
                  },
                ],
              },
        )
        return result.data?.id
      })()

      if (!sessionID) {
        UI.error("Session not found")
        process.exit(1)
      }

      // In attach mode, skip local agent validation - server will validate
      return await execute(sdk, eventClient, sessionID, args.agent)
    }

    await bootstrap(process.cwd(), async () => {
      const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const request = new Request(input, init)
        return Server.App().fetch(request)
      }) as typeof globalThis.fetch
      const sdk = createAgentCoreClient({ baseUrl: "http://agent-core.internal", fetch: fetchFn })

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

        const result = await sdk.session.create(title ? { title } : {})
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
    })
  },
})
