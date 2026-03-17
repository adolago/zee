import { test, expect, mock, beforeEach, afterEach, afterAll } from "bun:test"

// Restore mock.module mocks after all tests to avoid polluting other test files
afterAll(() => {
  mock.restore()
})

type FailurePlan = {
  connectErrors?: string[]
  listToolsErrors?: string[]
  callToolErrors?: string[]
  alwaysConnectError?: string
  alwaysListToolsError?: string
  alwaysCallToolError?: string
  connectDelayMs?: number
}

const localFailurePlans: Record<string, FailurePlan> = {}
const connectAttempts: Record<string, number> = {}
const listToolsAttempts: Record<string, number> = {}
const callToolAttempts: Record<string, number> = {}
const commandByServer: Record<string, string> = {}
const transportRefsByServer: Record<string, unknown[]> = {}
let activeConnects = 0
let maxConcurrentConnects = 0

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
    activeConnects += 1
    maxConcurrentConnects = Math.max(maxConcurrentConnects, activeConnects)
    try {
      const connectDelayMs = plan?.connectDelayMs ?? 0
      if (connectDelayMs > 0) {
        await new Promise<void>((resolve) => setTimeout(resolve, connectDelayMs))
      }
      const nextError = consumeError(plan?.connectErrors) ?? plan?.alwaysConnectError
      if (nextError) {
        throw new Error(nextError)
      }
    } finally {
      activeConnects -= 1
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
    callToolAttempts[this.serverName] = (callToolAttempts[this.serverName] ?? 0) + 1
    const plan = localFailurePlans[this.serverName]
    const nextError = consumeError(plan?.callToolErrors) ?? plan?.alwaysCallToolError
    if (nextError) {
      throw new Error(nextError)
    }
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
  for (const key of Object.keys(callToolAttempts)) delete callToolAttempts[key]
  for (const key of Object.keys(commandByServer)) delete commandByServer[key]
  for (const key of Object.keys(transportRefsByServer)) delete transportRefsByServer[key]
  activeConnects = 0
  maxConcurrentConnects = 0
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

test("callTool reconnects and retries once after transient connection closure", async () => {
  localFailurePlans.memory = {
    callToolErrors: ["Connection closed"],
  }
  MCP.configureLocalMcpResilienceForTests({
    startupMaxAttempts: 2,
    startupBackoffMs: [0, 0],
  })

  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const status = await MCP.status()
      expect(status.memory?.status).toBe("connected")
      expect(connectAttempts.memory).toBe(1)

      const result = await MCP.callTool("memory", "memory_tool", {})
      expect(result.content[0]?.type).toBe("text")
      expect(String((result.content[0] as { text?: string })?.text ?? "")).toContain("called memory_tool")
      expect(callToolAttempts.memory).toBe(2)
      expect(connectAttempts.memory).toBe(2)
    },
  })
})

test("callTool surfaces reconnect failure reason when recovery does not succeed", async () => {
  MCP.configureLocalMcpResilienceForTests({
    startupMaxAttempts: 1,
    startupBackoffMs: [0],
  })

  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const status = await MCP.status()
      expect(status.memory?.status).toBe("connected")

      localFailurePlans.memory = {}
      localFailurePlans.memory.callToolErrors = ["Connection closed"]
      localFailurePlans.memory.alwaysConnectError = "Connection closed"

      try {
        await MCP.callTool("memory", "memory_tool", {})
        throw new Error("Expected MCP.callTool to throw")
      } catch (error) {
        expect(MCP.Failed.isInstance(error)).toBe(true)
        if (MCP.Failed.isInstance(error)) {
          expect(error.data.name).toBe("memory")
          expect(error.data.status).toBe("failed")
          expect(error.data.reason).toContain("Local MCP startup failed")
        }
      }
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

      expect(commandByServer.calendar).toBe("bun")
      expect(commandByServer.consciousness).toBe("bun")
      expect(commandByServer.memory).toBe("bun")
    },
  })
})

test("built-in local MCP retries with fallback command variant", async () => {
  localFailurePlans.calendar = {
    connectErrors: ["Connection closed"],
  }
  MCP.configureLocalMcpResilienceForTests({
    startupMaxAttempts: 2,
    startupBackoffMs: [0, 0, 0],
  })

  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const status = await MCP.status()
      expect(status.calendar?.status).toBe("connected")
      expect(connectAttempts.calendar).toBe(2)

      const attempts = (transportRefsByServer.calendar ?? []) as Array<{ args?: string[] }>
      expect(attempts.length).toBe(2)
      expect(attempts[0]?.args).toHaveLength(2)
      expect(attempts[0]?.args?.[0]).toBe("run")
      expect(attempts[0]?.args?.[1]?.endsWith("/src/mcp/servers/calendar.ts")).toBe(true)
      expect(attempts[1]?.args).toHaveLength(1)
      expect(attempts[1]?.args?.[0]?.endsWith("/src/mcp/servers/calendar.ts")).toBe(true)
    },
  })
})

