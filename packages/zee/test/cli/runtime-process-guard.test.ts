import { afterEach, describe, expect, test } from "bun:test"
import {
  classifyRuntimeProcess,
  extractMcpServerName,
  isManagedMcpProcess,
  isProtectedClientProcess,
  isProtectedDaemonLikeProcess,
  parsePgrepOutput,
  resolveRuntimeProcessLimits,
  type RuntimeProcessEntry,
} from "../../src/cli/cmd/runtime-process-guard"

const originalEnv = {
  maxTotal: process.env.ZEE_RUNTIME_MAX_PROCESSES_TOTAL,
  maxMcpTotal: process.env.ZEE_RUNTIME_MAX_MCP_PROCESSES,
  maxMcpPerServer: process.env.ZEE_RUNTIME_MAX_MCP_PER_SERVER,
  maxClients: process.env.ZEE_RUNTIME_MAX_CLIENT_PROCESSES,
}

afterEach(() => {
  process.env.ZEE_RUNTIME_MAX_PROCESSES_TOTAL = originalEnv.maxTotal
  process.env.ZEE_RUNTIME_MAX_MCP_PROCESSES = originalEnv.maxMcpTotal
  process.env.ZEE_RUNTIME_MAX_MCP_PER_SERVER = originalEnv.maxMcpPerServer
  process.env.ZEE_RUNTIME_MAX_CLIENT_PROCESSES = originalEnv.maxClients
})

