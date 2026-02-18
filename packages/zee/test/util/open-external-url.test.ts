import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test"
import { EventEmitter } from "events"

let mode: "success" | "throw" | "error" | "exit_nonzero" = "success"
let calledUrl: string | undefined
let calledOptions: unknown

mock.module("open", () => ({
  default: async (url: string, options?: unknown) => {
    calledUrl = url
    calledOptions = options

    if (mode === "throw") {
      throw new Error("spawn xdg-open ENOENT")
    }

    const subprocess = new EventEmitter()
    if (mode === "error") {
      setTimeout(() => {
        subprocess.emit("error", new Error("spawn xdg-open ENOENT"))
      }, 10)
    }
    if (mode === "exit_nonzero") {
      setTimeout(() => {
        subprocess.emit("exit", 1)
      }, 10)
    }
    return subprocess
  },
}))

afterAll(() => {
  mock.restore()
})

const { openExternalUrl } = await import("../../src/util/open-external-url")

beforeEach(() => {
  mode = "success"
  calledUrl = undefined
  calledOptions = undefined
})

describe("openExternalUrl", () => {
  test("rejects non-http URLs", async () => {
    const result = await openExternalUrl("file:///tmp/test")
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe("invalid_url")
  })

  test("opens valid URL with system default app", async () => {
    const result = await openExternalUrl("https://example.com", { errorCheckDelayMs: 1 })
    expect(result.ok).toBe(true)
    expect(calledUrl).toBe("https://example.com/")
    expect(calledOptions).toBeUndefined()
  })

  test("returns open_failed when open() throws immediately", async () => {
    mode = "throw"
    const result = await openExternalUrl("https://example.com")
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe("open_failed")
  })

  test("returns open_failed when process emits asynchronous error", async () => {
    mode = "error"
    const result = await openExternalUrl("https://example.com", { errorCheckDelayMs: 100 })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe("open_failed")
  })

  test("returns open_failed when process exits non-zero", async () => {
    mode = "exit_nonzero"
    const result = await openExternalUrl("https://example.com", { errorCheckDelayMs: 100 })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe("open_failed")
  })
})
