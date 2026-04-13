import { afterAll, afterEach, describe, expect, mock, test } from "bun:test"

const prepareLocalMemoryMock = mock(async () => ({
  ok: true,
  sqlite: {},
  embedding: {},
}))
const startCalendarMcpServerMock = mock(async () => {})
const startConsciousnessMcpServerMock = mock(async () => {})
const startMemoryMcpServerMock = mock(async () => {})

mock.module("../../../../src/memory/local-runtime", () => ({
  prepareLocalMemory: prepareLocalMemoryMock,
}))

mock.module("../../../../src/mcp/servers/calendar.js", () => ({
  startCalendarMcpServer: startCalendarMcpServerMock,
}))

mock.module("../../../../src/mcp/servers/consciousness.js", () => ({
  startConsciousnessMcpServer: startConsciousnessMcpServerMock,
}))

mock.module("../../../../src/mcp/servers/memory.js", () => ({
  startMemoryMcpServer: startMemoryMcpServerMock,
}))

const { McpServerCommand, startBuiltinMcpServer } = await import("../../src/cli/cmd/mcp-server")

afterEach(() => {
  prepareLocalMemoryMock.mockReset()
  prepareLocalMemoryMock.mockImplementation(async () => ({
    ok: true,
    sqlite: {},
    embedding: {},
  }))
  startCalendarMcpServerMock.mockReset()
  startConsciousnessMcpServerMock.mockReset()
  startMemoryMcpServerMock.mockReset()
})

afterAll(() => {
  mock.restore()
})

describe("zee mcp-server", () => {
  test("importing the command module does not start built-in MCP servers", () => {
    expect(McpServerCommand.command).toBe("mcp-server <name>")
    expect(prepareLocalMemoryMock).not.toHaveBeenCalled()
    expect(startCalendarMcpServerMock).not.toHaveBeenCalled()
    expect(startConsciousnessMcpServerMock).not.toHaveBeenCalled()
    expect(startMemoryMcpServerMock).not.toHaveBeenCalled()
  })

  test("starts only the memory server after preparing local memory", async () => {
    await startBuiltinMcpServer("memory")

    expect(prepareLocalMemoryMock).toHaveBeenCalledTimes(1)
    expect(startMemoryMcpServerMock).toHaveBeenCalledTimes(1)
    expect(startCalendarMcpServerMock).not.toHaveBeenCalled()
    expect(startConsciousnessMcpServerMock).not.toHaveBeenCalled()
  })

  test("starts only the calendar server", async () => {
    await startBuiltinMcpServer("calendar")

    expect(prepareLocalMemoryMock).not.toHaveBeenCalled()
    expect(startCalendarMcpServerMock).toHaveBeenCalledTimes(1)
    expect(startConsciousnessMcpServerMock).not.toHaveBeenCalled()
    expect(startMemoryMcpServerMock).not.toHaveBeenCalled()
  })

  test("starts only the consciousness server", async () => {
    await startBuiltinMcpServer("consciousness")

    expect(prepareLocalMemoryMock).not.toHaveBeenCalled()
    expect(startCalendarMcpServerMock).not.toHaveBeenCalled()
    expect(startConsciousnessMcpServerMock).toHaveBeenCalledTimes(1)
    expect(startMemoryMcpServerMock).not.toHaveBeenCalled()
  })

  test("does not start memory when preparation fails", async () => {
    prepareLocalMemoryMock.mockImplementation(async () => ({
      ok: false,
      sqlite: { error: "sqlite unavailable" },
      embedding: {},
    }))

    await expect(startBuiltinMcpServer("memory")).rejects.toThrow("sqlite unavailable")
    expect(startMemoryMcpServerMock).not.toHaveBeenCalled()
  })
})
