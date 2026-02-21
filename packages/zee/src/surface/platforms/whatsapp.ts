/**
 * WhatsApp Platform Handler
 *
 * Implements MessagingPlatformHandler for WhatsApp via wacli.
 * Inbound messages are injected via emitInboundMessage() (called from the
 * gateway HTTP route). Outbound messages use the gateway WS send method.
 */

import { EventEmitter } from "node:events"
import type { MessagingPlatformHandler, PlatformMessage } from "../messaging.js"
import type { SurfaceMedia } from "../types.js"
import { Log } from "../../util/log"

const log = Log.create({ service: "platform:whatsapp" })

// ---------------------------------------------------------------------------
// Inbound Message Bus
// ---------------------------------------------------------------------------

const inboundBus = new EventEmitter()
inboundBus.setMaxListeners(20)

/**
 * Inject an inbound WhatsApp message into the platform handler.
 * Called by the gateway route's `/whatsapp/inbound` endpoint.
 */
export function emitInboundMessage(msg: PlatformMessage): void {
  inboundBus.emit("message", msg)
}

/** Debug helper: check how many listeners are on the inbound bus */
export function getInboundBusListenerCount(): number {
  return inboundBus.listenerCount("message")
}

// ---------------------------------------------------------------------------
// Forwarded message type (from webhook)
// ---------------------------------------------------------------------------

/** Media attachment as forwarded by webhook */
export interface ForwardedMedia {
  mediaId: string
  mimeType?: string
  filename?: string
}

/** Message format from webhook forwarder */
export interface ForwardedMessage {
  id: string
  senderId: string
  senderName?: string
  body: string
  timestamp: number
  media?: ForwardedMedia[]
  isGroup: boolean
  groupId?: string
  groupName?: string
  replyToId?: string
  platform: "whatsapp"
}

/**
 * Normalize actual newline characters to LF while preserving literal `\n`.
 *
 * Windows paths like `C:\Work\nxxx\README.md` contain backslash+n and must not
 * be rewritten into real line breaks.
 */
export function normalizeInboundTextNewlines(input: string): string {
  return input.replaceAll("\r\n", "\n").replaceAll("\r", "\n")
}

/**
 * Convert a forwarded message from webhook into a PlatformMessage.
 */
export function toPlatformMessage(fwd: ForwardedMessage): PlatformMessage {
  const media: SurfaceMedia[] | undefined = fwd.media?.map((m) => ({
    path: `wacli://media/${m.mediaId}`,
    mimeType: m.mimeType,
    filename: m.filename,
  }))

  return {
    id: fwd.id,
    senderId: fwd.senderId,
    senderName: fwd.senderName,
    body: normalizeInboundTextNewlines(fwd.body),
    timestamp: fwd.timestamp,
    media: media?.length ? media : undefined,
    isGroup: fwd.isGroup,
    groupId: fwd.groupId,
    groupName: fwd.groupName,
    replyToId: fwd.replyToId,
    platform: "whatsapp",
  }
}

// ---------------------------------------------------------------------------
// Platform Handler
// ---------------------------------------------------------------------------

export type WhatsAppSendFn = (
  target: string,
  text: string,
  options?: { replyToId?: string; media?: SurfaceMedia[] },
) => Promise<void>

/**
 * WhatsApp platform handler for the MessagingSurface.
 *
 * - Inbound: messages arrive via the HTTP inbound endpoint → emitInboundMessage()
 * - Outbound: messages are sent via the provided sendFn (gateway WS or wacli)
 */
export class WhatsAppPlatformHandler implements MessagingPlatformHandler {
  readonly platform = "whatsapp" as const

  private sendFn: WhatsAppSendFn

  constructor(options?: { sendFn?: WhatsAppSendFn }) {
    this.sendFn = options?.sendFn ?? defaultSendFn
  }

  async connect(): Promise<void> {
    log.info("WhatsApp platform handler connected")
  }

  async disconnect(): Promise<void> {
    log.info("WhatsApp platform handler disconnected")
  }

  async sendMessage(
    target: string,
    text: string,
    options?: { replyToId?: string; media?: SurfaceMedia[] },
  ): Promise<void> {
    await this.sendFn(target, text, options)
  }

  async sendTyping(_target: string): Promise<void> {
    // Cloud API does not support typing indicators
  }

  onMessage(handler: (message: PlatformMessage) => void): () => void {
    const listener = (msg: PlatformMessage) => handler(msg)
    inboundBus.on("message", listener)
    return () => {
      inboundBus.off("message", listener)
    }
  }
}

// ---------------------------------------------------------------------------
// Default send function (no-op, replaced at runtime)
// ---------------------------------------------------------------------------

async function defaultSendFn(
  target: string,
  text: string,
  _options?: { replyToId?: string; media?: SurfaceMedia[] },
): Promise<void> {
  log.warn("WhatsApp send called but no sendFn configured", { target, textLen: text.length })
}
