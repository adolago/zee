import { platform } from "os"
import { Auth } from "@/auth"

export namespace Dictation {
  export type Config = {
    enabled?: boolean
    language?: string
    alternative_languages?: string[]
    sample_rate?: number
    auto_submit?: boolean
    max_duration?: number
    record_command?: string | string[]
  }

  export type RuntimeConfig = {
    language: string
    alternativeLanguages: string[]
    sampleRate: number
    autoSubmit: boolean
    maxDuration: number
    recordCommand?: string | string[]
    apiKey: string
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
  const WISPRFLOW_API_URL = "https://platform-api.wisprflow.ai/api/v1/dash/api"

  export async function resolveConfig(input?: Config): Promise<RuntimeConfig | undefined> {
    if (input?.enabled === false) return

    const auth = await resolveAuth()
    if (!auth.apiKey) return

    return {
      language: input?.language ?? DEFAULT_LANGUAGE,
      alternativeLanguages: input?.alternative_languages ?? DEFAULT_ALTERNATIVE_LANGUAGES,
      sampleRate: input?.sample_rate ?? DEFAULT_SAMPLE_RATE,
      autoSubmit: input?.auto_submit ?? false,
      maxDuration: input?.max_duration ?? DEFAULT_MAX_DURATION,
      recordCommand: input?.record_command,
      apiKey: auth.apiKey,
    }
  }

  export function resolveRecorderCommand(input: {
    sampleRate: number
    command?: string | string[]
  }): string[] | undefined {
    const override = input.command ?? process.env["ZEE_DICTATION_RECORD_COMMAND"]
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
      ? [
          sox,
          "-q",
          "-d",
          "-r",
          String(input.sampleRate),
          "-c",
          "1",
          "-b",
          "16",
          "-e",
          "signed-integer",
          "-t",
          "wav",
          "-",
        ]
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
    const wavBytes = encodePcm16ToWav(truncated)
    const base64Audio = Buffer.from(wavBytes).toString("base64")

    const languages: string[] = []
    const primary = input.config.language?.split("-")[0]
    if (primary && primary.toLowerCase() !== "auto") {
      languages.push(primary)
    }
    for (const alt of input.config.alternativeLanguages ?? []) {
      const code = alt.split("-")[0]
      if (code && !languages.includes(code)) languages.push(code)
    }

    const body: Record<string, unknown> = { audio: base64Audio }
    if (languages.length > 0) body.language = languages

    const response = await fetcher(WISPRFLOW_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${input.config.apiKey}`,
      },
      body: JSON.stringify(body),
    })

    input.onState?.("receiving")
    if (!response.ok) {
      const text = await response.text().catch(() => "")
      throw new Error(`Wispr Flow transcription failed (${response.status}): ${text || response.statusText}`)
    }

    const payload = (await response.json().catch(() => null)) as { text?: string } | null
    return payload?.text?.trim() || undefined
  }

  async function resolveAuth(): Promise<{ apiKey?: string }> {
    const envApiKey = process.env["WISPRFLOW_API_KEY"]
    if (envApiKey) return { apiKey: envApiKey.trim() }

    const stored = await Auth.get("wisprflow")
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
    let format: { audioFormat: number; channels: number; sampleRate: number; bitsPerSample: number } | undefined
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

  function encodePcm16ToWav(input: DecodedPcm16Wav): Uint8Array {
    const channels = 1
    const bitsPerSample = 16
    const byteRate = input.sampleRate * channels * (bitsPerSample / 8)
    const blockAlign = channels * (bitsPerSample / 8)
    const dataSize = input.pcm.byteLength
    const headerSize = 44
    const buffer = Buffer.allocUnsafe(headerSize + dataSize)
    // RIFF header
    buffer.write("RIFF", 0, "ascii")
    buffer.writeUInt32LE(headerSize - 8 + dataSize, 4)
    buffer.write("WAVE", 8, "ascii")
    // fmt sub-chunk
    buffer.write("fmt ", 12, "ascii")
    buffer.writeUInt32LE(16, 16) // sub-chunk size
    buffer.writeUInt16LE(1, 20) // PCM format
    buffer.writeUInt16LE(channels, 22)
    buffer.writeUInt32LE(input.sampleRate, 24)
    buffer.writeUInt32LE(byteRate, 28)
    buffer.writeUInt16LE(blockAlign, 32)
    buffer.writeUInt16LE(bitsPerSample, 34)
    // data sub-chunk
    buffer.write("data", 36, "ascii")
    buffer.writeUInt32LE(dataSize, 40)
    buffer.set(input.pcm, headerSize)
    return new Uint8Array(buffer)
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
