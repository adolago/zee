/**
 * Surface Bootstrap
 *
 * Initializes the surface router and registers default surfaces.
 * Called by daemon on startup to enable multi-surface support.
 */

import path from "node:path"
import os from "node:os"
import { randomUUID } from "node:crypto"
import { mkdir, writeFile } from "node:fs/promises"
import { pathToFileURL } from "node:url"
import { Bus } from "../bus"
import { Auth } from "../auth"
import { getSurfaceRouter, SurfaceRouter, type MessageHandler } from "../surface/router"
import { createCLISurface } from "../surface/cli"
import { createMessagingSurface } from "../surface/messaging"
import { TelegramPlatformHandler } from "../surface/platforms/telegram"
import { WhatsAppPlatformHandler } from "../surface/platforms/whatsapp"
import type { Surface } from "../surface/surface"
import type { StreamChunk, SurfaceMedia, SurfaceMessage, SurfaceResponse } from "../surface/types"
import { Log } from "../util/log"
import { Config } from "../config/config"
import { Global } from "../global"
import { sendWhatsAppMessage } from "@root/domain/zee/whatsapp-send"
import { SessionPrompt } from "../session/prompt"
import { Session } from "../session"
import { MessageV2 } from "../session/message-v2"
import { Storage } from "../storage/storage"
import { Dictation } from "../cli/cmd/tui/util/dictation"
import { sanitizeAssistantText } from "../util/assistant-sanitize"

const log = Log.create({ service: "surface-bootstrap" })

// Track initialized state
let initialized = false
let router: SurfaceRouter | null = null

type MessagingSurfaceName = "whatsapp" | "telegram"

type SurfaceBootstrapConfig = {
  /** Enable CLI surface (default: true) */
  enableCLI?: boolean
  /** Enable WhatsApp messaging surface */
  enableWhatsApp?: boolean
  /** WhatsApp surface configuration */
  whatsApp?: {
    allowedNumbers?: string[]
    allowedGroups?: string[]
    requireMention?: boolean
    operators?: string[]
    releasePin?: string
    releaseTimeoutMs?: number
  }
  /** Enable Telegram messaging surface */
  enableTelegram?: boolean
  /** Telegram surface configuration */
  telegram?: {
    token?: string
    apiBaseUrl?: string
    pollTimeoutSec?: number
    allowedChatIds?: Array<number | string>
    allowedSenders?: string[]
    allowedGroups?: string[]
    requireMention?: boolean
    operators?: string[]
    mediaMaxMb?: number
    streamEditIntervalMs?: number
    releasePin?: string
    releaseTimeoutMs?: number
  }
  /** Enable analytics collection */
  enableAnalytics?: boolean
  /** Enable hot-reload of surface configs */
  enableHotReload?: boolean
}

type SessionResolveInput = {
  surface: MessagingSurfaceName
  senderId: string
  isGroup: boolean
  threadId?: string
  forceNew?: boolean
}

type SlashCommand = {
  name: string
  args: string
}

type MiniMaxTtsResponse = {
  base_resp?: {
    status_code?: number
    status_msg?: string
  }
  data?: {
    audio?: string
    status?: number
  }
  extra_info?: {
    audio_format?: string
  }
}

type StreamChannel = {
  push(chunk: StreamChunk): void
  close(): void
  fail(error: Error): void
  iterable: AsyncIterable<StreamChunk>
}

const BOT_COMMANDS = new Set(["/start", "/help", "/new", "/reset", "/session", "/speak"])
const MINIMAX_TTS_URL = "https://api.minimax.io/v1/t2a_v2"
const MINIMAX_DEFAULT_VOICE = "Calm_Woman"
const MINIMAX_DEFAULT_MODEL = "speech-02-hd"
const MINIMAX_MAX_TEXT_LENGTH = 10_000
const TELEGRAM_AUTH_PROVIDER_ID = "telegram-bot"
const TELEGRAM_LEGACY_IMPORT_FLAG_KEY = ["surface_sessions", "telegram", "_legacy_bridge_import_v1"]
const TELEGRAM_TOPIC_THREAD_ID_RE = /^-?\d+:topic:\d+$/
const migratedTelegramGroupChats = new Set<string>()

type LegacyTelegramBridgeState = {
  sessions?: Record<string, unknown>
}

type LegacyTelegramBridgeImportSummary = {
  source: string
  imported: number
  skipped: number
  reason?: "already_imported" | "missing_state_file" | "invalid_state"
}

function displaySurface(surface: MessagingSurfaceName): string {
  return surface === "telegram" ? "Telegram" : "WhatsApp"
}

function resolveMessagingSurface(surfaceId: string): MessagingSurfaceName {
  if (surfaceId.endsWith(":telegram")) return "telegram"
  return "whatsapp"
}

function parseSlashCommand(body: string): SlashCommand | null {
  const trimmed = body.trim()
  if (!trimmed.startsWith("/")) return null

  const [raw, ...rest] = trimmed.split(/\s+/)
  const name = raw.split("@", 1)[0]?.toLowerCase()
  if (!name) return null

  return {
    name,
    args: rest.join(" ").trim(),
  }
}

function commandHelpText(surface: MessagingSurfaceName): string {
  return [
    `${displaySurface(surface)} commands:`,
    "/new - start a fresh Zee session",
    "/session - show current session id",
    "/speak [text] - generate speech with MiniMax TTS",
    "/help - show this message",
  ].join("\n")
}

function collapseWhitespace(input: string): string {
  return input.replace(/\s+/g, " ").trim()
}

