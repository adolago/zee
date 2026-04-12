import { cmd } from "./cmd"
import { UI } from "../ui"
import { isBuiltinMcpServerName, type BuiltinMcpServerName } from "@/mcp/builtin"
import { prepareLocalMemory } from "../../../../../src/memory/local-runtime"
import { startCalendarMcpServer } from "../../../../../src/mcp/servers/calendar.js"
import { startConsciousnessMcpServer } from "../../../../../src/mcp/servers/consciousness.js"
import { startMemoryMcpServer } from "../../../../../src/mcp/servers/memory.js"

async function startBuiltinMcpServer(name: BuiltinMcpServerName): Promise<void> {
  if (name === "memory") {
    const status = await prepareLocalMemory()
    if (!status.ok) {
      throw new Error(status.sqlite.error || status.embedding.error || "Local memory preparation failed")
    }
    await startMemoryMcpServer()
    return
  }

  if (name === "calendar") {
    await startCalendarMcpServer()
    return
  }

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
