// Heartbeat result delivery to TUI and messaging platforms.

import { Log } from "../util/log"
import { GlobalBus } from "../bus/global"
import { getRouter } from "../bootstrap/surface"

const log = Log.create({ service: "heartbeat:delivery" })
const TELEGRAM_MAX_TEXT = 4096

/** Event type emitted on GlobalBus for heartbeat delivery. */
export const HEARTBEAT_DELIVERY_EVENT = "heartbeat.delivery" as const

export type DeliveryTarget = {
  /** Base URL for the zee server. */
  serverUrl: string
  /** Agent that ran the heartbeat. */
  agent?: string
  /** Messaging channel to deliver to. */
  channel?: string
  /** Recipient address for messaging. */
  to?: string
}

type MessagingChannel = "telegram" | "whatsapp"

function resolveChannel(channel?: string): MessagingChannel | undefined {
  const normalized = channel?.trim().toLowerCase()
  if (normalized === "telegram" || normalized === "whatsapp") {
    return normalized
  }
  return
}

function chunkTelegramText(text: string, maxLen = TELEGRAM_MAX_TEXT): string[] {
  if (text.length <= maxLen) return [text]

  const chunks: string[] = []
  let remaining = text
  while (remaining.length > maxLen) {
    let idx = remaining.lastIndexOf("\n", maxLen)
    if (idx < maxLen / 2) {
      idx = maxLen
    }
    const head = remaining.slice(0, idx).trimEnd()
    chunks.push(head || remaining.slice(0, maxLen))
    remaining = remaining.slice(idx).trimStart()
  }
  if (remaining) chunks.push(remaining)
  return chunks
}

/**
 * Deliver heartbeat output to both TUI (via Bus event) and messaging.
 */
export async function deliverHeartbeatResult(text: string, target: DeliveryTarget): Promise<void> {
  // Emit on GlobalBus for TUI display (no Instance context required)
  GlobalBus.emit("event", {
    payload: {
      type: HEARTBEAT_DELIVERY_EVENT,
      properties: { text, agent: target.agent, channel: target.channel },
    },
  })

  const channel = resolveChannel(target.channel)

  // Deliver to messaging if channel is specified.
  if (channel && target.serverUrl) {
    try {
      const deliveredViaSurface = await deliverViaSurface(text, channel, target)
      if (!deliveredViaSurface) {
        await deliverViaFallback(text, channel, target)
      }
    } catch (err) {
      log.error("failed to deliver heartbeat to messaging", {
        channel,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }
}

async function deliverViaSurface(text: string, channel: MessagingChannel, target: DeliveryTarget): Promise<boolean> {
  const threadId = target.to?.trim()
  if (!threadId) {
    return false
  }

  const router = getRouter()
  if (!router) {
    return false
  }

  const surface = router.getSurface(`messaging:${channel}`)
  if (!surface) {
    return false
  }

  await surface.sendResponse({ text }, threadId)
  return true
}

async function deliverViaFallback(text: string, channel: MessagingChannel, target: DeliveryTarget): Promise<void> {
  if (channel === "telegram") {
    await sendTelegramDirect(text, target)
    return
  }

  await sendWhatsAppViaGateway(text, target)
}

async function sendWhatsAppViaGateway(text: string, target: DeliveryTarget): Promise<void> {
  const to = target.to?.trim()
  if (!to) {
    log.warn("heartbeat delivery target missing whatsapp recipient")
    return
  }

  const res = await fetch(`${target.serverUrl}/gateway/whatsapp/send`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      to: target.to,
      message: text,
    }),
  })

  if (!res.ok) {
    const body = await res.text().catch(() => "")
    log.warn("whatsapp gateway send returned non-ok", {
      status: res.status,
      body: body.slice(0, 200),
    })
  }
}

async function sendTelegramDirect(text: string, target: DeliveryTarget): Promise<void> {
  const chatId = target.to?.trim()
  if (!chatId) {
    log.warn("heartbeat delivery target missing telegram chat id")
    return
  }

  const token = process.env.TELEGRAM_BOT_TOKEN?.trim()
  if (!token) {
    log.warn("telegram fallback delivery skipped: TELEGRAM_BOT_TOKEN is not set")
    return
  }

  for (const chunk of chunkTelegramText(text)) {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: chunk,
        allow_sending_without_reply: true,
      }),
    })

    if (!res.ok) {
      const body = await res.text().catch(() => "")
      log.warn("telegram send returned non-ok", {
        status: res.status,
        body: body.slice(0, 200),
      })
      continue
    }

    const payload = (await res.json().catch(() => null)) as { ok?: boolean; description?: string } | null
    if (payload && payload.ok === false) {
      log.warn("telegram send failed", {
        error: payload.description ?? "unknown telegram api error",
      })
    }
  }
}