export function normalizeTechnicalErrorMessage(error: unknown): string {
  const fromString = (value: string | undefined): string | undefined => {
    const collapsed = collapseWhitespace(value ?? "")
    return collapsed || undefined
  }

  if (typeof error === "string") {
    return fromString(error) ?? "Unknown error"
  }

  if (error instanceof Error) {
    const fromMessage = fromString(error.message)
    if (fromMessage) return fromMessage
    const fromCause = normalizeTechnicalErrorMessage(error.cause)
    if (fromCause) return fromCause
    return fromString(error.name) ?? "Unknown error"
  }

  if (error && typeof error === "object") {
    const asRecord = error as Record<string, unknown>
    const direct = typeof asRecord.message === "string" ? fromString(asRecord.message) : undefined
    if (direct) return direct

    const nestedError = asRecord.error
    if (nestedError && typeof nestedError === "object" && typeof (nestedError as Record<string, unknown>).message === "string") {
      const nested = fromString((nestedError as Record<string, unknown>).message as string)
      if (nested) return nested
    }

    const nestedData = asRecord.data
    if (nestedData && typeof nestedData === "object" && typeof (nestedData as Record<string, unknown>).message === "string") {
      const nested = fromString((nestedData as Record<string, unknown>).message as string)
      if (nested) return nested
    }

    try {
      return fromString(JSON.stringify(error)) ?? "Unknown error"
    } catch {
      return "Unknown error"
    }
  }

  return fromString(String(error)) ?? "Unknown error"
}

export function formatDetailedSurfaceError(error: unknown): string {
  const message = normalizeTechnicalErrorMessage(error)
  if (message.toLowerCase().startsWith("zee error:")) {
    return message
  }
  return `Zee error: ${message}`
}

function resolveLegacyTelegramBridgeStatePath(): string {
  const configured = process.env.ZEE_TELEGRAM_STATE?.trim()
  if (configured) return configured
  return path.join(os.homedir(), ".local", "state", "zee", "telegram-bridge.json")
}

export async function resolveTelegramBotToken(configToken?: string): Promise<string | undefined> {
  const fromConfig = configToken?.trim()
  if (fromConfig) return fromConfig

  const fromEnv = process.env.TELEGRAM_BOT_TOKEN?.trim()
  if (fromEnv) return fromEnv

  const auth = await Auth.get(TELEGRAM_AUTH_PROVIDER_ID).catch(() => undefined)
  if (auth?.type === "api" && auth.key.trim()) {
    return auth.key.trim()
  }

  return
}

function normalizeBodyForPrompt(body: string): string {
  const trimmed = body.trim()
  return trimmed === "[media]" ? "" : trimmed
}

function inferMimeFromPath(filePath: string): string | undefined {
  const ext = path.extname(filePath).toLowerCase()
  switch (ext) {
    case ".jpg":
    case ".jpeg":
      return "image/jpeg"
    case ".png":
      return "image/png"
    case ".webp":
      return "image/webp"
    case ".gif":
      return "image/gif"
    case ".pdf":
      return "application/pdf"
    case ".mp3":
      return "audio/mpeg"
    case ".ogg":
    case ".oga":
    case ".opus":
      return "audio/ogg"
    case ".wav":
      return "audio/wav"
    case ".mp4":
      return "video/mp4"
    case ".mov":
      return "video/quicktime"
    default:
      return undefined
  }
}

function mediaPathToURL(media: SurfaceMedia): string | undefined {
  const source = media.path.trim()
  if (!source) return undefined
  const lower = source.toLowerCase()

  if (lower.startsWith("file://") || lower.startsWith("http://") || lower.startsWith("https://") || lower.startsWith("data:")) {
    return source
  }

  if (/^[a-z]+:\/\//i.test(source)) {
    // Unknown custom scheme (ex: wacli://) is not consumable by model providers.
    return undefined
  }

  return pathToFileURL(source).toString()
}

function isAudioMedia(media: SurfaceMedia): boolean {
  const mime = media.mimeType?.toLowerCase() ?? ""
  if (mime.startsWith("audio/")) return true

  const ext = path.extname(media.filename ?? media.path).toLowerCase()
  return [".ogg", ".oga", ".opus", ".wav", ".mp3", ".m4a", ".aac", ".flac"].includes(ext)
}

async function readAll(stream?: ReadableStream<Uint8Array> | null): Promise<Uint8Array> {
  if (!stream) return new Uint8Array()
  const reader = stream.getReader()
  const chunks: Uint8Array[] = []
  let total = 0

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    if (!value) continue
    chunks.push(value)
    total += value.length
  }

  const output = new Uint8Array(total)
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

