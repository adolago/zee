import { afterEach, describe, expect, mock, test } from "bun:test"
import { reloadFlags } from "../../src/flag/flag"
import { Server } from "../../src/server/server"

const tuiMock = mock(async () => {})
const promptPasswordMock = mock(async () => "secret-password")
const promptIsCancelMock = mock(() => false)

mock.module("../../src/cli/cmd/tui/app", () => ({
  tui: tuiMock,
}))

mock.module("@clack/prompts", () => ({
  password: promptPasswordMock,
  isCancel: promptIsCancelMock,
}))

const { attachTui } = await import("../../src/cli/cmd/tui/attach-shared")

const ORIGINAL_ENV = {
  ZEE_ENABLE_SERVER_AUTH: process.env.ZEE_ENABLE_SERVER_AUTH,
  ZEE_DISABLE_SERVER_AUTH: process.env.ZEE_DISABLE_SERVER_AUTH,
  ZEE_SERVER_PASSWORD: process.env.ZEE_SERVER_PASSWORD,
}

const ORIGINAL_FETCH = globalThis.fetch

afterEach(() => {
  tuiMock.mockReset()
  promptPasswordMock.mockReset()
  promptPasswordMock.mockImplementation(async () => "secret-password")
  promptIsCancelMock.mockReset()
  promptIsCancelMock.mockImplementation(() => false)

  globalThis.fetch = ORIGINAL_FETCH

  for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  reloadFlags()
  Server.App.reset()
})

describe("attachTui remote auth flow", () => {
  test("prompts for password on 401 and retries with authorization header", async () => {
    process.env.ZEE_ENABLE_SERVER_AUTH = "1"
    delete process.env.ZEE_DISABLE_SERVER_AUTH
    delete process.env.ZEE_SERVER_PASSWORD
    reloadFlags()

    const calls: Request[] = []
    globalThis.fetch = mock((input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request && !init ? input : new Request(input, init)
      calls.push(request)
      if (calls.length === 1) return Promise.resolve(new Response("Unauthorized", { status: 401 }))
      return Promise.resolve(new Response("OK", { status: 200 }))
    }) as unknown as typeof fetch

    await attachTui({
      url: "http://127.0.0.1:3210/",
      directory: process.cwd(),
    })

    expect(calls.length).toBe(2)
    expect(promptPasswordMock).toHaveBeenCalledTimes(1)
    expect(calls[0]!.headers.get("Authorization")).toBeNull()
    expect(calls[1]!.headers.get("Authorization")).toBe(`Basic ${Buffer.from("zee:secret-password").toString("base64")}`)
    expect(tuiMock).toHaveBeenCalledTimes(1)
  })

  test("uses explicit password and skips interactive prompt", async () => {
    process.env.ZEE_ENABLE_SERVER_AUTH = "1"
    delete process.env.ZEE_DISABLE_SERVER_AUTH
    delete process.env.ZEE_SERVER_PASSWORD
    reloadFlags()

    const calls: Request[] = []
    globalThis.fetch = mock((input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request && !init ? input : new Request(input, init)
      calls.push(request)
      return Promise.resolve(new Response("OK", { status: 200 }))
    }) as unknown as typeof fetch

    await attachTui({
      url: "http://127.0.0.1:3210",
      directory: process.cwd(),
      password: "from-flag",
    })

    expect(calls.length).toBe(1)
    expect(calls[0]!.headers.get("Authorization")).toBe(`Basic ${Buffer.from("zee:from-flag").toString("base64")}`)
    expect(promptPasswordMock).toHaveBeenCalledTimes(0)
    expect(tuiMock).toHaveBeenCalledTimes(1)
  })

  // P05-SRV-001: serve + attach auth lifecycle smoke without network flakiness.
  test("P05-SRV-001 retries auth and reaches in-process server health endpoint", async () => {
    process.env.ZEE_ENABLE_SERVER_AUTH = "1"
    delete process.env.ZEE_DISABLE_SERVER_AUTH
    delete process.env.ZEE_SERVER_PASSWORD
    reloadFlags()

    const expectedPassword = "p05-parity-password"
    const expectedAuth = `Basic ${Buffer.from(`zee:${expectedPassword}`).toString("base64")}`
    promptPasswordMock.mockImplementation(async () => expectedPassword)

    const calls: Request[] = []
    globalThis.fetch = mock((input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request && !init ? input : new Request(input, init)
      calls.push(request)

      if (!request.headers.get("Authorization")) {
        return Promise.resolve(new Response("Unauthorized", { status: 401 }))
      }

      const url = new URL(request.url)
      if (url.pathname !== "/global/health") {
        return Promise.resolve(new Response("Not Found", { status: 404 }))
      }
      return Promise.resolve(
        new Response(JSON.stringify({ healthy: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      )
    }) as unknown as typeof fetch

    await attachTui({
      url: "http://127.0.0.1:3210",
      directory: process.cwd(),
    })

    expect(calls).toHaveLength(2)
    expect(calls[0]!.headers.get("Authorization")).toBeNull()
    expect(calls[1]!.headers.get("Authorization")).toBe(expectedAuth)
    expect(promptPasswordMock).toHaveBeenCalledTimes(1)
    expect(tuiMock).toHaveBeenCalledTimes(1)
  })
})
