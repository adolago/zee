import { describe, expect, test } from "bun:test"
import { defaultRunMode, parseRunMode, resolveRunMode } from "../../src/cli/run-mode"

describe("run-mode helpers", () => {
  test("parseRunMode accepts supported modes", () => {
    expect(parseRunMode("plan")).toBe("plan")
    expect(parseRunMode("build")).toBe("build")
    expect(parseRunMode("review")).toBe("review")
  })

  test("parseRunMode rejects unsupported modes", () => {
    expect(parseRunMode(undefined)).toBeUndefined()
    expect(parseRunMode("" as unknown as string)).toBeUndefined()
    expect(parseRunMode("debug")).toBeUndefined()
  })

  test("defaultRunMode is build", () => {
    expect(defaultRunMode()).toBe("build")
  })

  test("resolveRunMode prefers explicit mode", async () => {
    await expect(resolveRunMode("plan")).resolves.toBe("plan")
    await expect(resolveRunMode("review")).resolves.toBe("review")
  })

  test("resolveRunMode rejects invalid explicit mode", async () => {
    await expect(resolveRunMode("invalid")).rejects.toThrow(/Invalid run mode/)
  })
})
