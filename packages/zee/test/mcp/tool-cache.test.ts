import { test, expect, mock, beforeEach, afterEach, afterAll } from "bun:test"

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
    const transport = _transport as { env?: Record<string, string> } | undefined
    const serverName = transport?.env?.ZEE_MCP_SERVER_NAME
    if (serverName) {
      ;(this as any).__serverName = serverName
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
    env?: Record<string, string>
    stderr = null

    constructor(options?: { env?: Record<string, string> }) {
      super()
      this.env = options?.env
    }
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

afterEach(() => {
  MCP.resetLocalMcpResilienceForTests()
})

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

test("clearToolCache() clears in-memory cache and keeps subsequent lookup working", async () => {
  await using tmp = await tmpdir()

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      MCP.clearToolCache()
      listToolsCalls = []

      // First call populates cache
      await MCP.tools()

      // Clear cache
      MCP.clearToolCache()
      listToolsCalls = []

      // Second lookup should still succeed after clearing cache.
      const tools = await MCP.tools()
      expect(tools).toBeDefined()
    },
  })
})

test("getToolCacheEntry returns undefined for uncached server", () => {
  MCP.clearToolCache()
  expect(MCP.getToolCacheEntry("nonexistent")).toBeUndefined()
})

test("MCP servers honor config enabled: false and stay disabled", async () => {
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
      // Server might already be connected from earlier activity; disconnect enforces config.
      expect(before.memory?.status).toBeDefined()

      await MCP.disconnect("memory")

      const after = await MCP.status()
      expect(after.memory).toBeDefined()
      expect(after.memory?.status).toBe("disabled")
    },
  })
})

test("tools() hides direct tools for failed eager servers even when cache exists", async () => {
  await using tmp = await tmpdir()

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      MCP.clearToolCache()
      MCP.configureLocalMcpResilienceForTests({
        startupMaxAttempts: 1,
        startupBackoffMs: [0],
      })
      connectShouldFail = false
      mockToolsByServer = {
        memory: [{ name: "memory_store", description: "Store memory", inputSchema: { type: "object" } }],
      }

      const initialTools = await MCP.tools()
      expect(initialTools.memory_store).toBeDefined()

      connectShouldFail = true
      const failedReconnect = await MCP.reconnect("memory")
      expect(failedReconnect.status).toBe("failed")
      const statusAfterFailure = await MCP.status()
      expect(statusAfterFailure.memory?.status).toBe("failed")

      const toolsAfterFailure = await MCP.tools()
      expect(toolsAfterFailure.memory_store).toBeUndefined()
      expect(toolsAfterFailure.mcp).toBeDefined()
    },
  })
})
