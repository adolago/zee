import { test, expect } from "bun:test"
import { z } from "zod"

import { ToolRegistry, defineTool, PermissionDeniedError } from "@root/mcp"
import type { AgentInfo, ToolExecutionContext } from "@root/mcp/types"

const ReadTool = defineTool("read", "builtin", {
  description: "read",
  parameters: z.object({ filePath: z.string() }),
  execute: async (_args, _ctx) => ({ title: "read", metadata: {}, output: "ok" }),
})

const WriteTool = defineTool("write", "builtin", {
  description: "write",
  parameters: z.object({ filePath: z.string(), content: z.string() }),
  execute: async (_args, _ctx) => ({ title: "write", metadata: {}, output: "ok" }),
})

function makeAgent(): AgentInfo {
  return {
    name: "test",
    mode: "primary",
    permission: {
      bash: { "*": "allow" },
      edit: "allow",
      write: "allow",
      webfetch: "allow",
      skill: { "*": "allow" },
      external_directory: "allow",
      mcp: {},
    },
    tools: {},
  }
}

function makeCtx(extra: Record<string, unknown> = {}): ToolExecutionContext {
  const abort = new AbortController()
  return {
    sessionId: "s",
    messageId: "m",
    agent: "test",
    abort: abort.signal,
    extra,
    metadata: () => {},
  }
}

test("root MCP: matrix surface denies read by default", async () => {
  const registry = new ToolRegistry()
  registry.register(ReadTool, { source: "builtin" })

  const tools = await registry.getToolsForAgent(makeAgent(), "matrix")
  const read = tools.get("read")
  expect(read).toBeTruthy()

  await expect(read!.execute({ filePath: "file.txt" }, makeCtx({ cwd: process.cwd(), root: process.cwd() }))).rejects
    .toBeInstanceOf(PermissionDeniedError)
})

test("root MCP: web surface asks for write, and remember avoids re-asking", async () => {
  const registry = new ToolRegistry()
  registry.register(WriteTool, { source: "builtin" })

  const asked: any[] = []
  registry.setAskHandler(async (req) => {
    asked.push(req)
    const p = req.pattern
    const rememberPattern = typeof p === "string" ? p : Array.isArray(p) ? p.join(" ") : undefined
    return { granted: true, remember: true, rememberPattern }
  })

  const tools = await registry.getToolsForAgent(makeAgent(), "web")
  const write = tools.get("write")
  expect(write).toBeTruthy()

  const ctx = makeCtx({ cwd: process.cwd(), root: process.cwd() })
  await write!.execute({ filePath: "file.txt", content: "x" }, ctx)
  expect(asked.length).toBe(1)

  await write!.execute({ filePath: "file.txt", content: "y" }, ctx)
  expect(asked.length).toBe(1)
})

