import { describe, it, expect, beforeEach, afterEach, spyOn } from "bun:test"
import { Auth } from "../src/auth"

const { Dictation } = await import("../src/cli/cmd/tui/util/dictation")

describe("Dictation.resolveConfig", () => {
  let authGetSpy: ReturnType<typeof spyOn>

  beforeEach(() => {
    delete process.env.WISPRFLOW_API_KEY
    authGetSpy = spyOn(Auth, "get").mockImplementation(async () => undefined)
  })

  afterEach(() => {
    authGetSpy.mockRestore()
  })

  it("returns undefined when disabled", async () => {
    const result = await Dictation.resolveConfig({ enabled: false })
    expect(result).toBeUndefined()
  })

  it("returns undefined when no credentials are available", async () => {
    const result = await Dictation.resolveConfig({})
    expect(result).toBeUndefined()
  })

  it("uses WISPRFLOW_API_KEY when present", async () => {
    process.env.WISPRFLOW_API_KEY = "  test-key  "
    const result = await Dictation.resolveConfig({})
    expect(result).toBeDefined()
    expect(result?.apiKey).toBe("test-key")
  })

  it("uses auth store when present", async () => {
    authGetSpy.mockImplementation(async (providerID: string) => {
      if (providerID !== "wisprflow") return
      return {
        type: "api",
        key: "stored-key",
      }
    })

    const result = await Dictation.resolveConfig({})
    expect(result).toBeDefined()
    expect(result?.apiKey).toBe("stored-key")
  })

  it("prefers env vars over stored auth", async () => {
    process.env.WISPRFLOW_API_KEY = "env-key"
    authGetSpy.mockImplementation(async (providerID: string) => {
      if (providerID !== "wisprflow") return
      return {
        type: "api",
        key: "stored-key",
      }
    })

    const result = await Dictation.resolveConfig({})
    expect(result).toBeDefined()
    expect(result?.apiKey).toBe("env-key")
  })

  it("applies defaults for optional fields", async () => {
    process.env.WISPRFLOW_API_KEY = "test-key"
    const result = await Dictation.resolveConfig({})
    expect(result).toBeDefined()
    expect(result?.language).toBe("en-US")
    expect(result?.alternativeLanguages).toEqual(["pt-BR", "es-ES", "de-DE"])
    expect(result?.sampleRate).toBe(16000)
    expect(result?.autoSubmit).toBe(false)
    expect(result?.maxDuration).toBe(30)
  })

  it("respects provided optional field values", async () => {
    process.env.WISPRFLOW_API_KEY = "test-key"
    const result = await Dictation.resolveConfig({
      language: "de-DE",
      alternative_languages: ["en-US", "pt-PT"],
      sample_rate: 8000,
      auto_submit: true,
      max_duration: 12,
      record_command: ["arecord", "-q"],
    })
    expect(result).toBeDefined()
    expect(result?.language).toBe("de-DE")
    expect(result?.alternativeLanguages).toEqual(["en-US", "pt-PT"])
    expect(result?.sampleRate).toBe(8000)
    expect(result?.autoSubmit).toBe(true)
    expect(result?.maxDuration).toBe(12)
    expect(result?.recordCommand).toEqual(["arecord", "-q"])
  })
})

describe("Dictation.transcribe", () => {
  it("sends Wispr Flow transcription request from WAV PCM data", async () => {
    const wav = buildWav(new Int16Array([0, 32767]), 8000)
    let seenUrl: string | undefined
    let seenInit: RequestInit | undefined

    const fetcher = (async (url: string, init?: RequestInit) => {
      seenUrl = url
      seenInit = init
      return new Response(JSON.stringify({ text: " hello world " }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    }) as typeof fetch

    const result = await Dictation.transcribe({
      config: {
        language: "en-US",
        alternativeLanguages: ["pt-BR"],
        sampleRate: 16000,
        autoSubmit: false,
        maxDuration: 30,
        apiKey: "test-key",
      },
      audio: wav,
      fetcher,
    })

    expect(result).toBe("hello world")
    expect(seenUrl).toBeDefined()
    expect(seenUrl).toBe("https://platform-api.wisprflow.ai/api/v1/dash/api")

    const headers = (seenInit?.headers ?? {}) as Record<string, string>
    expect(headers["Content-Type"]).toBe("application/json")
    expect(headers["Authorization"]).toBe("Bearer test-key")

    const body = JSON.parse(String(seenInit?.body ?? "{}")) as any
    expect(body.language).toEqual(["en", "pt"])
    const audioBytes = Buffer.from(String(body.audio ?? ""), "base64")
    expect(audioBytes.subarray(0, 4).toString("ascii")).toBe("RIFF")
    expect(audioBytes.subarray(8, 12).toString("ascii")).toBe("WAVE")
    expect(new Uint8Array(audioBytes.subarray(audioBytes.length - 4))).toEqual(new Uint8Array([0, 0, 255, 127]))
  })
})

function buildWav(samples: Int16Array, sampleRate: number): Uint8Array {
  const channels = 1
  const bytesPerSample = 2
  const dataSize = samples.length * bytesPerSample * channels
  const buffer = Buffer.alloc(44 + dataSize)
  buffer.write("RIFF", 0)
  buffer.writeUInt32LE(36 + dataSize, 4)
  buffer.write("WAVE", 8)
  buffer.write("fmt ", 12)
  buffer.writeUInt32LE(16, 16)
  buffer.writeUInt16LE(1, 20)
  buffer.writeUInt16LE(channels, 22)
  buffer.writeUInt32LE(sampleRate, 24)
  buffer.writeUInt32LE(sampleRate * channels * bytesPerSample, 28)
  buffer.writeUInt16LE(channels * bytesPerSample, 32)
  buffer.writeUInt16LE(16, 34)
  buffer.write("data", 36)
  buffer.writeUInt32LE(dataSize, 40)
  for (let i = 0; i < samples.length; i += 1) {
    buffer.writeInt16LE(samples[i] ?? 0, 44 + i * 2)
  }
  return new Uint8Array(buffer)
}