test("non-built-in local MCP keeps original command across retries", async () => {
  localFailurePlans.custom = {
    connectErrors: ["Connection closed"],
  }
  MCP.configureLocalMcpResilienceForTests({
    startupMaxAttempts: 2,
    startupBackoffMs: [0, 0, 0],
  })

  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      await MCP.add("custom", {
        type: "local",
        command: ["bun", "run", "custom"],
      })
      expect(connectAttempts.custom).toBe(2)

      const attempts = (transportRefsByServer.custom ?? []) as Array<{ args?: string[] }>
      expect(attempts.length).toBe(2)
      expect(attempts[0]?.args).toEqual(["run", "custom"])
      expect(attempts[1]?.args).toEqual(["run", "custom"])
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

test("MCP status is read-only and does not trigger auto-reconnect attempts", async () => {
  localFailurePlans.memory = {
    alwaysConnectError: "Connection closed",
  }
  MCP.configureLocalMcpResilienceForTests({
    startupMaxAttempts: 1,
    startupBackoffMs: [0],
  })

  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const first = await MCP.status()
      expect(first.memory?.status).toBe("failed")
      expect(connectAttempts.memory).toBe(1)

      const second = await MCP.status()
      expect(second.memory?.status).toBe("failed")
      expect(connectAttempts.memory).toBe(1)
    },
  })
})

test("local MCP startup is globally serialized across persona servers", async () => {
  localFailurePlans.calendar = { connectDelayMs: 15 }
  localFailurePlans.consciousness = { connectDelayMs: 15 }
  localFailurePlans.memory = { connectDelayMs: 15 }

  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const status = await MCP.status()
      expect(status.calendar?.status).toBe("connected")
      expect(status.consciousness?.status).toBe("connected")
      expect(status.memory?.status).toBe("connected")
      expect(maxConcurrentConnects).toBe(1)
    },
  })
})

test("local MCP retries transient spawn_failed startup errors (EAGAIN)", async () => {
  localFailurePlans.memory = {
    connectErrors: ["spawn EAGAIN posix_spawn bun"],
  }
  MCP.configureLocalMcpResilienceForTests({
    startupMaxAttempts: 3,
    startupBackoffMs: [0, 0, 0],
  })

  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const status = await MCP.status()
      expect(status.memory?.status).toBe("connected")
      expect(connectAttempts.memory).toBe(2)
    },
  })
})

test("MCP status refreshes crash-loop countdown while cooldown is active", async () => {
  setNow(2_000_000)
  localFailurePlans.memory = {
    alwaysConnectError: "Connection closed",
  }
  MCP.configureLocalMcpResilienceForTests({
    startupMaxAttempts: 1,
    startupBackoffMs: [0],
    crashLoopThreshold: 2,
    crashLoopWindowMs: 120_000,
    crashLoopCooldownMs: 8_000,
  })

  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      await MCP.clients() // first failure
      await MCP.reconnect("memory") // second failure -> cooldown

      const first = await MCP.status()
      expect(first.memory?.status).toBe("failed")
      const firstError = first.memory?.status === "failed" ? first.memory.error : ""
      expect(firstError).toContain("[crash_loop]")
      const firstSeconds = Number(firstError.match(/Cooling down for (\d+)s/)?.[1] ?? "0")
      expect(firstSeconds).toBeGreaterThan(0)

      advanceNow(3_000)

      const second = await MCP.status()
      expect(second.memory?.status).toBe("failed")
      const secondError = second.memory?.status === "failed" ? second.memory.error : ""
      expect(secondError).toContain("[crash_loop]")
      const secondSeconds = Number(secondError.match(/Cooling down for (\d+)s/)?.[1] ?? "0")
      expect(secondSeconds).toBeGreaterThan(0)
      expect(secondSeconds).toBeLessThan(firstSeconds)
    },
  })
})

