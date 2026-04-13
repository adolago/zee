import { cmd } from "./cmd"
import { UI } from "../ui"
import { isBuiltinMcpServerName, type BuiltinMcpServerName } from "@/mcp/builtin"
import { prepareLocalMemory } from "../../../../../src/memory/local-runtime"

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

    await startBuiltinMcpServer(name)
  },
})