async function mediaToWav(media: SurfaceMedia): Promise<Uint8Array | undefined> {
  const source = media.path.trim()
  if (!source) return
  if (/^(https?|data|file):\/\//i.test(source) && !source.startsWith("file://")) return

  const filePath = source.startsWith("file://") ? decodeURIComponent(new URL(source).pathname) : source
  const file = Bun.file(filePath)
  if (!(await file.exists())) return

  const mime = media.mimeType?.toLowerCase() ?? inferMimeFromPath(filePath)
  if (mime === "audio/wav") {
    return new Uint8Array(await file.arrayBuffer())
  }

  const ffmpeg = Bun.which("ffmpeg")
  if (!ffmpeg) {
    log.debug("Skipping voice transcription, ffmpeg not found")
    return
  }

  const process = Bun.spawn({
    cmd: [
      ffmpeg,
      "-hide_banner",
      "-loglevel",
      "error",
      "-i",
      filePath,
      "-ac",
      "1",
      "-ar",
      "16000",
      "-f",
      "wav",
      "pipe:1",
    ],
    stdout: "pipe",
    stderr: "pipe",
  })

  const stdout = await readAll(process.stdout)
  const stderr = await readAllText(process.stderr)
  const exitCode = await process.exited

  if (exitCode !== 0 || stdout.byteLength === 0) {
    log.debug("ffmpeg conversion failed for voice transcription", {
      exitCode,
      stderr: stderr.trim(),
      source: filePath,
    })
    return
  }

  return stdout
}

async function transcribeVoice(media: SurfaceMedia[]): Promise<string | undefined> {
  const audioCandidates = media.filter(isAudioMedia)
  if (audioCandidates.length === 0) return

  const config = await Dictation.resolveConfig({ enabled: true })
  if (!config) return

  for (const candidate of audioCandidates) {
    try {
      const wav = await mediaToWav(candidate)
      if (!wav || wav.byteLength === 0) continue

      const text = await Dictation.transcribe({
        config,
        audio: wav,
      })
      if (text?.trim()) {
        return text.trim()
      }
    } catch (error) {
      log.warn("Voice transcription failed", {
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  return
}

async function buildPromptParts(message: SurfaceMessage): Promise<SessionPrompt.PromptInput["parts"]> {
  const parts: SessionPrompt.PromptInput["parts"] = []
  const media = message.media ?? []

  const textSegments: string[] = []
  const messageText = normalizeBodyForPrompt(message.body)
  if (messageText) {
    textSegments.push(messageText)
  }

  const transcript = await transcribeVoice(media)
  if (transcript) {
    textSegments.push(`Voice transcript:\n${transcript}`)
  }

  const fileParts: SessionPrompt.PromptInput["parts"] = []
  for (const item of media) {
    const url = mediaPathToURL(item)
    if (!url) continue
    fileParts.push({
      type: "file",
      url,
      filename: item.filename,
      mime: item.mimeType ?? inferMimeFromPath(item.path) ?? "application/octet-stream",
    })
  }

  if (textSegments.length === 0 && fileParts.length > 0) {
    textSegments.push("Please analyze the attached media.")
  }

  if (textSegments.length > 0) {
    parts.push({
      type: "text",
      text: textSegments.join("\n\n").trim(),
    })
  }

  parts.push(...fileParts)

  if (parts.length === 0) {
    parts.push({
      type: "text",
      text: message.body.trim() || "Continue.",
    })
  }

  return parts
}

function extractTextParts(parts: MessageV2.Part[]): string {
  return parts
    .filter((part): part is MessageV2.TextPart => part.type === "text" && !part.synthetic && !part.ignored)
    .map((part) => sanitizeAssistantText(part.text))
    .filter((text) => text.length > 0)
    .join("\n")
    .trim()
}

async function resolveAssistantText(sessionID: string, result: MessageV2.WithParts): Promise<string> {
  const fromResult = extractTextParts(result.parts)
  if (fromResult) return fromResult

  const history = await Session.messages({ sessionID, limit: 20 })
  for (let i = history.length - 1; i >= 0; i--) {
    const msg = history[i]
    if (msg.info.role !== "assistant") continue
    const text = extractTextParts(msg.parts)
    if (text) return text
  }

  return ""
}

function createStreamChannel(): StreamChannel {
  const queue: StreamChunk[] = []
  const waiters: Array<() => void> = []
  let done = false
  let failed: Error | null = null

  const notify = () => {
    for (const waiter of waiters.splice(0)) waiter()
  }

  const iterable: AsyncIterable<StreamChunk> = {
    [Symbol.asyncIterator]: async function* () {
      while (true) {
        if (queue.length > 0) {
          yield queue.shift()!
          continue
        }
        if (failed) {
          throw failed
        }
        if (done) {
          return
        }
        await new Promise<void>((resolve) => waiters.push(resolve))
      }
    },
  }

  return {
    push(chunk) {
      if (done || failed) return
      queue.push(chunk)
      notify()
    },
    close() {
      if (done) return
      done = true
      notify()
    },
    fail(error: Error) {
      if (done) return
      failed = error
      done = true
      notify()
    },
    iterable,
  }
}

function buildSessionStorageKey(input: SessionResolveInput): string[] {
  const normalizedSenderId = input.senderId.trim().replace(/^\+/, "")
  const normalizedThreadID = input.threadId?.trim()

  if (input.surface === "telegram") {
    if (input.isGroup) {
      const groupID = normalizedThreadID || normalizedSenderId
      return ["surface_sessions", "telegram", `group_${groupID}`]
    }

    if (isTelegramTopicThreadId(normalizedThreadID)) {
      return ["surface_sessions", "telegram", `dm_topic_${normalizedThreadID}`]
    }

    return ["surface_sessions", "telegram", `dm_${normalizedSenderId}`]
  }

  const suffix = input.isGroup && normalizedThreadID
    ? `group_${normalizedThreadID}`
    : `dm_${normalizedSenderId}`
  return ["surface_sessions", input.surface, suffix]
}

function isTelegramTopicThreadId(value?: string): boolean {
  return TELEGRAM_TOPIC_THREAD_ID_RE.test(value?.trim() ?? "")
}

function normalizeTelegramGroupChatId(threadId?: string): string | undefined {
  const normalized = threadId?.trim()
  if (!normalized) return undefined
  if (/^-?\d+$/.test(normalized)) return normalized
  return undefined
}

async function readMappedSessionIdByStorageKey(key: string[]): Promise<string | undefined> {
  const mapping = await Storage.read<{ sessionId?: string }>(key).catch(() => undefined)
  const sessionId = mapping?.sessionId?.trim()
  return sessionId || undefined
}

async function readMappedSessionId(input: SessionResolveInput): Promise<string | undefined> {
  return readMappedSessionIdByStorageKey(buildSessionStorageKey(input))
}

async function migrateLegacyTelegramGroupTopicMappings(groupThreadId?: string): Promise<void> {
  const groupChatId = normalizeTelegramGroupChatId(groupThreadId)
  if (!groupChatId) return
  if (migratedTelegramGroupChats.has(groupChatId)) return
  migratedTelegramGroupChats.add(groupChatId)

  const canonicalKey = ["surface_sessions", "telegram", `group_${groupChatId}`]
  const legacyPrefix = `group_${groupChatId}:topic:`

  const allKeys = await Storage.list(["surface_sessions", "telegram"])
  const legacyTopicKeys = allKeys.filter((key) => {
    const suffix = key[2]
    return typeof suffix === "string" && suffix.startsWith(legacyPrefix)
  })
  if (legacyTopicKeys.length === 0) return

  const canonicalSessionId = await readMappedSessionIdByStorageKey(canonicalKey)
  if (canonicalSessionId) {
    let removed = 0
    let conflicts = 0
    for (const key of legacyTopicKeys) {
      const legacySessionId = await readMappedSessionIdByStorageKey(key)
      if (legacySessionId && legacySessionId !== canonicalSessionId) conflicts += 1
      await Storage.remove(key)
      removed += 1
    }
    log.info("Telegram legacy group topic mappings migrated to canonical key", {
      chatId: groupChatId,
      canonicalSessionId,
      removed,
      conflicts,
      policy: "prefer_canonical",
    })
    return
  }

  const validLegacyMappings: Array<{ key: string[]; sessionId: string; updatedAt: number }> = []
  let removed = 0
  for (const key of legacyTopicKeys) {
    const sessionId = await readMappedSessionIdByStorageKey(key)
    if (!sessionId) {
      await Storage.remove(key)
      removed += 1
      continue
    }
    try {
      const session = await Session.get(sessionId)
      validLegacyMappings.push({
        key,
        sessionId,
        updatedAt: session.time.updated,
      })
    } catch {
      await Storage.remove(key)
      removed += 1
    }
  }

  if (validLegacyMappings.length === 0) {
    if (removed > 0) {
      log.info("Telegram legacy group topic mappings removed (no valid sessions)", {
        chatId: groupChatId,
        removed,
      })
    }
    return
  }

  validLegacyMappings.sort((a, b) => {
    if (b.updatedAt !== a.updatedAt) {
      return b.updatedAt - a.updatedAt
    }
    const left = a.key[2] ?? ""
    const right = b.key[2] ?? ""
    return left.localeCompare(right)
  })
  const winner = validLegacyMappings[0]
  await Storage.write(canonicalKey, { sessionId: winner.sessionId })
  for (const mapping of validLegacyMappings) {
    await Storage.remove(mapping.key)
    removed += 1
  }

  log.info("Telegram legacy group topic mappings migrated to canonical key", {
    chatId: groupChatId,
    canonicalSessionId: winner.sessionId,
    removed,
    conflicts: Math.max(0, validLegacyMappings.length - 1),
    policy: "hard_migrate",
  })
}

function buildLegacyTelegramStorageKeyFromChat(chatID: string): string[] {
  const normalized = chatID.trim()
  const isGroup = normalized.startsWith("-") || normalized.includes(":topic:")
  const suffix = isGroup ? `group_${normalized}` : `dm_${normalized.replace(/^\+/, "")}`
  return ["surface_sessions", "telegram", suffix]
}

export async function importLegacyTelegramBridgeSessions(): Promise<LegacyTelegramBridgeImportSummary> {
  const source = resolveLegacyTelegramBridgeStatePath()
  const alreadyImported = await Storage.read<{ importedAt?: number }>(TELEGRAM_LEGACY_IMPORT_FLAG_KEY).catch(() => undefined)
  if (alreadyImported) {
    return {
      source,
      imported: 0,
      skipped: 0,
      reason: "already_imported",
    }
  }

  const file = Bun.file(source)
  if (!(await file.exists())) {
    return {
      source,
      imported: 0,
      skipped: 0,
      reason: "missing_state_file",
    }
  }

  let parsed: LegacyTelegramBridgeState
  try {
    parsed = JSON.parse(await file.text()) as LegacyTelegramBridgeState
  } catch {
    return {
      source,
      imported: 0,
      skipped: 0,
      reason: "invalid_state",
    }
  }

  const sessions = parsed.sessions
  if (!sessions || typeof sessions !== "object") {
    await Storage.write(TELEGRAM_LEGACY_IMPORT_FLAG_KEY, {
      importedAt: Date.now(),
      source,
      imported: 0,
      skipped: 0,
    })
    return {
      source,
      imported: 0,
      skipped: 0,
    }
  }

  let imported = 0
  let skipped = 0

  for (const [chatID, rawSessionID] of Object.entries(sessions)) {
    const sessionId = typeof rawSessionID === "string" ? rawSessionID.trim() : ""
    if (!sessionId) {
      skipped += 1
      continue
    }

    const storageKey = buildLegacyTelegramStorageKeyFromChat(chatID)
    const existing = await Storage.read<{ sessionId?: string }>(storageKey).catch(() => undefined)
    if (existing?.sessionId?.trim()) {
      skipped += 1
      continue
    }

    try {
      await Session.get(sessionId)
    } catch {
      skipped += 1
      continue
    }

    await Storage.write(storageKey, { sessionId })
    imported += 1
  }

  await Storage.write(TELEGRAM_LEGACY_IMPORT_FLAG_KEY, {
    importedAt: Date.now(),
    source,
    imported,
    skipped,
  })

  return {
    source,
    imported,
    skipped,
  }
}

async function resolveSessionId(input: SessionResolveInput): Promise<string> {
  if (input.surface === "telegram" && input.isGroup) {
    const threadID = input.threadId?.trim()
    if (threadID && !isTelegramTopicThreadId(threadID)) {
      await migrateLegacyTelegramGroupTopicMappings(threadID)
    }
  }

  if (!input.forceNew) {
    const mappedSessionID = await readMappedSessionId(input)
    if (mappedSessionID) {
      try {
        await Session.get(mappedSessionID)
        return mappedSessionID
      } catch {
        // Mapping is stale; create a fresh session below.
      }
    }
  }

  const surfaceLabel = displaySurface(input.surface)
  const title = input.isGroup && input.threadId
    ? `${surfaceLabel} Group: ${input.threadId}`
    : `${surfaceLabel}: ${input.senderId}`

  const session = await Session.create({
    title,
    surface: input.surface,
  })

  await Storage.write(buildSessionStorageKey(input), { sessionId: session.id })
  log.info("Created messaging session", {
    surface: input.surface,
    senderId: input.senderId,
    sessionId: session.id,
    isGroup: input.isGroup,
  })
  return session.id
}

async function resolveMiniMaxApiKey(): Promise<string | undefined> {
  const envKey = process.env.MINIMAX_TTS_API_KEY?.trim() || process.env.MINIMAX_API_KEY?.trim()
  if (envKey) return envKey

  const providers = ["minimax", "minimax-tts", "minimax-coding-plan"] as const
  for (const provider of providers) {
    const auth = await Auth.get(provider).catch(() => undefined)
    if (auth?.type === "api" && auth.key.trim()) {
      return auth.key.trim()
    }
  }

  return
}

async function resolveMiniMaxTtsSettings(): Promise<{ model: string; voice: string }> {
  const config = await Config.get().catch(() => undefined)
  const model = process.env.ZEE_MINIMAX_TTS_MODEL?.trim() || config?.messages?.tts?.minimax?.model?.trim() || MINIMAX_DEFAULT_MODEL
  const voice = process.env.ZEE_MINIMAX_TTS_VOICE?.trim() || config?.messages?.tts?.minimax?.voice?.trim() || MINIMAX_DEFAULT_VOICE
  return { model, voice }
}

async function resolveLatestAssistantText(sessionId: string): Promise<string | undefined> {
  const history = await Session.messages({ sessionID: sessionId, limit: 20 })
  for (let i = history.length - 1; i >= 0; i--) {
    const msg = history[i]
    if (msg.info.role !== "assistant") continue
    const text = extractTextParts(msg.parts)
    if (text) return text
  }
  return
}

function audioExtension(format?: string): string {
  const normalized = (format ?? "").toLowerCase()
  if (normalized.includes("wav")) return "wav"
  if (normalized.includes("ogg") || normalized.includes("opus")) return "ogg"
  if (normalized.includes("aac")) return "aac"
  return "mp3"
}

function audioMimeType(ext: string): string {
  switch (ext) {
    case "wav":
      return "audio/wav"
    case "ogg":
      return "audio/ogg"
    case "aac":
      return "audio/aac"
    default:
      return "audio/mpeg"
  }
}

function decodeTtsAudioPayload(rawAudio: string): Uint8Array {
  const trimmed = rawAudio.trim()
  if (!trimmed) {
    throw new Error("MiniMax TTS returned an empty audio payload")
  }

  if (trimmed.startsWith("data:")) {
    const marker = ";base64,"
    const idx = trimmed.indexOf(marker)
    if (idx !== -1) {
      const bytes = Buffer.from(trimmed.slice(idx + marker.length), "base64")
      if (bytes.byteLength > 0) return new Uint8Array(bytes)
    }
    throw new Error("MiniMax TTS returned an unsupported data URL payload")
  }

  const hexCandidate = trimmed.replace(/\s+/g, "")
  if (/^[0-9a-fA-F]+$/.test(hexCandidate) && hexCandidate.length % 2 === 0) {
    const bytes = Buffer.from(hexCandidate, "hex")
    if (bytes.byteLength > 0) return new Uint8Array(bytes)
  }

  const base64Candidate = trimmed.replace(/\s+/g, "")
  if (/^[A-Za-z0-9+/=]+$/.test(base64Candidate)) {
    const bytes = Buffer.from(base64Candidate, "base64")
    if (bytes.byteLength > 0) return new Uint8Array(bytes)
  }

  throw new Error("MiniMax TTS returned audio in an unsupported format")
}

async function synthesizeMiniMaxSpeech(text: string): Promise<SurfaceMedia> {
  const apiKey = await resolveMiniMaxApiKey()
  if (!apiKey) {
    throw new Error("MiniMax TTS key is missing. Run `zee auth login minimax` (or set MINIMAX_API_KEY).")
  }

  if (text.length > MINIMAX_MAX_TEXT_LENGTH) {
    throw new Error(`Text is too long for MiniMax TTS (${text.length}/${MINIMAX_MAX_TEXT_LENGTH}).`)
  }

  const settings = await resolveMiniMaxTtsSettings()
  const payload = {
    text,
    model: settings.model,
    stream: false,
    output_format: "hex",
    voice_setting: {
      voice_id: settings.voice,
    },
    audio_setting: {
      format: "mp3",
      sample_rate: 32000,
      bitrate: 128000,
      channel: 1,
    },
  } as const

  const response = await fetch(MINIMAX_TTS_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(payload),
  })

  const bodyText = await response.text()
  let data: MiniMaxTtsResponse | null = null
  try {
    data = JSON.parse(bodyText) as MiniMaxTtsResponse
  } catch {
    data = null
  }

  if (!response.ok) {
    const message = data?.base_resp?.status_msg || bodyText.slice(0, 200).trim() || `HTTP ${response.status}`
    throw new Error(`MiniMax TTS request failed: ${message}`)
  }

  const statusCode = data?.base_resp?.status_code ?? 0
  if (statusCode !== 0) {
    const message = data?.base_resp?.status_msg || "Unknown MiniMax error"
    throw new Error(`MiniMax TTS failed (${statusCode}): ${message}`)
  }

  const audioValue = data?.data?.audio
  if (typeof audioValue !== "string" || !audioValue.trim()) {
    throw new Error("MiniMax TTS did not return audio data")
  }

  let bytes: Uint8Array
  if (/^https?:\/\//i.test(audioValue.trim())) {
    const mediaResponse = await fetch(audioValue.trim())
    if (!mediaResponse.ok) {
      throw new Error(`MiniMax audio download failed: HTTP ${mediaResponse.status}`)
    }
    bytes = new Uint8Array(await mediaResponse.arrayBuffer())
  } else {
    bytes = decodeTtsAudioPayload(audioValue)
  }

  if (bytes.byteLength === 0) {
    throw new Error("MiniMax TTS returned empty audio content")
  }

  const ext = audioExtension(data?.extra_info?.audio_format)
  const mimeType = audioMimeType(ext)
  const outputDir = path.join(Global.Path.state, "tts-media")
  await mkdir(outputDir, { recursive: true })

  const filename = `speak_${Date.now()}_${randomUUID()}.${ext}`
  const outputPath = path.join(outputDir, filename)
  await writeFile(outputPath, Buffer.from(bytes))

  return {
    path: outputPath,
    filename,
    mimeType,
    size: bytes.byteLength,
  }
}

export async function handleBotCommand(input: {
  surface: MessagingSurfaceName
  command: SlashCommand
  senderId: string
  isGroup: boolean
  threadId?: string
}): Promise<SurfaceResponse | null> {
  const { command, surface } = input

  switch (command.name) {
    case "/start":
    case "/help":
      return { text: commandHelpText(surface) }

    case "/new":
    case "/reset": {
      const previousSessionID = await readMappedSessionId({
        surface,
        senderId: input.senderId,
        isGroup: input.isGroup,
        threadId: input.threadId,
      })
      const sessionId = await resolveSessionId({
        surface,
        senderId: input.senderId,
        isGroup: input.isGroup,
        threadId: input.threadId,
        forceNew: true,
      })
      const lines = [
        "Started a new Zee session for this chat.",
        `Current Zee session: ${sessionId}`,
      ]
      if (previousSessionID) {
        lines.push(`Previous session: ${previousSessionID}`)
      }
      return { text: lines.join("\n") }
    }

    case "/session": {
      const sessionId = await resolveSessionId({
        surface,
        senderId: input.senderId,
        isGroup: input.isGroup,
        threadId: input.threadId,
      })
      return { text: `Current Zee session: ${sessionId}` }
    }

    case "/speak": {
      if (surface !== "telegram") {
        return { text: "/speak is currently available only on Telegram." }
      }

      const sessionId = await resolveSessionId({
        surface,
        senderId: input.senderId,
        isGroup: input.isGroup,
        threadId: input.threadId,
      })

      const requestedText = command.args.trim() || (await resolveLatestAssistantText(sessionId)) || ""
      if (!requestedText) {
        return { text: "Usage: /speak <text>. If omitted, Zee will try to speak the latest assistant reply in this session." }
      }

      try {
        const audio = await synthesizeMiniMaxSpeech(requestedText)
        return {
          media: [audio],
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        log.warn("MiniMax /speak command failed", {
          surface,
          senderId: input.senderId,
          error: message,
        })
        return { text: `Unable to generate speech: ${message}` }
      }
    }

    default:
      return null
  }
}

function createStreamingPromptResult(input: {
  sessionId: string
  message: SurfaceMessage
  senderId: string
}): AsyncIterable<StreamChunk> {
  const channel = createStreamChannel()

  void (async () => {
    let activeAssistantMessageId: string | undefined
    let streamedText = ""
    const startAt = Date.now()

    const unsubscribeMessage = Bus.subscribe(MessageV2.Event.Updated, (event) => {
      const info = event.properties.info
      if (info.role !== "assistant") return
      if (info.sessionID !== input.sessionId) return
      if (info.time.created + 1_000 < startAt) return
      activeAssistantMessageId = info.id
    })

    const unsubscribePart = Bus.subscribe(MessageV2.Event.PartUpdated, (event) => {
      const part = event.properties.part
      if (part.sessionID !== input.sessionId) return
      if (activeAssistantMessageId && part.messageID !== activeAssistantMessageId) return
      if (!activeAssistantMessageId) activeAssistantMessageId = part.messageID
      if (part.type !== "text") return

      const full = sanitizeAssistantText(part.text)
      if (!full) return

      let delta = ""
      if (full.startsWith(streamedText)) {
        delta = full.slice(streamedText.length)
      } else if (!streamedText && full) {
        delta = full
      }

      if (!delta) return
      streamedText += delta
      channel.push({ type: "text", text: delta })
    })

    try {
      const parts = await buildPromptParts(input.message)
      const result = await SessionPrompt.prompt({
        sessionID: input.sessionId,
        agent: "zee",
        parts,
        options: { senderId: input.senderId },
      })

      const finalText = await resolveAssistantText(input.sessionId, result)
      if (finalText) {
        let remainder = finalText
        if (streamedText && finalText.startsWith(streamedText)) {
          remainder = finalText.slice(streamedText.length)
        } else if (streamedText) {
          remainder = ""
        }

        if (remainder) {
          channel.push({ type: "text", text: remainder })
        }
        channel.push({ type: "text", isFinal: true })
      } else if (streamedText) {
        channel.push({ type: "text", isFinal: true })
      } else {
        channel.push({ type: "text", text: "No text response returned.", isFinal: true })
      }
    } catch (error) {
      log.error("Error handling streaming surface message", {
        sessionId: input.sessionId,
        error: normalizeTechnicalErrorMessage(error),
      })
      channel.push({
        type: "text",
        text: formatDetailedSurfaceError(error),
        isFinal: true,
      })
    } finally {
      unsubscribeMessage()
      unsubscribePart()
      channel.close()
    }
  })()

  return channel.iterable
}

export async function initSurfaces(): Promise<void> {
  if (initialized) {
    log.debug("Surfaces already initialized")
    return
  }

  log.info("Initializing surface layer")

  const config = await loadSurfaceConfig()

  router = getSurfaceRouter({
    enableAnalytics: config.enableAnalytics ?? true,
    enableHotReload: config.enableHotReload ?? false,
  })

  if (config.enableCLI !== false) {
    await registerCLISurface()
  }

  let messagingEnabled = false
  if (config.enableWhatsApp) {
    messagingEnabled = (await registerWhatsAppSurface(config.whatsApp)) || messagingEnabled
  }

  if (config.enableTelegram) {
    messagingEnabled = (await registerTelegramSurface(config.telegram)) || messagingEnabled
  }

  if (messagingEnabled) {
    router.setMessageHandler(createEngineMessageHandler())
    log.info("Engine message handler registered")
  }

  await router.init()

  initialized = true
  log.info("Surface layer initialized", {
    surfaces: router.getAllSurfaces().map((s) => s.id),
  })
}

/**
 * Shutdown surface layer and disconnect all surfaces.
 */
export async function shutdownSurfaces(): Promise<void> {
  if (!initialized || !router) {
    return
  }

  log.info("Shutting down surface layer")

  await router.shutdown()
  router = null
  initialized = false

  log.info("Surface layer shutdown complete")
}

/**
 * Get the initialized surface router.
 */
export function getRouter(): SurfaceRouter | null {
  return router
}

async function registerCLISurface(): Promise<void> {
  if (!router) return

  log.info("Registering CLI surface")

  const cliSurface = createCLISurface({
    streamOutput: true,
  })

  await router.registerSurface(cliSurface)
}

async function registerWhatsAppSurface(waConfig?: SurfaceBootstrapConfig["whatsApp"]): Promise<boolean> {
  if (!router) return false

  log.info("Registering WhatsApp messaging surface")

  const handler = new WhatsAppPlatformHandler({
    sendFn: async (target, text) => {
      const result = await sendWhatsAppMessage({ to: target, message: text })
      if (!result.success) {
        log.warn("WhatsApp send failed", { target, error: result.error })
      }
    },
  })

  const allowedSenders = Array.from(new Set([...(waConfig?.operators ?? []), ...(waConfig?.allowedNumbers ?? [])]))

  const surface = createMessagingSurface(handler, {
    platform: "whatsapp",
    allowedSenders,
    groups: {
      enabled: (waConfig?.allowedGroups?.length ?? 0) > 0,
      requireMention: waConfig?.requireMention ?? true,
      allowedGroups: waConfig?.allowedGroups ?? [],
      mentionPatterns: [],
    },
  })

  await router.registerSurface(surface)
  return true
}

async function registerTelegramSurface(tgConfig?: SurfaceBootstrapConfig["telegram"]): Promise<boolean> {
  if (!router) return false

  const token = await resolveTelegramBotToken(tgConfig?.token)
  if (!token) {
    log.warn("Telegram surface enabled but no bot token is configured (config/env/auth)")
    return false
  }

  log.info("Registering Telegram messaging surface")

  const handler = new TelegramPlatformHandler({
    token,
    apiBaseUrl: tgConfig?.apiBaseUrl,
    pollTimeoutSec: tgConfig?.pollTimeoutSec,
    allowedChatIds: tgConfig?.allowedChatIds,
    mediaMaxMb: tgConfig?.mediaMaxMb,
  })

  const allowedSenders = Array.from(new Set([...(tgConfig?.operators ?? []), ...(tgConfig?.allowedSenders ?? [])]))

  const surface = createMessagingSurface(handler, {
    platform: "telegram",
    streamEditIntervalMs: tgConfig?.streamEditIntervalMs,
    allowedSenders,
    groups: {
      enabled: true,
      requireMention: tgConfig?.requireMention ?? true,
      allowedGroups: tgConfig?.allowedGroups ?? [],
      mentionPatterns: [],
    },
  })

  try {
    const imported = await importLegacyTelegramBridgeSessions()
    if (imported.reason === "already_imported") {
      log.debug("Legacy telegram bridge session mapping import already completed", {
        source: imported.source,
      })
    } else if (imported.reason === "missing_state_file") {
      log.debug("Legacy telegram bridge state file not found; skipping import", {
        source: imported.source,
      })
    } else if (imported.reason === "invalid_state") {
      log.warn("Legacy telegram bridge state file is invalid JSON; skipping import", {
        source: imported.source,
      })
    } else {
      log.info("Legacy telegram bridge session mapping import complete", {
        source: imported.source,
        imported: imported.imported,
        skipped: imported.skipped,
      })
    }
  } catch (error) {
    log.warn("Legacy telegram bridge session mapping import failed", {
      error: normalizeTechnicalErrorMessage(error),
    })
  }

  await router.registerSurface(surface)
  return true
}

function createEngineMessageHandler(): MessageHandler {
  return async (message, context) => {
    const surface = resolveMessagingSurface(context.surfaceId)
    try {
      const command = parseSlashCommand(message.body)
      if (command && BOT_COMMANDS.has(command.name)) {
        const commandResponse = await handleBotCommand({
          surface,
          command,
          senderId: context.senderId,
          isGroup: context.isGroup,
          threadId: context.threadId,
        })
        if (commandResponse) {
          return commandResponse
        }
      }

      const sessionId = await resolveSessionId({
        surface,
        senderId: context.senderId,
        isGroup: context.isGroup,
        threadId: context.threadId,
      })

      log.info("Routing surface message to engine", {
        surface: context.surfaceId,
        senderId: context.senderId,
        sessionId,
      })

      if (surface === "telegram" && context.capabilities.streaming) {
        return createStreamingPromptResult({
          sessionId,
          message,
          senderId: context.senderId,
        })
      }

      const parts = await buildPromptParts(message)
      const result = await SessionPrompt.prompt({
        sessionID: sessionId,
        agent: "zee",
        parts,
        options: { senderId: context.senderId },
      })

      const text = await resolveAssistantText(sessionId, result)
      return { text: text || "No text response returned." }
    } catch (error) {
      log.error("Error handling messaging surface message", {
        surface: context.surfaceId,
        senderId: context.senderId,
        messageID: context.messageId,
        error: normalizeTechnicalErrorMessage(error),
      })
      if (surface === "telegram") {
        return { text: formatDetailedSurfaceError(error) }
      }
      throw error
    }
  }
}

async function loadSurfaceConfig(): Promise<SurfaceBootstrapConfig> {
  try {
    const config = await Config.get()

    const wa = config.experimental?.surfaces?.whatsapp
    const tg = config.experimental?.surfaces?.telegram

    const surfaceConfig: SurfaceBootstrapConfig = {
      enableCLI: config.experimental?.surfaces?.cli?.enabled ?? true,
      enableWhatsApp: wa?.enabled ?? false,
      whatsApp: wa
        ? {
            allowedNumbers: wa.allowedNumbers,
            allowedGroups: wa.allowedGroups,
            requireMention: wa.requireMention,
            operators: wa.operators,
            releasePin: wa.releasePin,
            releaseTimeoutMs: wa.releaseTimeoutMs,
          }
        : undefined,
      enableTelegram: tg?.enabled ?? false,
      telegram: tg
        ? {
            token: tg.token,
            apiBaseUrl: tg.apiBaseUrl,
            pollTimeoutSec: tg.pollTimeoutSec,
            allowedChatIds: tg.allowedChatIds,
            allowedSenders: tg.allowedSenders,
            allowedGroups: tg.allowedGroups,
            requireMention: tg.requireMention,
            operators: tg.operators,
            mediaMaxMb: tg.mediaMaxMb,
            streamEditIntervalMs: tg.streamEditIntervalMs,
            releasePin: tg.releasePin,
            releaseTimeoutMs: tg.releaseTimeoutMs,
          }
        : undefined,
      enableAnalytics: config.experimental?.surfaces?.analytics?.enabled ?? true,
      enableHotReload: config.experimental?.surfaces?.hotReload?.enabled ?? false,
    }

    return surfaceConfig
  } catch (error) {
    log.warn("Could not load surface config, using defaults", {
      error: error instanceof Error ? error.message : String(error),
    })

    return {
      enableCLI: true,
      enableAnalytics: true,
      enableHotReload: false,
    }
  }
}

// =============================================================================
// Dynamic Surface Management
// =============================================================================

/**
 * Register an additional surface at runtime.
 */
export async function registerSurface(surface: Surface): Promise<void> {
  if (!router) {
    throw new Error("Surface router not initialized")
  }

  await router.registerSurface(surface)
}

/**
 * Unregister a surface at runtime.
 */
export async function unregisterSurface(surfaceId: string): Promise<void> {
  if (!router) {
    throw new Error("Surface router not initialized")
  }

  await router.unregisterSurface(surfaceId)
}

/**
 * Get analytics for all surfaces or a specific surface.
 */
export function getSurfaceAnalytics(surfaceId?: string) {
  if (!router) {
    return []
  }

  return router.getAnalytics(surfaceId)
}

/**
 * Get current session statistics.
 */
export function getSurfaceSessionStats() {
  if (!router) {
    return {
      totalSessions: 0,
      totalMessages: 0,
      activeSurfaces: 0,
    }
  }

  return router.getSessionStats()
}
