import { describe, expect, test } from "bun:test"
import {
  getAllBuiltinMcpServers,
  resolveBuiltinMcpServerCommand,
} from "../../src/mcp/builtin"

describe("built-in MCP command resolution", () => {
  test("uses the packaged Zee executable in binary mode", () => {
    const command = resolveBuiltinMcpServerCommand("memory", {
      execPath: "C:\\Program Files\\Zee\\bin\\zee.exe",
      argv: ["C:\\Program Files\\Zee\\bin\\zee.exe"],
    })

    expect(command).toEqual(["C:\\Program Files\\Zee\\bin\\zee.exe", "mcp-server", "memory"])
  })

  test("uses bun run with the Zee source entry in source mode", () => {
    const command = resolveBuiltinMcpServerCommand("calendar", {
      execPath: "C:\\Users\\artur\\.bun\\bin\\bun.exe",
      argv: ["bun", "C:\\repo\\packages\\zee\\src\\index.ts"],
    })

    expect(command).toEqual([
      "C:\\Users\\artur\\.bun\\bin\\bun.exe",
      "run",
      "C:\\repo\\packages\\zee\\src\\index.ts",
      "mcp-server",
      "calendar",
    ])
  })

  test("all built-ins resolve to internal mcp-server commands", () => {
    const servers = getAllBuiltinMcpServers()

    expect(Object.keys(servers).sort()).toEqual(["calendar", "consciousness", "memory"])
    for (const [name, server] of Object.entries(servers)) {
      expect(server.type).toBe("local")
      expect(server.command).toContain("mcp-server")
      expect(server.command.at(-1)).toBe(name)
      expect(server.command.join(" ")).not.toContain("src/mcp/servers")
    }
  })
})
