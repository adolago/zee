/**
 * Telegram Platform Handler
 *
 * Native Telegram Bot API integration for the messaging surface.
 * Uses long polling and supports text/media send, typing indicators,
 * inbound media download, and live message edits for stream previews.
 */

import { EventEmitter } from "node:events"
import path from "node:path"
import { basename } from "node:path"
import { randomUUID } from "node:crypto"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import type { MessagingPlatformHandler, PlatformMessage } from "../messaging.js"
import type { SurfaceMedia } from "../types.js"
import { Global } from "../../global"
import { Log } from "../../util/log"

const log = Log.create({ service: "platform:telegram" })

const DEFAULT_API_BASE_URL = "https://api.telegram.org"
const DEFAULT_POLL_TIMEOUT_SEC = 30
const DEFAULT_MEDIA_MAX_MB = 20
const DEFAULT_CHAT_ACTION = "typing"

type TelegramPlatformState = {
  offset: number
}

export type TelegramPlatformConfig = {
  token: string
  apiBaseUrl?: string
  pollTimeoutSec?: number
  allowedChatIds?: Array<number | string>
  mediaMaxMb?: number
  mediaDir?: string
  stateFile?: string
}

type TelegramTarget = {
  chatId: number
  messageThreadId?: number
}

type TelegramGetUpdatesMessage = {
  message_id?: number
  message_thread_id?: number
  date?: number
  text?: string
  caption?: string
  entities?: Array<{ type?: string; offset?: number; length?: number }>
  caption_entities?: Array<{ type?: string; offset?: number; length?: number }>
  from?: {
    id?: number
    first_name?: string
    last_name?: string
    username?: string
  }
  chat?: {
    id?: number
    type?: string
    title?: string
    first_name?: string
    last_name?: string
    username?: string
  }
  reply_to_message?: {
    message_id?: number
  }
  photo?: Array<{
    file_id?: string
    file_size?: number
  }>
  document?: {
    file_id?: string
    file_name?: string
    mime_type?: string
    file_size?: number
  }
  voice?: {
    file_id?: string
    file_size?: number
    mime_type?: string
  }
  audio?: {
    file_id?: string
    file_name?: string
    title?: string
    mime_type?: string
    file_size?: number
  }
  video?: {
    file_id?: string
    file_name?: string
    mime_type?: string
    file_size?: number
  }
}

type TelegramUpdate = {
  update_id?: number
  message?: TelegramGetUpdatesMessage
}

type TelegramGetFileResponse = {
  file_id?: string
  file_unique_id?: string
  file_size?: number
  file_path?: string
}

type TelegramStreamHandle = string

function inferMimeTypeFromFilename(filename?: string): string | undefined {
  if (!filename) return undefined
  const ext = path.extname(filename).toLowerCase()
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
    default:
      return undefined
  }
}

function sanitizeFilename(input: string): string {
  return input.replace(/[^a-zA-Z0-9._-]+/g, "_")
}

function parseTelegramTarget(targetRaw: string): TelegramTarget {
  const target = targetRaw.trim()
  const topicMatch = /^(-?\d+):topic:(\d+)$/.exec(target)
  if (topicMatch) {
    return {
      chatId: Number(topicMatch[1]),
      messageThreadId: Number(topicMatch[2]),
    }
  }

  const chatId = Number(target)
  if (!Number.isFinite(chatId)) {
    throw new Error(`Invalid Telegram target: ${targetRaw}`)
  }
  return { chatId }
}

function parseReplyToMessageId(replyToId?: string): number | undefined {
  if (!replyToId) return undefined
  const parsed = Number(replyToId.trim())
  return Number.isFinite(parsed) ? parsed : undefined
}

function isVoiceLikeMedia(media: SurfaceMedia): boolean {
  const mime = media.mimeType?.toLowerCase() ?? ""
  if (mime.startsWith("audio/") && mime.includes("ogg")) return true
  const ext = path.extname(media.filename ?? media.path).toLowerCase()
  return ext === ".ogg" || ext === ".oga" || ext === ".opus"
}

