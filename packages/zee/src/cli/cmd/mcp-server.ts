import { cmd } from "./cmd"
import { UI } from "../ui"
import { isBuiltinMcpServerName, type BuiltinMcpServerName } from "@/mcp/builtin"
import { prepareLocalMemory } from "../../../../../src/memory/local-runtime"

type ShutdownReadable = {
  once(event: "close" | "end", listener: () => void): unknown
  removeListener(event: "close" | "end", listener: () => void): unknown
  destroyed?: boolean
  readableEnded?: boolean
}

type ShutdownProcess = {
  once(event: "SIGINT" | "SIGTERM", listener: () => void): unknown
  removeListener(event: "SIGINT" | "SIGTERM", listener: () => void): unknown
}

type McpServerRuntimeOptions = {
  stdin?: ShutdownReadable
  processObject?: ShutdownProcess
}

export async function startBuiltinMcpServer(name: BuiltinMcpServerName): Promise<void> {
  if (name === "memory") {
    const status = await prepareLocalMemory()
    if (!status.ok) {
      throw new Error(status.sqlite.error || status.embedding.error || "Local memory preparation failed")
    }
    const { startMemoryMcpServer } = await import("../../../../../src/mcp/servers/memory.js")
    await startMemoryMcpServer()
    return
  }

  if (name === "calendar") {
    const { startCalendarMcpServer } = await import("../../../../../src/mcp/servers/calendar.js")
    await startCalendarMcpServer()
    return
  }

  const { startConsciousnessMcpServer } = await import("../../../../../src/mcp/servers/consciousness.js")
  await startConsciousnessMcpServer()
}

export function waitForBuiltinMcpServerShutdown(options: McpServerRuntimeOptions = {}): Promise<void> {
  const stdin = options.stdin ?? process.stdin
  const processObject = options.processObject ?? process

  if (stdin.destroyed || stdin.readableEnded) {
    return Promise.resolve()
  }

  return new Promise((resolve) => {
    let settled = false

    const finish = () => {
      if (settled) return
      settled = true
      stdin.removeListener("end", onEnd)
      stdin.removeListener("close", onClose)
      processObject.removeListener("SIGINT", onSigint)
      processObject.removeListener("SIGTERM", onSigterm)
      resolve()
    }

    const onEnd = () => finish()
    const onClose = () => finish()
    const onSigint = () => finish()
    const onSigterm = () => finish()

    stdin.once("end", onEnd)
    stdin.once("close", onClose)
    processObject.once("SIGINT", onSigint)
    processObject.once("SIGTERM", onSigterm)
  })
}

export async function runBuiltinMcpServer(
  name: BuiltinMcpServerName,
  options: McpServerRuntimeOptions = {},
): Promise<void> {
  await startBuiltinMcpServer(name)
  await waitForBuiltinMcpServerShutdown(options)
}

export const McpServerCommand = cmd({
  command: "mcp-server <name>",
  describe: false,
  builder: (yargs) =>
    yargs.positional("name", {
      type: "string",
      demandOption: true,
      describe: "built-in MCP server name",
    }),
  async handler(args) {
    const name = String(args.name ?? "")
    if (!isBuiltinMcpServerName(name)) {
      UI.error(`Unknown built-in MCP server: ${name}`)
      process.exit(1)
    }

    await runBuiltinMcpServer(name)
  },
})
