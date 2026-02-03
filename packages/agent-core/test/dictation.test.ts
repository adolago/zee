import { describe, it, expect, beforeEach, afterEach, spyOn } from "bun:test"
import { Auth } from "../src/auth"

const { Dictation } = await import("../src/cli/cmd/tui/util/dictation")

describe("Dictation.resolveConfig", () => {
  let authGetSpy: ReturnType<typeof spyOn>

  beforeEach(() => {
    delete process.env.GOOGLE_STT_API_KEY
    delete process.env.OPENCODE_GOOGLE_STT_API_KEY
    delete process.env.GOOGLE_CLIENT_EMAIL
    delete process.env.GOOGLE_PRIVATE_KEY
    delete process.env.GOOGLE_PRIVATE_KEY_ID
    delete process.env.GOOGLE_APPLICATION_CREDENTIALS
    authGetSpy = spyOn(Auth, "get").mockImplementation(async () => undefined)
  })

  afterEach(() => {
    authGetSpy.mockRestore()
  })

  it("returns undefined when disabled", async () => {
    const result = await Dictation.resolveConfig({ enabled: false })
    expect(result).toBeUndefined()
  })

  it("returns undefined when no credentials are available and no ADC", async () => {
    // This test checks that config is undefined when there's no API key, no env vars,
    // no stored auth, and no default ADC file. However, if the test machine has
    // ~/.config/gcloud/application_default_credentials.json, this test will not apply.
    const path = await import("path")
    const defaultAdcPath = path.join(
      process.env["HOME"] ?? process.env["USERPROFILE"] ?? "",
      ".config",
      "gcloud",
      "application_default_credentials.json"
    )
    const hasSystemAdc = await Bun.file(defaultAdcPath).exists()

    const result = await Dictation.resolveConfig({})
    if (hasSystemAdc) {
      // If ADC exists on the system, config is returned with empty google auth
      expect(result).toBeDefined()
      expect(result?.google.apiKey).toBeUndefined()
      expect(result?.google.credentials).toBeUndefined()
    } else {
      expect(result).toBeUndefined()
    }
  })

  it("uses GOOGLE_STT_API_KEY when present", async () => {
    process.env.GOOGLE_STT_API_KEY = "  test-key  "
    const result = await Dictation.resolveConfig({})
    expect(result).toBeDefined()
    expect(result?.provider).toBe("google")
    expect(result?.google.apiKey).toBe("test-key")
  })

  it("uses OPENCODE_GOOGLE_STT_API_KEY when present", async () => {
    process.env.OPENCODE_GOOGLE_STT_API_KEY = "opencode-key"
    const result = await Dictation.resolveConfig({})
    expect(result).toBeDefined()
    expect(result?.google.apiKey).toBe("opencode-key")
  })

  it("uses service account env vars when present", async () => {
    process.env.GOOGLE_CLIENT_EMAIL = "robot@example.iam.gserviceaccount.com"
    process.env.GOOGLE_PRIVATE_KEY = "line1\\nline2"
    process.env.GOOGLE_PRIVATE_KEY_ID = "key-id"
    const result = await Dictation.resolveConfig({})
    expect(result).toBeDefined()
    expect(result?.google.credentials).toBeDefined()
    expect(result?.google.credentials?.client_email).toBe("robot@example.iam.gserviceaccount.com")
    expect(result?.google.credentials?.private_key).toBe("line1\nline2")
    expect(result?.google.credentials?.private_key_id).toBe("key-id")
  })

  it("treats GOOGLE_APPLICATION_CREDENTIALS as configured (ADC)", async () => {
    process.env.GOOGLE_APPLICATION_CREDENTIALS = "/tmp/fake-google.json"
    const result = await Dictation.resolveConfig({})
    expect(result).toBeDefined()
    expect(result?.google.apiKey).toBeUndefined()
    expect(result?.google.credentials).toBeUndefined()
  })

  it("reads service account JSON from stored google-stt auth", async () => {
    authGetSpy.mockImplementation(async (providerID: string) => {
      if (providerID !== "google-stt") return
      return {
        type: "api",
        key: JSON.stringify({
          client_email: "stored@example.iam.gserviceaccount.com",
          private_key: "stored-private-key",
          private_key_id: "stored-key-id",
          project_id: "stored-project",
        }),
      }
    })

    const result = await Dictation.resolveConfig({})
    expect(result).toBeDefined()
    expect(result?.google.credentials?.client_email).toBe("stored@example.iam.gserviceaccount.com")
    expect(result?.google.credentials?.private_key).toBe("stored-private-key")
    expect(result?.google.credentials?.private_key_id).toBe("stored-key-id")
  })

  it("prefers env vars over stored auth", async () => {
    process.env.GOOGLE_STT_API_KEY = "env-key"
    authGetSpy.mockImplementation(async (providerID: string) => {
      if (providerID !== "google-stt") return
      return {
        type: "api",
        key: JSON.stringify({
          client_email: "stored@example.iam.gserviceaccount.com",
          private_key: "stored-private-key",
        }),
      }
    })

    const result = await Dictation.resolveConfig({})
    expect(result).toBeDefined()
    expect(result?.google.apiKey).toBe("env-key")
  })

  it("applies defaults for optional fields", async () => {
    process.env.GOOGLE_STT_API_KEY = "test-key"
    const result = await Dictation.resolveConfig({})
    expect(result).toBeDefined()
    expect(result?.language).toBe("en-US")
    expect(result?.alternativeLanguages).toEqual(["pt-BR", "es-ES", "de-DE"])
    expect(result?.sampleRate).toBe(16000)
    expect(result?.autoSubmit).toBe(false)
    expect(result?.maxDuration).toBe(30)
  })

  it("respects provided optional field values", async () => {
    process.env.GOOGLE_STT_API_KEY = "test-key"
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
  it("sends Google Speech-to-Text recognize request from WAV PCM data", async () => {
    const wav = buildWav(new Int16Array([0, 32767]), 8000)
    let seenUrl: string | undefined
    let seenInit: RequestInit | undefined

    const fetcher = (async (url: string, init?: RequestInit) => {
      seenUrl = url
      seenInit = init
      return new Response(
        JSON.stringify({
          results: [{ alternatives: [{ transcript: "hello" }] }, { alternatives: [{ transcript: "world" }] }],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      )
    }) as typeof fetch

    const result = await Dictation.transcribe({
      config: {
        provider: "google",
        model: "default",
        region: "us-central1",
        language: "en-US",
        alternativeLanguages: ["pt-BR"],
        sampleRate: 16000,
        autoSubmit: false,
        maxDuration: 30,
        google: { apiKey: "test-key" },
      },
      audio: wav,
      fetcher,
    })

    expect(result).toBe("hello world")
    expect(seenUrl).toBeDefined()
    const url = new URL(seenUrl!)
    expect(url.origin).toBe("https://speech.googleapis.com")
    expect(url.pathname).toBe("/v1/speech:recognize")
    expect(url.searchParams.get("key")).toBe("test-key")

    const headers = (seenInit?.headers ?? {}) as Record<string, string>
    expect(headers["Content-Type"]).toBe("application/json")
    expect(headers.Authorization).toBeUndefined()

    const body = JSON.parse(String(seenInit?.body ?? "{}")) as any
    expect(body.config.encoding).toBe("LINEAR16")
    expect(body.config.sampleRateHertz).toBe(8000)
    expect(body.config.languageCode).toBe("en-US")
    expect(body.config.alternativeLanguageCodes).toEqual(["pt-BR"])
    expect(body.config.enableAutomaticPunctuation).toBe(true)

    const pcmBytes = Buffer.from(String(body.audio.content), "base64")
    expect(new Uint8Array(pcmBytes)).toEqual(new Uint8Array([0, 0, 255, 127]))
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