function mediaMethod(media: SurfaceMedia): { method: string; field: string } {
  const mime = media.mimeType?.toLowerCase() ?? ""
  const ext = path.extname(media.filename ?? media.path).toLowerCase()

  if (mime.startsWith("image/") || [".jpg", ".jpeg", ".png", ".webp", ".gif"].includes(ext)) {
    return { method: "sendPhoto", field: "photo" }
  }
  if (mime.startsWith("video/") || [".mp4", ".mov", ".mkv"].includes(ext)) {
    return { method: "sendVideo", field: "video" }
  }
  if (isVoiceLikeMedia(media)) {
    return { method: "sendVoice", field: "voice" }
  }
  if (mime.startsWith("audio/") || [".mp3", ".wav", ".m4a"].includes(ext)) {
    return { method: "sendAudio", field: "audio" }
  }
  return { method: "sendDocument", field: "document" }
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

export class TelegramPlatformHandler implements MessagingPlatformHandler {
  readonly platform = "telegram" as const

  private readonly token: string
  private readonly apiBaseUrl: string
  private readonly pollTimeoutSec: number
  private readonly allowedChatIds: Set<number> | null
  private readonly mediaMaxBytes: number
  private readonly mediaDir: string
  private readonly stateFile: string

  private readonly inboundBus = new EventEmitter()
  private abortController: AbortController | null = null
  private pollTask: Promise<void> | null = null
  private state: TelegramPlatformState = { offset: 0 }
  private botUsername: string | null = null

  constructor(config: TelegramPlatformConfig) {
    const token = config.token.trim()
    if (!token) {
      throw new Error("Telegram bot token is required")
    }

    const allowed = (config.allowedChatIds ?? [])
      .map((x) => Number(String(x).trim()))
      .filter((x) => Number.isFinite(x))
    this.allowedChatIds = allowed.length > 0 ? new Set(allowed) : null

    this.token = token
    this.apiBaseUrl = (config.apiBaseUrl?.trim() || DEFAULT_API_BASE_URL).replace(/\/+$/, "")
    this.pollTimeoutSec = Math.max(1, config.pollTimeoutSec ?? DEFAULT_POLL_TIMEOUT_SEC)
    this.mediaMaxBytes = Math.max(1, Math.floor((config.mediaMaxMb ?? DEFAULT_MEDIA_MAX_MB) * 1024 * 1024))
    this.mediaDir = config.mediaDir ?? path.join(Global.Path.state, "telegram-media")
    this.stateFile = config.stateFile ?? path.join(Global.Path.state, "telegram-platform.json")
  }

  async connect(): Promise<void> {
    if (this.pollTask) return

    await mkdir(this.mediaDir, { recursive: true })
    await this.loadState()

    const me = await this.callJson<{ username?: string }>("getMe", {})
    this.botUsername = me.username?.trim() || null

    this.abortController = new AbortController()
    this.pollTask = this.pollLoop(this.abortController.signal)
    log.info("Telegram platform connected", {
      bot: this.botUsername,
      pollTimeoutSec: this.pollTimeoutSec,
      allowedChatIds: this.allowedChatIds ? this.allowedChatIds.size : "*",
    })
  }

  async disconnect(): Promise<void> {
    this.abortController?.abort()
    await this.pollTask?.catch(() => {})
    this.pollTask = null
    this.abortController = null
    await this.saveState()
    log.info("Telegram platform disconnected")
  }

  private async sendWithMarkdown<T = Record<string, unknown>>(
    method: string,
    payload: Record<string, unknown>,
  ): Promise<T> {
    try {
      return await this.callJson<T>(method, { ...payload, parse_mode: "Markdown" })
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      if (msg.includes("can't parse entities")) {
        log.debug("Markdown parse failed, retrying without parse_mode", { method })
        return await this.callJson<T>(method, payload)
      }
      throw error
    }
  }

  async sendMessage(
    targetRaw: string,
    text: string,
    options?: {
      replyToId?: string
      media?: SurfaceMedia[]
    },
  ): Promise<void> {
    const target = parseTelegramTarget(targetRaw)
    const replyToMessageId = parseReplyToMessageId(options?.replyToId)

    const media = options?.media ?? []
    if (media.length > 0) {
      for (let i = 0; i < media.length; i++) {
        const caption = i === 0 ? text : ""
        await this.sendMedia(target, media[i], caption, replyToMessageId)
      }
      return
    }

    if (!text.trim()) return

    await this.sendWithMarkdown("sendMessage", {
      chat_id: target.chatId,
      text,
      ...(target.messageThreadId ? { message_thread_id: target.messageThreadId } : {}),
      ...(replyToMessageId ? { reply_to_message_id: replyToMessageId } : {}),
      allow_sending_without_reply: true,
      disable_web_page_preview: false,
    })
  }

  async sendTyping(targetRaw: string): Promise<void> {
    const target = parseTelegramTarget(targetRaw)
    await this.callJson("sendChatAction", {
      chat_id: target.chatId,
      action: DEFAULT_CHAT_ACTION,
      ...(target.messageThreadId ? { message_thread_id: target.messageThreadId } : {}),
    }).catch((err) => {
      log.debug("Telegram typing indicator failed", {
        error: err instanceof Error ? err.message : String(err),
      })
    })
  }

  async startStreamingMessage(targetRaw: string, text: string): Promise<TelegramStreamHandle> {
    const target = parseTelegramTarget(targetRaw)
    const response = await this.sendWithMarkdown<{ message_id?: number }>("sendMessage", {
      chat_id: target.chatId,
      text: text.trim() || "...",
      ...(target.messageThreadId ? { message_thread_id: target.messageThreadId } : {}),
      allow_sending_without_reply: true,
      disable_web_page_preview: false,
    })

    const messageID = response.message_id
    if (!Number.isFinite(messageID)) {
      throw new Error("Telegram did not return message_id for streaming message")
    }

    return String(messageID)
  }

  async updateStreamingMessage(targetRaw: string, handle: TelegramStreamHandle, text: string): Promise<void> {
    const target = parseTelegramTarget(targetRaw)
    const messageID = Number(handle)
    if (!Number.isFinite(messageID)) return

    try {
      await this.sendWithMarkdown("editMessageText", {
        chat_id: target.chatId,
        message_id: messageID,
        text: text.trim() || "...",
        ...(target.messageThreadId ? { message_thread_id: target.messageThreadId } : {}),
        disable_web_page_preview: false,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      // Telegram throws when text didn't actually change.
      if (message.toLowerCase().includes("message is not modified")) {
        return
      }
      throw error
    }
  }

  async finalizeStreamingMessage(targetRaw: string, handle: TelegramStreamHandle, text: string): Promise<void> {
    await this.updateStreamingMessage(targetRaw, handle, text)
  }

  onMessage(handler: (message: PlatformMessage) => void): () => void {
    const listener = (message: PlatformMessage) => handler(message)
    this.inboundBus.on("message", listener)
    return () => {
      this.inboundBus.off("message", listener)
    }
  }

  private async pollLoop(signal: AbortSignal): Promise<void> {
    let consecutiveErrors = 0

    while (!signal.aborted) {
      try {
        const updates = await this.callJson<TelegramUpdate[]>(
          "getUpdates",
          {
            offset: this.state.offset,
            timeout: this.pollTimeoutSec,
            allowed_updates: ["message"],
          },
          {
            signal,
            timeoutMs: (this.pollTimeoutSec + 15) * 1000,
          },
        )

        if (!Array.isArray(updates)) {
          throw new Error("Telegram getUpdates returned non-array payload")
        }

        for (const update of updates) {
          if (signal.aborted) return
          const updateID = update.update_id
          if (Number.isFinite(updateID)) {
            this.state.offset = Math.max(this.state.offset, (updateID as number) + 1)
          }
          await this.handleUpdate(update)
        }

        if (updates.length > 0) {
          await this.saveState()
        }

        consecutiveErrors = 0
      } catch (error) {
        if (signal.aborted) return
        consecutiveErrors += 1
        log.warn("Telegram polling error", {
          consecutiveErrors,
          error: error instanceof Error ? error.message : String(error),
        })
        await sleep(Math.min(30_000, 500 * consecutiveErrors))
      }
    }
  }

  private async handleUpdate(update: TelegramUpdate): Promise<void> {
    const message = update.message
    if (!message || typeof message !== "object") return

    const chatId = message.chat?.id
    if (!Number.isFinite(chatId)) return

    if (this.allowedChatIds && !this.allowedChatIds.has(chatId as number)) {
      return
    }

    const media = await this.extractMedia(message).catch((error) => {
      log.warn("Failed to extract Telegram media", {
        error: error instanceof Error ? error.message : String(error),
      })
      return [] as SurfaceMedia[]
    })

    const text = (typeof message.text === "string" ? message.text : typeof message.caption === "string" ? message.caption : "")
      .trim()
    const body = text || (media.length > 0 ? "[media]" : "")
    if (!body && media.length === 0) return

    const senderId = String(message.from?.id ?? chatId)
    const senderName = [message.from?.first_name, message.from?.last_name].filter(Boolean).join(" ") ||
      (message.from?.username ? `@${message.from.username}` : undefined)

    const chatType = message.chat?.type ?? "private"
    const isGroup = chatType === "group" || chatType === "supergroup" || chatType === "channel"
    const messageThreadId = Number.isFinite(message.message_thread_id) ? (message.message_thread_id as number) : undefined
    const groupId = isGroup
      ? messageThreadId
        ? `${chatId}:topic:${messageThreadId}`
        : String(chatId)
      : undefined

    const textForMention = text || ""
    const wasMentioned = !isGroup
      ? true
      : this.botUsername
        ? textForMention.toLowerCase().includes(`@${this.botUsername.toLowerCase()}`)
          || this.entitiesMentionBot(textForMention, message.entities)
          || this.entitiesMentionBot(textForMention, message.caption_entities)
        : false

    const platformMessage: PlatformMessage = {
      id: String(message.message_id ?? randomUUID()),
      senderId,
      senderName,
      body,
      timestamp: Number(message.date) * 1000 || Date.now(),
      media: media.length > 0 ? media : undefined,
      isGroup,
      groupId,
      groupName: isGroup ? message.chat?.title : undefined,
      replyToId: Number.isFinite(message.reply_to_message?.message_id)
        ? String(message.reply_to_message?.message_id)
        : undefined,
      wasMentioned,
      platform: "telegram",
    }

    this.inboundBus.emit("message", platformMessage)
  }

  private entitiesMentionBot(
    text: string,
    entities?: Array<{ type?: string; offset?: number; length?: number }>,
  ): boolean {
    if (!this.botUsername || !entities || entities.length === 0) return false
    const username = this.botUsername.toLowerCase()
    for (const entity of entities) {
      if (entity.type !== "mention") continue
      const offset = entity.offset ?? 0
      const length = entity.length ?? 0
      if (length <= 0) continue
      const mention = text.slice(offset, offset + length).trim().toLowerCase()
      if (mention === `@${username}`) return true
    }
    return false
  }

  private async extractMedia(message: TelegramGetUpdatesMessage): Promise<SurfaceMedia[]> {
    const media: SurfaceMedia[] = []

    const photos = Array.isArray(message.photo) ? message.photo : []
    const largestPhoto = photos.length > 0 ? photos[photos.length - 1] : undefined
    if (largestPhoto?.file_id) {
      const downloaded = await this.downloadTelegramFile({
        fileId: largestPhoto.file_id,
        filenameHint: `photo_${message.message_id ?? Date.now()}.jpg`,
        mimeTypeHint: "image/jpeg",
        reportedSize: largestPhoto.file_size,
      })
      if (downloaded) media.push(downloaded)
    }

    if (message.document?.file_id) {
      const downloaded = await this.downloadTelegramFile({
        fileId: message.document.file_id,
        filenameHint: message.document.file_name ?? `document_${message.message_id ?? Date.now()}`,
        mimeTypeHint: message.document.mime_type,
        reportedSize: message.document.file_size,
      })
      if (downloaded) media.push(downloaded)
    }

    if (message.voice?.file_id) {
      const downloaded = await this.downloadTelegramFile({
        fileId: message.voice.file_id,
        filenameHint: `voice_${message.message_id ?? Date.now()}.ogg`,
        mimeTypeHint: message.voice.mime_type ?? "audio/ogg",
        reportedSize: message.voice.file_size,
      })
      if (downloaded) media.push(downloaded)
    }

    if (message.audio?.file_id) {
      const downloaded = await this.downloadTelegramFile({
        fileId: message.audio.file_id,
        filenameHint: message.audio.file_name ?? message.audio.title ?? `audio_${message.message_id ?? Date.now()}.mp3`,
        mimeTypeHint: message.audio.mime_type,
        reportedSize: message.audio.file_size,
      })
      if (downloaded) media.push(downloaded)
    }

    if (message.video?.file_id) {
      const downloaded = await this.downloadTelegramFile({
        fileId: message.video.file_id,
        filenameHint: message.video.file_name ?? `video_${message.message_id ?? Date.now()}.mp4`,
        mimeTypeHint: message.video.mime_type,
        reportedSize: message.video.file_size,
      })
      if (downloaded) media.push(downloaded)
    }

    return media
  }

  private async downloadTelegramFile(params: {
    fileId: string
    filenameHint: string
    mimeTypeHint?: string
    reportedSize?: number
  }): Promise<SurfaceMedia | null> {
    const { fileId, filenameHint, mimeTypeHint, reportedSize } = params

    if (reportedSize && reportedSize > this.mediaMaxBytes) {
      log.warn("Skipping Telegram media above size limit", {
        fileId,
        reportedSize,
        mediaMaxBytes: this.mediaMaxBytes,
      })
      return null
    }

    const fileInfo = await this.callJson<TelegramGetFileResponse>("getFile", { file_id: fileId })
    const filePath = fileInfo.file_path
    if (!filePath) return null

    const contentURL = `${this.apiBaseUrl}/file/bot${this.token}/${filePath}`
    const response = await fetch(contentURL)
    if (!response.ok) {
      throw new Error(`Telegram file download failed (${response.status})`)
    }

    const arrayBuffer = await response.arrayBuffer()
    const size = arrayBuffer.byteLength
    if (size > this.mediaMaxBytes) {
      log.warn("Skipping downloaded Telegram media above size limit", {
        fileId,
        size,
        mediaMaxBytes: this.mediaMaxBytes,
      })
      return null
    }

    const sourceFilename = basename(filePath)
    const ext = path.extname(sourceFilename) || path.extname(filenameHint)
    const filename = sanitizeFilename(
      `${path.basename(filenameHint, path.extname(filenameHint)) || "media"}_${randomUUID()}${ext || ""}`,
    )
    const outputPath = path.join(this.mediaDir, filename)

    await writeFile(outputPath, Buffer.from(arrayBuffer))

    return {
      path: outputPath,
      filename,
      mimeType: mimeTypeHint || inferMimeTypeFromFilename(sourceFilename),
      size,
    }
  }

  private async sendMedia(
    target: TelegramTarget,
    media: SurfaceMedia,
    caption: string,
    replyToMessageId?: number,
  ): Promise<void> {
    const { method, field } = mediaMethod(media)

    const basePayload = {
      chat_id: String(target.chatId),
      ...(target.messageThreadId ? { message_thread_id: String(target.messageThreadId) } : {}),
      ...(replyToMessageId ? { reply_to_message_id: String(replyToMessageId) } : {}),
      ...(caption ? { caption } : {}),
      allow_sending_without_reply: "true",
    } satisfies Record<string, string>

    if (/^https?:\/\//.test(media.path)) {
      await this.callJson(method, {
        ...basePayload,
        [field]: media.path,
      })
      return
    }

    const file = Bun.file(media.path)
    if (!(await file.exists())) {
      throw new Error(`Media file not found: ${media.path}`)
    }

    const bytes = await file.arrayBuffer()
    const filename = media.filename || sanitizeFilename(basename(media.path))
    const form = new FormData()
    for (const [key, value] of Object.entries(basePayload)) {
      form.append(key, value)
    }
    form.append(field, new Blob([bytes], { type: media.mimeType || "application/octet-stream" }), filename)

    await this.callForm(method, form)
  }

  private async callJson<T>(
    method: string,
    payload: Record<string, unknown>,
    options?: { signal?: AbortSignal; timeoutMs?: number },
  ): Promise<T> {
    const url = `${this.apiBaseUrl}/bot${this.token}/${method}`
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), options?.timeoutMs ?? 30_000)
    const signal = options?.signal
      ? AbortSignal.any([controller.signal, options.signal])
      : controller.signal

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(payload),
        signal,
      })

      const data = (await response.json().catch(() => ({}))) as {
        ok?: boolean
        description?: string
        result?: T
      }

      if (!response.ok || !data.ok) {
        const description = data.description || `HTTP ${response.status}`
        throw new Error(`Telegram API ${method} failed: ${description}`)
      }

      return (data.result ?? ({} as T)) as T
    } finally {
      clearTimeout(timeout)
    }
  }

  private async callForm<T>(method: string, form: FormData): Promise<T> {
    const url = `${this.apiBaseUrl}/bot${this.token}/${method}`
    const response = await fetch(url, {
      method: "POST",
      body: form,
    })

    const data = (await response.json().catch(() => ({}))) as {
      ok?: boolean
      description?: string
      result?: T
    }

    if (!response.ok || !data.ok) {
      const description = data.description || `HTTP ${response.status}`
      throw new Error(`Telegram API ${method} failed: ${description}`)
    }

    return (data.result ?? ({} as T)) as T
  }

  private async loadState(): Promise<void> {
    try {
      const content = await readFile(this.stateFile, "utf-8")
      const parsed = JSON.parse(content) as TelegramPlatformState
      if (typeof parsed.offset === "number" && Number.isFinite(parsed.offset) && parsed.offset >= 0) {
        this.state = { offset: parsed.offset }
      }
    } catch {
      this.state = { offset: 0 }
    }
  }

  private async saveState(): Promise<void> {
    await mkdir(path.dirname(this.stateFile), { recursive: true })
    await writeFile(this.stateFile, JSON.stringify(this.state, null, 2) + "\n", "utf-8")
  }
}
