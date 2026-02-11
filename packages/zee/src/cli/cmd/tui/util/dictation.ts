import { platform } from "os"
import { Auth } from "@/auth"

export namespace Dictation {
  export type Provider = "google"
  export type Model = "default" | "gemini-3-flash" | "gemini-3-flash-preview"

  export type Config = {
    enabled?: boolean
    provider?: Provider
    model?: Model
    region?: string
    language?: string
    alternative_languages?: string[]
    sample_rate?: number
    auto_submit?: boolean
    max_duration?: number
    record_command?: string | string[]
  }

  export type RuntimeConfig = {
    provider: Provider
    model: Model
    region: string
    language: string
    alternativeLanguages: string[]
    sampleRate: number
    autoSubmit: boolean
    maxDuration: number
    recordCommand?: string | string[]
    google: {
      apiKey: string
    }
  }

  export type TranscribeState = "sending" | "receiving"
  export type State = "idle" | "listening" | TranscribeState | "transcribing"

  export type RecordingResult = {
    audio: Uint8Array
    stderr: string
  }

  export type RecordingHandle = {
    stop: () => Promise<RecordingResult>
    cancel: () => Promise<void>
  }

  type DecodedPcm16Wav = {
    pcm: Uint8Array
    sampleRate: number
  }

  const DEFAULT_SAMPLE_RATE = 16_000
  const DEFAULT_MAX_DURATION = 30
  const DEFAULT_LANGUAGE = "en-US"
  const DEFAULT_ALTERNATIVE_LANGUAGES = ["pt-BR", "es-ES", "de-DE"]
  const DEFAULT_REGION = "us-central1"
  const DEFAULT_GOOGLE_AUDIO_BASE_URL = "https://generativelanguage.googleapis.com/v1beta"
  const DEFAULT_GOOGLE_AUDIO_MODEL = "gemini-3-flash-preview"
  const DEFAULT_GOOGLE_AUDIO_PROMPT = "Transcribe the audio."

  export async function resolveConfig(input?: Config): Promise<RuntimeConfig | undefined> {
    if (input?.enabled === false) return
    const provider: Provider = input?.provider ?? "google"
    if (provider !== "google") return

    const model: Model = input?.model ?? "default"
    const google = await resolveGoogleAuth()
    if (!google.apiKey) return
    const googleAuth = { apiKey: google.apiKey }

    return {
      provider,
      model,
      region: input?.region ?? DEFAULT_REGION,
      language: input?.language ?? DEFAULT_LANGUAGE,
      alternativeLanguages: input?.alternative_languages ?? DEFAULT_ALTERNATIVE_LANGUAGES,
      sampleRate: input?.sample_rate ?? DEFAULT_SAMPLE_RATE,
      autoSubmit: input?.auto_submit ?? false,
      maxDuration: input?.max_duration ?? DEFAULT_MAX_DURATION,
      recordCommand: input?.record_command,
      google: googleAuth,
    }
  }

  export function resolveRecorderCommand(input: {
    sampleRate: number
    command?: string | string[]
  }): string[] | undefined {
    const override = input.command ?? process.env["OPENCODE_DICTATION_RECORD_COMMAND"]
    if (override) {
      const parsed = Array.isArray(override) ? override : override.trim().split(/\s+/)
      return parsed.length > 0 ? parsed : undefined
    }

    const os = platform()
    const ffmpeg = Bun.which("ffmpeg")
    const rec = Bun.which("rec")
    const sox = Bun.which("sox")

    const recCommand = rec
      ? [rec, "-q", "-r", String(input.sampleRate), "-c", "1", "-b", "16", "-e", "signed-integer", "-t", "wav", "-"]
      : undefined

    const soxCommand = sox
      ? [sox, "-q", "-d", "-r", String(input.sampleRate), "-c", "1", "-b", "16", "-e", "signed-integer", "-t", "wav", "-"]
      : undefined

    if (os === "linux") {
      const arecord = Bun.which("arecord")
      if (arecord) {
        return [arecord, "-q", "-f", "S16_LE", "-r", String(input.sampleRate), "-c", "1", "-t", "wav", "-"]
      }
      if (ffmpeg) {
        return [
          ffmpeg,
          "-hide_banner",
          "-loglevel",
          "error",
          "-f",
          "pulse",
          "-i",
          "default",
          "-ac",
          "1",
          "-ar",
          String(input.sampleRate),
          "-f",
          "wav",
          "-",
        ]
      }
      return recCommand ?? soxCommand
    }

    if (os === "win32") {
      if (recCommand) return recCommand
      if (soxCommand) return soxCommand
      if (ffmpeg) {
        return [
          ffmpeg,
          "-hide_banner",
          "-loglevel",
          "error",
          "-f",
          "dshow",
          "-i",
          "audio=default",
          "-ac",
          "1",
          "-ar",
          String(input.sampleRate),
          "-f",
          "wav",
          "-",
        ]
      }
      return
    }

    return
  }

