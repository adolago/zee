import { describe, expect, test } from "bun:test"
import { installMcpParentGuard, parseParentPid } from "../../../../src/mcp/servers/parent-guard.ts"

describe("mcp parent guard", () => {
  test("parseParentPid validates numbers", () => {
    expect(parseParentPid(undefined)).toBeUndefined()
    expect(parseParentPid("")).toBeUndefined()
    expect(parseParentPid("abc")).toBeUndefined()
    expect(parseParentPid("1")).toBeUndefined()
    expect(parseParentPid("42")).toBe(42)
  })

  test("installMcpParentGuard exits when parent is gone", () => {
    let exited: number | undefined
    let callback: (() => void) | undefined

    const guard = installMcpParentGuard("memory", {
      env: { ZEE_PARENT_PID: "777" },
      getPpid: () => 1,
      isAlive: () => false,
      logger: () => {},
      exitFn: (code?: number) => {
        exited = code
      },
      setIntervalFn: ((fn: () => void) => {
        callback = fn
        return { unref() {} } as unknown as NodeJS.Timeout
      }) as typeof setInterval,
      clearIntervalFn: (() => {}) as typeof clearInterval,
    })

    expect(guard).toBeDefined()
    expect(exited).toBe(0)

    // Ensure callback can be called without throwing
    callback?.()
  })
})