describe("runtime-process-guard helpers", () => {
  function makeEntry(input: Partial<RuntimeProcessEntry> & Pick<RuntimeProcessEntry, "pid" | "command" | "kind">): RuntimeProcessEntry {
    return {
      ppid: undefined,
      zeeExecutable: true,
      mcpServerName: undefined,
      taggedMcp: false,
      taggedParentPid: undefined,
      orphaned: false,
      systemdUnit: undefined,
      systemdManaged: false,
      descendantOfCurrent: false,
      exePath: "/home/artur/.bun/bin/zee",
      exeDeleted: false,
      binaryPinned: true,
      hasTty: false,
      interactiveClient: false,
      ...input,
    }
  }

  test("parsePgrepOutput parses pid and command lines", () => {
    const parsed = parsePgrepOutput("123 zee daemon --port 3210\ninvalid\n456 bun run src/mcp/servers/memory.ts\n")

    expect(parsed).toEqual([
      { pid: 123, command: "zee daemon --port 3210" },
      { pid: 456, command: "bun run src/mcp/servers/memory.ts" },
    ])
  })

  test("extractMcpServerName extracts server names", () => {
    expect(extractMcpServerName("bun run /repo/src/mcp/servers/memory.ts")).toBe("memory")
    expect(extractMcpServerName("bun run /repo/src/mcp/servers/portfolio.ts --stdio")).toBe("portfolio")
    expect(extractMcpServerName("zee daemon")).toBeUndefined()
  })

  test("classifyRuntimeProcess classifies daemon gateway and mcp", () => {
    expect(classifyRuntimeProcess("/home/user/.bun/bin/zee daemon --port 3210")).toBe("daemon")
    expect(classifyRuntimeProcess("/home/user/.bun/bin/zee daemon-orch --ipc-socket /tmp/daemon.sock")).toBe("daemon")
    expect(classifyRuntimeProcess("/home/user/.bun/bin/zee gateway --port 18789")).toBe("gateway")
    expect(classifyRuntimeProcess("bun run /repo/src/mcp/servers/calendar.ts")).toBe("mcp_server")
    expect(classifyRuntimeProcess("zee run \"hello\"")).toBe("zee_other")
  })

  test("resolveRuntimeProcessLimits honors env overrides", () => {
    process.env.ZEE_RUNTIME_MAX_PROCESSES_TOTAL = "99"
    process.env.ZEE_RUNTIME_MAX_MCP_PROCESSES = "12"
    process.env.ZEE_RUNTIME_MAX_MCP_PER_SERVER = "3"
    process.env.ZEE_RUNTIME_MAX_CLIENT_PROCESSES = "5"

    const limits = resolveRuntimeProcessLimits()
    expect(limits).toEqual({
      maxTotal: 99,
      maxMcpTotal: 12,
      maxMcpPerServer: 3,
      maxClients: 5,
    })
  })

  test("isManagedMcpProcess accepts daemon-parented MCP servers", () => {
    const daemon = makeEntry({
      pid: 100,
      ppid: 1,
      command: "zee daemon --port 3210",
      kind: "daemon",
    })
    const mcp = makeEntry({
      pid: 200,
      ppid: 100,
      command: "bun run /repo/src/mcp/servers/memory.ts",
      kind: "mcp_server",
      mcpServerName: "memory",
    })

    const managed = isManagedMcpProcess({
      entry: mcp,
      currentPid: 9999,
      processByPid: new Map([
        [daemon.pid, daemon],
        [mcp.pid, mcp],
      ]),
    })

    expect(managed).toBe(true)
  })

  test("isManagedMcpProcess rejects unknown untagged MCP parents", () => {
    const mcp = makeEntry({
      pid: 300,
      ppid: 200,
      command: "bun run /repo/src/mcp/servers/calendar.ts",
      kind: "mcp_server",
      mcpServerName: "calendar",
    })

    const managed = isManagedMcpProcess({
      entry: mcp,
      currentPid: 9999,
      processByPid: new Map([[mcp.pid, mcp]]),
    })

    expect(managed).toBe(false)
  })

  test("isManagedMcpProcess accepts systemd-managed MCP servers", () => {
    const mcp = makeEntry({
      pid: 301,
      ppid: 200,
      command: "bun run /repo/src/mcp/servers/calendar.ts",
      kind: "mcp_server",
      mcpServerName: "calendar",
      systemdManaged: true,
      systemdUnit: "zee.service",
    })

    const managed = isManagedMcpProcess({
      entry: mcp,
      currentPid: 9999,
      processByPid: new Map([[mcp.pid, mcp]]),
    })

    expect(managed).toBe(true)
  })

  test("isProtectedDaemonLikeProcess protects systemd-managed daemons", () => {
    const daemon = makeEntry({
      pid: 401,
      command: "zee daemon --port 3210",
      kind: "daemon",
      systemdManaged: true,
      systemdUnit: "zee.service",
    })

    expect(isProtectedDaemonLikeProcess({ entry: daemon, currentPid: 9999 })).toBe(true)
  })

  test("isProtectedDaemonLikeProcess protects descendants of current process", () => {
    const daemon = makeEntry({
      pid: 402,
      command: "zee daemon --port 3211",
      kind: "daemon",
      descendantOfCurrent: true,
    })

    expect(isProtectedDaemonLikeProcess({ entry: daemon, currentPid: 9999 })).toBe(true)
  })

  test("isProtectedDaemonLikeProcess does not protect unmanaged daemons", () => {
    const daemon = makeEntry({
      pid: 403,
      command: "zee daemon --port 3212",
      kind: "daemon",
    })

    expect(isProtectedDaemonLikeProcess({ entry: daemon, currentPid: 9999 })).toBe(false)
  })

  test("isProtectedClientProcess protects active pinned tty clients", () => {
    const client = makeEntry({
      pid: 500,
      command: "zee",
      kind: "zee_other",
      hasTty: true,
      interactiveClient: true,
      binaryPinned: true,
      orphaned: false,
    })

    expect(isProtectedClientProcess({ entry: client, currentPid: 9999 })).toBe(true)
  })

  test("isProtectedClientProcess does not protect detached client without tty", () => {
    const client = makeEntry({
      pid: 501,
      command: "zee --print-logs",
      kind: "zee_other",
      hasTty: false,
      interactiveClient: true,
      binaryPinned: true,
      orphaned: false,
    })

    expect(isProtectedClientProcess({ entry: client, currentPid: 9999 })).toBe(false)
  })

  test("isProtectedClientProcess does not protect binary mismatch clients", () => {
    const client = makeEntry({
      pid: 502,
      command: "zee",
      kind: "zee_other",
      hasTty: true,
      interactiveClient: true,
      binaryPinned: false,
      orphaned: false,
    })

    expect(isProtectedClientProcess({ entry: client, currentPid: 9999 })).toBe(false)
  })
})