  export function startRecording(input: { command: string[] }): RecordingHandle {
    const proc = Bun.spawn({
      cmd: input.command,
      stdout: "pipe",
      stderr: "pipe",
    })
    const stdout = readAll(proc.stdout)
    const stderr = readAllText(proc.stderr)
    let stopped = false

    return {
      async stop() {
        if (!stopped) {
          stopped = true
          proc.kill("SIGINT")
        }
        await proc.exited.catch(() => {})
        return {
          audio: await stdout,
          stderr: await stderr,
        }
      },
      async cancel() {
        if (!stopped) {
          stopped = true
          proc.kill("SIGTERM")
        }
        await proc.exited.catch(() => {})
      },
    }
  }

  export async function transcribe(input: {
    config: RuntimeConfig
    audio: Uint8Array
    fetcher?: typeof fetch
    onState?: (state: TranscribeState) => void
  }): Promise<string | undefined> {
    const fetcher = input.fetcher ?? fetch
    input.onState?.("sending")

    const decoded = decodeWavPcm16(input.audio)
    if (!decoded) {
      throw new Error("Dictation expects 16-bit PCM WAV audio. Update tui.dictation.record_command to output WAV.")
    }

    const truncated = truncatePcm16(decoded, input.config.maxDuration)
    const base64Audio = Buffer.from(truncated.pcm).toString("base64")

    const model = resolveModel(input.config.model)
    const url = `${DEFAULT_GOOGLE_AUDIO_BASE_URL}/models/${model}:generateContent`
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "x-goog-api-key": input.config.google.apiKey,
    }
    const body = {
      contents: [
        {
          role: "user",
          parts: [
            { text: resolvePrompt(input.config) },
            {
              inline_data: {
                mime_type: "audio/wav",
                data: base64Audio,
              },
            },
          ],
        },
      ],
    }