test("MCP status clears stale crash-loop message after cooldown expiry", async () => {
  setNow(3_000_000)
  localFailurePlans.memory = {
    alwaysConnectError: "Connection closed",
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
      await MCP.reconnect("memory") // second failure -> cooldown

      const duringCooldown = await MCP.status()
      expect(duringCooldown.memory?.status).toBe("failed")
      if (duringCooldown.memory?.status === "failed") {
        expect(duringCooldown.memory.error).toContain("[crash_loop]")
      }

      advanceNow(6_000)

      const afterCooldown = await MCP.status()
      expect(afterCooldown.memory?.status).toBe("failed")
      if (afterCooldown.memory?.status === "failed") {
        expect(afterCooldown.memory.error).not.toContain("[crash_loop]")
        expect(afterCooldown.memory.error).toContain("[connection_closed]")
      }
    },
  })
})

test("local MCP reports runtime_crash after repeated startup connection closures", async () => {
  localFailurePlans.memory = {
    connectErrors: [
      "MCP error -32000: Connection closed",
      "MCP error -32000: Connection closed",
      "MCP error -32000: Connection closed",
    ],
  }
  MCP.configureLocalMcpResilienceForTests({
    startupMaxAttempts: 3,
    startupBackoffMs: [0, 0, 0],
  })

  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const status = await MCP.status()
      expect(status.memory?.status).toBe("failed")
      if (status.memory?.status === "failed") {
        expect(status.memory.error).toContain("[runtime_crash]")
      }
      expect(connectAttempts.memory).toBe(3)
    },
  })
})

test("local MCP classifies parent-guard exit signature as runtime_crash", async () => {
  localFailurePlans.memory = {
    connectErrors: ["[zee-mcp:memory] parent process 123 is gone; exiting to prevent orphaned MCP workers."],
  }
  MCP.configureLocalMcpResilienceForTests({
    startupMaxAttempts: 1,
    startupBackoffMs: [0],
  })

  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const status = await MCP.status()
      expect(status.memory?.status).toBe("failed")
      if (status.memory?.status === "failed") {
        expect(status.memory.error).toContain("[runtime_crash]")
        expect(status.memory.error).toContain("parent process")
      }
      expect(connectAttempts.memory).toBe(1)
    },
  })
})

test("consciousness local MCP falls back to node+tsx after repeated connection_closed failures", async () => {
  localFailurePlans.consciousness = {
    connectErrors: ["MCP error -32000: Connection closed", "MCP error -32000: Connection closed"],
  }
  MCP.configureLocalMcpResilienceForTests({
    startupMaxAttempts: 3,
    startupBackoffMs: [0, 0, 0],
  })

  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const status = await MCP.status()
      expect(status.consciousness?.status).toBe("connected")
      expect(connectAttempts.consciousness).toBe(3)

      const attempts = (transportRefsByServer.consciousness ?? []) as Array<{
        command?: string
        args?: string[]
      }>
      expect(attempts.length).toBe(3)
      expect(attempts[0]?.command).toBe("bun")
      expect(attempts[0]?.args?.[0]).toBe("run")
      expect(attempts[1]?.command).toBe("bun")
      expect(attempts[1]?.args?.length).toBe(1)
      const third = attempts[2]
      if ((third?.command ?? "").endsWith("/node_modules/.bin/tsx")) {
        expect(third?.args?.length).toBe(1)
        expect(third?.args?.[0]?.endsWith("/src/mcp/servers/consciousness.ts")).toBe(true)
      } else {
        expect(third?.command).toBe("node")
        expect(third?.args?.[0]).toBe("--import")
        expect(third?.args?.[1]).toBe("tsx")
        expect(third?.args?.[2]?.endsWith("/src/mcp/servers/consciousness.ts")).toBe(true)
      }
    },
  })
})

test("memory local MCP does not use node+tsx fallback variants", async () => {
  localFailurePlans.memory = {
    connectErrors: [
      "panic(main thread): Illegal instruction. oh no: Bun has crashed. bun.report/abc",
      "panic(main thread): Illegal instruction. oh no: Bun has crashed. bun.report/def",
    ],
  }
  MCP.configureLocalMcpResilienceForTests({
    startupMaxAttempts: 3,
    startupBackoffMs: [0, 0, 0],
  })

  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const status = await MCP.status()
      expect(status.memory?.status).toBe("connected")
      expect(connectAttempts.memory).toBe(3)

      const attempts = (transportRefsByServer.memory ?? []) as Array<{
        command?: string
        args?: string[]
      }>
      expect(attempts.length).toBe(3)
      expect(attempts[0]?.command).toBe("bun")
      expect(attempts[1]?.command).toBe("bun")
      expect(attempts[2]?.command).toBe("bun")
      expect(attempts.some((attempt) => attempt.command === "node")).toBe(false)
    },
  })
})
