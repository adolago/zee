import { test, expect, mock, beforeEach, afterEach, afterAll } from "bun:test"

// Restore mock.module mocks after all tests to avoid polluting other test files
afterAll(() => {
  mock.restore()
})

type FailurePlan = {
  connectErrors?: string[]
  listToolsErrors?: string[]
  alwaysConnectError?: string
  alwaysListToolsError?: string
}

const localFailurePlans: Record<string, FailurePlan> = {}
const connectAttempts: Record<string, number> = {}
const listToolsAttempts: Record<string, number> = {}
const commandByServer: Record<string, string> = {}
const transportRefsByServer: Record<string, unknown[]> = {}

function consumeError(queue?: string[]): string | undefined {
  if (!queue || queue.length === 0) return undefined
  return queue.shift()
}

class MockTransport {
  async start() {}
  async close() {}
}

class MockClient {
  name: string
  _handlers = new Map<any, any>()
  serverName = "unknown"

  constructor(public options: { name: string }) {
    this.name = options.name
  }

  async connect(transport: unknown) {
    const transportInfo = transport as { env?: Record<string, string>; command?: string } | undefined
    const env = transportInfo?.env
    this.serverName = env?.ZEE_MCP_SERVER_NAME ?? "unknown"
    commandByServer[this.serverName] = transportInfo?.command ?? ""
    transportRefsByServer[this.serverName] ??= []
    transportRefsByServer[this.serverName].push(transport)

    connectAttempts[this.serverName] = (connectAttempts[this.serverName] ?? 0) + 1
    const plan = localFailurePlans[this.serverName]
    const nextError = consumeError(plan?.connectErrors) ?? plan?.alwaysConnectError
    if (nextError) {
      throw new Error(nextError)
    }
  }

  setNotificationHandler(schema: unknown, handler: unknown) {
    this._handlers.set(schema, handler)
  }

  async listTools() {
    listToolsAttempts[this.serverName] = (listToolsAttempts[this.serverName] ?? 0) + 1
    const plan = localFailurePlans[this.serverName]
    const nextError = consumeError(plan?.listToolsErrors) ?? plan?.alwaysListToolsError
    if (nextError) {
      throw new Error(nextError)
    }

    return {
      tools: [
        {
          name: `${this.serverName}_tool`,
          description: "mock tool",
          inputSchema: { type: "object" },
        },
      ],
    }
  }

  async listPrompts() {
    return { prompts: [] }
  }

  async listResources() {
    return { resources: [] }
  }

  async callTool(params: { name: string }) {
    return { content: [{ type: "text", text: `called ${params.name}` }] }
  }

  async close() {}
}

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
  StdioClientTransport: class MockStdioTransport extends MockTransport {
    command: string
    args: string[]
    env?: Record<string, string>
    stderr = null

    constructor(options: { command: string; args: string[]; env?: Record<string, string> }) {
      super()
      this.command = options.command
      this.args = options.args
      this.env = options.env
    }
  },
}))

mock.module("@modelcontextprotocol/sdk/client/auth.js", () => ({
  UnauthorizedError: class extends Error {},
}))

const { MCP } = await import("../../src/mcp/index")
const { Instance } = await import("../../src/project/instance")
const { tmpdir } = await import("../fixture/fixture")

const originalDateNow = Date.now.bind(Date)
let nowOverride: number | undefined

function setNow(value: number) {
  nowOverride = value
  Date.now = () => nowOverride ?? originalDateNow()
}

function advanceNow(ms: number) {
  if (nowOverride === undefined) {
    throw new Error("advanceNow called before setNow")
  }
  nowOverride += ms
}

beforeEach(() => {
  for (const key of Object.keys(localFailurePlans)) delete localFailurePlans[key]
  for (const key of Object.keys(connectAttempts)) delete connectAttempts[key]
  for (const key of Object.keys(listToolsAttempts)) delete listToolsAttempts[key]
  for (const key of Object.keys(commandByServer)) delete commandByServer[key]
  for (const key of Object.keys(transportRefsByServer)) delete transportRefsByServer[key]
  MCP.clearToolCache()
  MCP.resetLocalMcpResilienceForTests()
})

afterEach(() => {
  Date.now = originalDateNow
  nowOverride = undefined
  MCP.resetLocalMcpResilienceForTests()
})

test("local MCP retries transient connection_closed failures and recovers", async () => {
  localFailurePlans.memory = {
    connectErrors: ["Connection closed"],
  }
  MCP.configureLocalMcpResilienceForTests({
    startupMaxAttempts: 4,
    startupBackoffMs: [0, 0, 0],
  })

  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const status = await MCP.status()
      expect(status.memory?.status).toBe("connected")
      expect(connectAttempts.memory).toBe(2)
      expect(transportRefsByServer.memory?.length).toBe(2)
      expect(transportRefsByServer.memory?.[0]).not.toBe(transportRefsByServer.memory?.[1])
    },
  })
})

test("built-in local MCP servers always run with bun runtime", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const status = await MCP.status()
      expect(status.calendar?.status).toBe("connected")
      expect(status.consciousness?.status).toBe("connected")
      expect(status.memory?.status).toBe("connected")
      expect(status.portfolio?.status).toBe("connected")

      expect(commandByServer.calendar).toBe("bun")
      expect(commandByServer.consciousness).toBe("bun")
      expect(commandByServer.memory).toBe("bun")
      expect(commandByServer.portfolio).toBe("bun")
    },
  })
})

test("local MCP enters crash-loop cooldown and blocks immediate reconnect attempts", async () => {
  localFailurePlans.memory = {
    alwaysConnectError: "Connection closed",
  }
  MCP.configureLocalMcpResilienceForTests({
    startupMaxAttempts: 1,
    startupBackoffMs: [0],
    crashLoopThreshold: 2,
    crashLoopWindowMs: 120_000,
    crashLoopCooldownMs: 60_000,
  })

  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      await MCP.clients() // initialize state and trigger first failure

      const secondFailure = await MCP.reconnect("memory")
      expect(secondFailure.status).toBe("failed")
      expect(connectAttempts.memory).toBe(2)

      const coolingDown = await MCP.reconnect("memory")
      expect(coolingDown.status).toBe("failed")
      if (coolingDown.status === "failed") {
        expect(coolingDown.error).toContain("[crash_loop]")
        expect(coolingDown.error).toContain("Cooling down")
      }
      expect(connectAttempts.memory).toBe(2)
    },
  })
})

test("local MCP reconnects automatically after cooldown expiry", async () => {
  setNow(1_000_000)
  localFailurePlans.memory = {
    connectErrors: ["Connection closed", "Connection closed"],
  }
  MCP.configureLocalMcpResilienceForTests({
    startupMaxAttempts: 1,
    startupBackoffMs: [0],
    crashLoopThreshold: 2,
    crashLoopWindowMs: 120_000,
    crashLoopCooldownMs: 5_000,
  })

  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      await MCP.clients() // first failure

      const secondFailure = await MCP.reconnect("memory")
      expect(secondFailure.status).toBe("failed")
      expect(connectAttempts.memory).toBe(2)

      const coolingDown = await MCP.reconnect("memory")
      expect(coolingDown.status).toBe("failed")
      expect(connectAttempts.memory).toBe(2)

      advanceNow(6_000)

      const recovered = await MCP.reconnect("memory")
      expect(recovered.status).toBe("connected")
      expect(connectAttempts.memory).toBe(3)
    },
  })
})
