import { test, expect, mock, beforeEach, afterAll } from "bun:test"

// Restore mock.module mocks after all tests
afterAll(() => {
  mock.restore()
})

// Track listTools() call count per server
let listToolsCalls: string[] = []
let mockToolsByServer: Record<string, Array<{ name: string; description: string; inputSchema: { type: string } }>> = {}
let connectShouldFail = false

class MockTransport {
  async start() {
    if (connectShouldFail) {
      throw new Error("Mock transport cannot connect")
    }
  }
  async close() {}
}

// Minimal mock Client that tracks listTools() calls
class MockClient {
  name: string
  _handlers = new Map<any, any>()

  constructor(public options: { name: string }) {
    this.name = options.name
  }

  async connect(_transport: unknown) {
    if (connectShouldFail) {
      throw new Error("Mock transport cannot connect")
    }
  }

  setNotificationHandler(schema: any, handler: any) {
    this._handlers.set(schema, handler)
  }

  async listTools() {
    // Track calls using a server name injected via test setup
    const serverName = (this as any).__serverName ?? "unknown"
    listToolsCalls.push(serverName)
    const tools = mockToolsByServer[serverName] ?? [
      { name: "test_tool", description: "A test tool", inputSchema: { type: "object" } },
    ]
    return { tools }
  }

  async listPrompts() {
    return { prompts: [] }
  }

  async listResources() {
    return { resources: [] }
  }

  async callTool(params: any) {
    return { content: [{ type: "text", text: `called ${params.name}` }] }
  }

  async close() {}
}

// Mock the SDK Client
mock.module("@modelcontextprotocol/sdk/client/index.js", () => ({
  Client: MockClient,
}))

mock.module("@modelcontextprotocol/sdk/client/streamableHttp.js", () => ({
  StreamableHTTPClientTransport: MockTransport,
}))

mock.module("@modelcontextprotocol/sdk/client/sse.js", () => ({
  SSEClientTransport: MockTransport,
}))

mock.module("@modelcontextprotocol/sdk/client/stdio.js", () => ({
  StdioClientTransport: class extends MockTransport {
    stderr = null
  },
}))

mock.module("@modelcontextprotocol/sdk/client/auth.js", () => ({
  UnauthorizedError: class extends Error {},
}))

beforeEach(() => {
  listToolsCalls = []
  mockToolsByServer = {}
  connectShouldFail = false
})

// Import MCP after mocking
const { MCP } = await import("../../src/mcp/index")
const { Instance } = await import("../../src/project/instance")
const { tmpdir } = await import("../fixture/fixture")

test("warm cache serves tools without extra listTools() call", async () => {
  await using tmp = await tmpdir()

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      MCP.clearToolCache()
      listToolsCalls = []

      // First call -- cold cache, should call listTools()
      const tools1 = await MCP.tools()
      const firstCallCount = listToolsCalls.length

      // Second call -- warm cache, should NOT call listTools() again
      listToolsCalls = []
      const tools2 = await MCP.tools()

      expect(listToolsCalls.length).toBe(0)
      // Both calls should return the same tools
      expect(Object.keys(tools1).sort()).toEqual(Object.keys(tools2).sort())
    },
  })
})

test("clearToolCache() forces fresh fetch on next tools() call", async () => {
  await using tmp = await tmpdir()

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      MCP.clearToolCache()
      listToolsCalls = []

      // First call populates cache
      await MCP.tools()
      const afterFirst = listToolsCalls.length

      // Clear cache
      MCP.clearToolCache()
      listToolsCalls = []

      // Second call should fetch again
      await MCP.tools()
      // Should have made listTools() calls again
      expect(listToolsCalls.length).toBeGreaterThanOrEqual(afterFirst)
    },
  })
})

test("getToolCacheEntry returns undefined for uncached server", () => {
  MCP.clearToolCache()
  expect(MCP.getToolCacheEntry("nonexistent")).toBeUndefined()
})

test("MCP servers remain enabled even when config sets enabled: false", async () => {
  await using tmp = await tmpdir({
    config: {
      mcp: {
        memory: { enabled: false },
      },
    },
  })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      MCP.clearToolCache()

      const before = await MCP.status()
      expect(before.memory).toBeDefined()
      expect(before.memory?.status).not.toBe("disabled")

      await MCP.disconnect("memory")

      const after = await MCP.status()
      expect(after.memory).toBeDefined()
      expect(after.memory?.status).not.toBe("disabled")
    },
  })
})