    const response = await fetcher(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    })

    input.onState?.("receiving")
    if (!response.ok) {
      const text = await response.text().catch(() => "")
      throw new Error(`Dictation request failed (${response.status}): ${text || response.statusText}`)
    }

    const payload = await response.json().catch(() => null)
    return parseGeminiTranscript(payload)
  }

  function resolveModel(model: Model): string {
    if (model === "default") return DEFAULT_GOOGLE_AUDIO_MODEL
    if (model === "gemini-3-flash") return "gemini-3-flash-preview"
    return model
  }

  function resolvePrompt(config: RuntimeConfig): string {
    const primary = config.language?.trim()
    const alternatives = config.alternativeLanguages?.map((lang) => lang.trim()).filter(Boolean) ?? []
    const languages = [
      ...(primary && primary.toLowerCase() !== "auto" ? [primary] : []),
      ...alternatives,
    ]
    if (languages.length > 0) {
      return `Transcribe the audio. Language may be: ${languages.join(", ")}.`
    }
    return DEFAULT_GOOGLE_AUDIO_PROMPT
  }

  function parseGeminiTranscript(value: unknown): string | undefined {
    if (!value || typeof value !== "object") return
    const candidates = (value as Record<string, unknown>).candidates
    if (!Array.isArray(candidates) || candidates.length === 0) return
    const parts = (candidates[0] as Record<string, unknown>)?.content
      ? ((candidates[0] as Record<string, unknown>).content as Record<string, unknown>)?.parts
      : undefined
    if (!Array.isArray(parts)) return
    const text = parts
      .map((part) => (part && typeof part === "object" ? (part as Record<string, unknown>).text : undefined))
      .map((part) => (typeof part === "string" ? part.trim() : ""))
      .filter(Boolean)
      .join("\n")
      .trim()
    return text || undefined
  }

  async function resolveGoogleAuth(): Promise<{ apiKey?: string }> {
    const envApiKey = process.env["GOOGLE_API_KEY"] ?? process.env["GEMINI_API_KEY"]
    if (envApiKey) return { apiKey: envApiKey.trim() }

    const stored = await Auth.get("google")
    if (stored?.type === "api" && stored.key) {
      return { apiKey: stored.key }
    }

    return {}
  }

  function decodeWavPcm16(input: Uint8Array): DecodedPcm16Wav | undefined {
    if (input.byteLength < 44) return
    const view = new DataView(input.buffer, input.byteOffset, input.byteLength)
    if (readTag(view, 0) !== "RIFF" || readTag(view, 8) !== "WAVE") return

    let offset = 12
    let format:
      | { audioFormat: number; channels: number; sampleRate: number; bitsPerSample: number }
      | undefined
    let dataOffset: number | undefined
    let dataSize: number | undefined

    while (offset + 8 <= input.byteLength) {
      const chunkId = readTag(view, offset)
      const chunkSize = view.getUint32(offset + 4, true)
      offset += 8

      if (chunkId === "fmt ") {
        if (chunkSize < 16) return
        format = {
          audioFormat: view.getUint16(offset, true),
          channels: view.getUint16(offset + 2, true),
          sampleRate: view.getUint32(offset + 4, true),
          bitsPerSample: view.getUint16(offset + 14, true),
        }
        offset += chunkSize
        if (chunkSize % 2 === 1) offset += 1
      } else if (chunkId === "data") {
        dataOffset = offset
        dataSize = Math.min(chunkSize, input.byteLength - offset)
        break
      } else {
        if (offset + chunkSize > input.byteLength) break
        offset += chunkSize
        if (chunkSize % 2 === 1) offset += 1
      }
    }

    if (!format || dataOffset === undefined || dataSize === undefined) return
    if (format.audioFormat !== 1 || format.bitsPerSample !== 16) return
    if (format.channels < 1) return

    const bytesPerSample = 2
    const frameSize = bytesPerSample * format.channels
    const available = Math.min(dataSize, input.byteLength - dataOffset)
    const frameCount = Math.floor(available / frameSize)
    if (frameCount <= 0) return

    if (format.channels === 1) {
      const pcmByteLength = frameCount * bytesPerSample
      return {
        pcm: input.slice(dataOffset, dataOffset + pcmByteLength),
        sampleRate: format.sampleRate,
      }
    }

    const dv = new DataView(input.buffer, input.byteOffset + dataOffset, frameCount * frameSize)
    const buffer = Buffer.allocUnsafe(frameCount * bytesPerSample)
    for (let i = 0; i < frameCount; i++) {
      let sum = 0
      for (let c = 0; c < format.channels; c++) {
        sum += dv.getInt16(i * frameSize + c * bytesPerSample, true)
      }
      const avg = Math.round(sum / format.channels)
      buffer.writeInt16LE(Math.max(-32768, Math.min(32767, avg)), i * bytesPerSample)
    }

    return { pcm: new Uint8Array(buffer), sampleRate: format.sampleRate }
  }

  function truncatePcm16(input: DecodedPcm16Wav, maxDurationSeconds: number): DecodedPcm16Wav {
    if (!Number.isFinite(maxDurationSeconds) || maxDurationSeconds <= 0) return input
    const maxSamples = Math.floor(maxDurationSeconds * input.sampleRate)
    if (maxSamples <= 0) return input
    const maxBytes = maxSamples * 2
    if (input.pcm.byteLength <= maxBytes) return input
    return { pcm: input.pcm.slice(0, maxBytes), sampleRate: input.sampleRate }
  }

  function readTag(view: DataView, offset: number): string {
    return String.fromCharCode(
      view.getUint8(offset),
      view.getUint8(offset + 1),
      view.getUint8(offset + 2),
      view.getUint8(offset + 3),
    )
  }

  async function readAll(stream?: ReadableStream<Uint8Array> | null): Promise<Uint8Array> {
    if (!stream) return new Uint8Array()
    const reader = stream.getReader()
    const chunks: Uint8Array[] = []
    let size = 0
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (value) {
        chunks.push(value)
        size += value.length
      }
    }
    const output = new Uint8Array(size)
    let offset = 0
    for (const chunk of chunks) {
      output.set(chunk, offset)
      offset += chunk.length
    }
    return output
  }

  async function readAllText(stream?: ReadableStream<Uint8Array> | null): Promise<string> {
    const bytes = await readAll(stream)
    return new TextDecoder().decode(bytes)
  }
}
