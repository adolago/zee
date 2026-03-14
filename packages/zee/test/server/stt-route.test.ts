import { beforeEach, describe, expect, mock, test } from "bun:test"

let resolveConfigResult: unknown
let transcribeResult = "transcribed text"
let transcribeError: Error | undefined

mock.module("../../src/cli/cmd/tui/util/dictation", () => ({
  Dictation: {
    resolveConfig: async () => resolveConfigResult,
    transcribe: async () => {
      if (transcribeError) throw transcribeError
      return transcribeResult
    },
  },
}))

const { SttRoute } = await import("../../src/server/route/stt")
const { Server } = await import("../../src/server/server")

describe("stt route", () => {
  beforeEach(() => {
    resolveConfigResult = { apiKey: "test-key" }
    transcribeResult = "transcribed text"
    transcribeError = undefined
  })

  test("serves the wisprflow transcription endpoint", async () => {
    const response = await SttRoute.request("/wisprflow", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        audio: Buffer.from("audio").toString("base64"),
      }),
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      success: true,
      text: "transcribed text",
    })
  })

  test("does not serve the legacy google endpoint", async () => {
    const response = await SttRoute.request("/google", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        audio: Buffer.from("audio").toString("base64"),
      }),
    })

    expect(response.status).toBe(404)
  })

  test("advertises only the wisprflow endpoint in OpenAPI", async () => {
    const response = await Server.App().request("/openapi")
    expect(response.status).toBe(200)

    const spec = (await response.json()) as { paths?: Record<string, unknown> }
    expect(spec.paths?.["/stt/wisprflow"]).toBeDefined()
    expect(spec.paths?.["/stt/google"]).toBeUndefined()
  })

  test("returns a Wispr Flow specific configuration error", async () => {
    resolveConfigResult = undefined

    const response = await SttRoute.request("/wisprflow", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        audio: Buffer.from("audio").toString("base64"),
      }),
    })

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({
      success: false,
      error: "Wispr Flow STT not configured",
    })
  })
})
