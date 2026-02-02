import { platform } from "os"
import path from "path"
import { Auth } from "@/auth"

type GoogleServiceAccountCredentials = {
  client_email: string
  private_key: string
  private_key_id?: string
}

export namespace Dictation {
  export type Provider = "google"
  export type Model = "default" | "chirp_2"

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
      apiKey?: string
      credentials?: GoogleServiceAccountCredentials
      projectId?: string
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

  export async function resolveConfig(input?: Config): Promise<RuntimeConfig | undefined> {
    if (input?.enabled === false) return
    const provider: Provider = input?.provider ?? "google"
    if (provider !== "google") return

    const model: Model = input?.model ?? "default"
    const google = await resolveGoogleAuth()

    // Check for ADC availability:
    // 1. Explicit GOOGLE_APPLICATION_CREDENTIALS env var
    // 2. Service account env vars (GOOGLE_CLIENT_EMAIL + GOOGLE_PRIVATE_KEY)
    // 3. Default ADC file location (~/.config/gcloud/application_default_credentials.json)
    const defaultAdcPath = path.join(
      process.env["HOME"] ?? process.env["USERPROFILE"] ?? "",
      ".config",
      "gcloud",
      "application_default_credentials.json"
    )
    const hasAdc =
      Boolean(process.env["GOOGLE_APPLICATION_CREDENTIALS"]) ||
      (Boolean(process.env["GOOGLE_CLIENT_EMAIL"]) && Boolean(process.env["GOOGLE_PRIVATE_KEY"])) ||
      (await Bun.file(defaultAdcPath).exists())
    if (!google.apiKey && !google.credentials && !hasAdc) return

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
      google,
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

    // Use Chirp 2 with V2 API or default V1 API
    if (input.config.model === "chirp_2") {
      return transcribeChirp2(input, truncated, base64Audio, fetcher)
    }

    // Default: V1 API
    const body = {
      config: {
        encoding: "LINEAR16",
        sampleRateHertz: truncated.sampleRate,
        languageCode: input.config.language,
        alternativeLanguageCodes: input.config.alternativeLanguages,
        enableAutomaticPunctuation: true,
      },
      audio: { content: base64Audio },
    }

    const url = new URL("https://speech.googleapis.com/v1/speech:recognize")
    const headers: Record<string, string> = { "Content-Type": "application/json" }

    if (input.config.google.apiKey) {
      url.searchParams.set("key", input.config.google.apiKey)
    } else {
      headers.Authorization = `Bearer ${await getGoogleAccessToken(input.config.google.credentials)}`
      // For ADC with user credentials, we need to specify a quota project
      const quotaProject = input.config.google.projectId ?? (await getGoogleProjectId(input.config.google.credentials))
      if (quotaProject) {
        headers["x-goog-user-project"] = quotaProject
      }
    }

    const response = await fetcher(url.toString(), {
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
    return parseGoogleTranscript(payload)
  }

  async function transcribeChirp2(
    input: {
      config: RuntimeConfig
      onState?: (state: TranscribeState) => void
    },
    truncated: DecodedPcm16Wav,
    base64Audio: string,
    fetcher: typeof fetch
  ): Promise<string | undefined> {
    // Chirp 2 uses Speech-to-Text V2 API
    // Endpoint: https://{region}-speech.googleapis.com/v2/projects/{project}/locations/{region}/recognizers/_:recognize
    const region = input.config.region
    const projectId = input.config.google.projectId ?? (await getGoogleProjectId(input.config.google.credentials))

    if (!projectId) {
      throw new Error("Chirp 2 requires a Google Cloud project ID. Set GOOGLE_CLOUD_PROJECT or use a service account key.")
    }

    // V2 API uses recognizers path: /recognizers/_:recognize (underscore means default recognizer)
    const url = `https://${region}-speech.googleapis.com/v2/projects/${projectId}/locations/${region}/recognizers/_:recognize`
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${await getGoogleAccessToken(input.config.google.credentials)}`,
    }

    // V2 API request format for Chirp 2
    const body = {
      config: {
        model: "chirp_2",
        languageCodes: input.config.language === "auto" ? ["auto"] : [input.config.language],
        features: {
          enableAutomaticPunctuation: true,
        },
        explicitDecodingConfig: {
          encoding: "LINEAR16",
          sampleRateHertz: truncated.sampleRate,
          audioChannelCount: 1,
        },
      },
      content: base64Audio,
    }

    const response = await fetcher(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    })

    input.onState?.("receiving")
    if (!response.ok) {
      const text = await response.text().catch(() => "")
      throw new Error(`Chirp 2 transcription failed (${response.status}): ${text || response.statusText}`)
    }

    const payload = await response.json().catch(() => null)
    return parseChirp2Transcript(payload)
  }

  function parseChirp2Transcript(value: unknown): string | undefined {
    // V2 API response format
    if (!value || typeof value !== "object") return
    const results = (value as Record<string, unknown>).results
    if (!Array.isArray(results)) return
    const parts: string[] = []
    for (const result of results) {
      if (!result || typeof result !== "object") continue
      const alternatives = (result as Record<string, unknown>).alternatives
      if (!Array.isArray(alternatives) || alternatives.length === 0) continue
      const first = alternatives[0]
      if (first && typeof first === "object") {
        const transcript = (first as Record<string, unknown>).transcript
        if (typeof transcript === "string" && transcript.trim()) parts.push(transcript.trim())
      }
    }
    return parts.join(" ").trim() || undefined
  }

  function parseGoogleTranscript(value: unknown): string | undefined {
    if (!value || typeof value !== "object") return
    const results = (value as Record<string, unknown>).results
    if (!Array.isArray(results)) return
    const parts: string[] = []
    for (const result of results) {
      if (!result || typeof result !== "object") continue
      const alternatives = (result as Record<string, unknown>).alternatives
      if (!Array.isArray(alternatives) || alternatives.length === 0) continue
      const first = alternatives[0]
      if (first && typeof first === "object") {
        const transcript = (first as Record<string, unknown>).transcript
        if (typeof transcript === "string" && transcript.trim()) parts.push(transcript.trim())
      }
    }
    return parts.join(" ").trim() || undefined
  }

  async function resolveGoogleAuth(): Promise<{ apiKey?: string; credentials?: GoogleServiceAccountCredentials }> {
    const envApiKey = process.env["GOOGLE_STT_API_KEY"] ?? process.env["OPENCODE_GOOGLE_STT_API_KEY"]
    if (envApiKey) return { apiKey: envApiKey.trim() }

    const envClientEmail = process.env["GOOGLE_CLIENT_EMAIL"]
    const envPrivateKey = process.env["GOOGLE_PRIVATE_KEY"]
    const envPrivateKeyId = process.env["GOOGLE_PRIVATE_KEY_ID"]
    if (envClientEmail && envPrivateKey) {
      return {
        credentials: {
          client_email: envClientEmail,
          private_key: envPrivateKey.replace(/\\n/g, "\n"),
          ...(envPrivateKeyId ? { private_key_id: envPrivateKeyId } : {}),
        },
      }
    }

    // Check for stored service account credentials
    // Note: We only accept service account JSON keys here, not API keys,
    // because Speech-to-Text API requires OAuth tokens (not API keys)
    const stored = await Auth.get("google-stt")
    if (stored?.type === "api" && stored.key) {
      const parsed = parseGoogleServiceAccountKey(stored.key)
      if (parsed) return { credentials: parsed }
      // If not a service account key, fall through to use ADC
      // (Speech API doesn't support API keys, only OAuth)
    }

    // Return empty to signal that ADC should be used
    return {}
  }

  function parseGoogleServiceAccountKey(value: string): GoogleServiceAccountCredentials | undefined {
    const trimmed = value.trim()
    if (!trimmed.startsWith("{")) return
    try {
      const parsed = JSON.parse(trimmed) as Record<string, unknown>
      const clientEmail = parsed["client_email"]
      const privateKey = parsed["private_key"]
      if (typeof clientEmail !== "string" || !clientEmail.trim()) return
      if (typeof privateKey !== "string" || !privateKey.trim()) return
      const privateKeyId = parsed["private_key_id"]
      return {
        client_email: clientEmail,
        private_key: privateKey,
        ...(typeof privateKeyId === "string" && privateKeyId.trim() ? { private_key_id: privateKeyId } : {}),
      }
    } catch {
      return
    }
  }

  async function getGoogleAccessToken(credentials?: GoogleServiceAccountCredentials): Promise<string> {
    const { GoogleAuth } = await import("google-auth-library")
    const auth = new GoogleAuth({
      scopes: ["https://www.googleapis.com/auth/cloud-platform"],
      ...(credentials ? { credentials } : {}),
    })
    const client = await auth.getClient()
    const token = await client.getAccessToken()
    if (token?.token) return token.token
    throw new Error(
      "Unable to obtain Google access token. Set GOOGLE_APPLICATION_CREDENTIALS, or connect google-stt with a service-account JSON key.",
    )
  }

  async function getGoogleProjectId(credentials?: GoogleServiceAccountCredentials): Promise<string | undefined> {
    // Try environment variables first
    const envProjectId = process.env["GOOGLE_CLOUD_PROJECT"] ?? process.env["GCLOUD_PROJECT"] ?? process.env["GCP_PROJECT"]
    if (envProjectId) return envProjectId

    // Try to extract from service account credentials
    if (credentials) {
      const { GoogleAuth } = await import("google-auth-library")
      const auth = new GoogleAuth({ credentials })
      const projectId = await auth.getProjectId().catch(() => undefined)
      if (projectId) return projectId
    }

    // Try ADC
    try {
      const { GoogleAuth } = await import("google-auth-library")
      const auth = new GoogleAuth({ scopes: ["https://www.googleapis.com/auth/cloud-platform"] })
      const projectId = await auth.getProjectId()
      if (projectId) return projectId
    } catch {
      // ignore
    }

    return undefined
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
