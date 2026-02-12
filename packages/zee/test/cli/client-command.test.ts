import { describe, expect, test } from "bun:test"
import { resolveClientUrl } from "../../src/cli/cmd/client"

describe("zee client", () => {
  test("prefers explicit URL over ZEE_URL", () => {
    const url = resolveClientUrl({
      url: "http://explicit:3210",
      env: { ZEE_URL: "http://env:3210" } as unknown as NodeJS.ProcessEnv,
    })
    expect(url).toBe("http://explicit:3210")
  })

  test("falls back to ZEE_URL when URL arg is missing", () => {
    const url = resolveClientUrl({
      url: undefined,
      env: { ZEE_URL: "http://env:3210" } as unknown as NodeJS.ProcessEnv,
    })
    expect(url).toBe("http://env:3210")
  })

  test("returns undefined when neither URL arg nor ZEE_URL are set", () => {
    const url = resolveClientUrl({
      url: undefined,
      env: {} as unknown as NodeJS.ProcessEnv,
    })
    expect(url).toBeUndefined()
  })
})

