import { describe, expect, test } from "bun:test"
import { installParentProcessGuard, parseParentPid } from "../../src/process/parent-guard"

describe("parent process guard", () => {
  test("parseParentPid parses valid values", () => {
    expect(parseParentPid("123")).toBe(123)
    expect(parseParentPid(" 456 ")).toBe(456)
    expect(parseParentPid(undefined)).toBeUndefined()
    expect(parseParentPid("0")).toBeUndefined()
    expect(parseParentPid("abc")).toBeUndefined()
  })

  test("installParentProcessGuard is disabled without ZEE_PARENT_PID", () => {
    const guard = installParentProcessGuard({
      env: {},
    })
    expect(guard).toBeUndefined()
  })

  test("installParentProcessGuard exits when parent is gone", () => {
    let intervalTick: (() => void) | undefined
    let clearCount = 0
    let exitCode: number | undefined
    const logs: string[] = []

    const guard = installParentProcessGuard({
      guardName: "test-guard",
      env: { ZEE_PARENT_PID: "4242" },
      getPpid: () => 1,
      isAlive: () => false,
      exitFn: (code?: number) => {
        exitCode = code
      },
      logger: (line: string) => logs.push(line),
      setIntervalFn: ((cb: () => void) => {
        intervalTick = cb
        return { unref() {} } as unknown as NodeJS.Timeout
      }) as typeof setInterval,
      clearIntervalFn: (() => {
        clearCount += 1
      }) as typeof clearInterval,
    })

    expect(guard).toBeDefined()
    expect(intervalTick).toBeTypeOf("function")
    expect(exitCode).toBe(0)
    expect(clearCount).toBe(1)
    expect(logs[0]).toContain("[test-guard]")
  })

  test("installParentProcessGuard stays active while parent is healthy", () => {
    let intervalTick: (() => void) | undefined
    let clearCount = 0
    let exitCode: number | undefined

    const guard = installParentProcessGuard({
      env: { ZEE_PARENT_PID: "9876" },
      getPpid: () => 9876,
      isAlive: () => true,
      exitFn: (code?: number) => {
        exitCode = code
      },
      setIntervalFn: ((cb: () => void) => {
        intervalTick = cb
        return { unref() {} } as unknown as NodeJS.Timeout
      }) as typeof setInterval,
      clearIntervalFn: (() => {
        clearCount += 1
      }) as typeof clearInterval,
    })

    expect(guard).toBeDefined()
    expect(intervalTick).toBeTypeOf("function")
    expect(exitCode).toBeUndefined()

    intervalTick?.()
    expect(exitCode).toBeUndefined()

    guard?.stop()
    expect(clearCount).toBe(1)
  })
})
