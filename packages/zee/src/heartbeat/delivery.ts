// Heartbeat result delivery to TUI and messaging platforms.

import { Log } from "../util/log"
import { GlobalBus } from "../bus/global"

const log = Log.create({ service: "heartbeat:delivery" })

/** Event type emitted on GlobalBus for heartbeat delivery. */
export const HEARTBEAT_DELIVERY_EVENT = "heartbeat.delivery" as const

export type DeliveryTarget = {
  /** Base URL for the zee server. */
  serverUrl: string
  /** Persona that ran the heartbeat. */
  persona?: string
  /** Messaging channel to deliver to. */
  channel?: string
  /** Recipient address for messaging. */
  to?: string
}

/**
 * Deliver heartbeat output to both TUI (via Bus event) and messaging (via gateway HTTP).
 */
export async function deliverHeartbeatResult(text: string, target: DeliveryTarget): Promise<void> {
  // Emit on GlobalBus for TUI display (no Instance context required)
  GlobalBus.emit("event", {
    payload: {
      type: HEARTBEAT_DELIVERY_EVENT,
      properties: { text, persona: target.persona, channel: target.channel },
    },
  })

  // Deliver to messaging via gateway if channel is specified
  if (target.channel && target.serverUrl) {
    try {
      await deliverToGateway(text, target)
    } catch (err) {
      log.error("failed to deliver heartbeat to messaging", {
        channel: target.channel,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }
}

async function deliverToGateway(text: string, target: DeliveryTarget): Promise<void> {
  const res = await fetch(`${target.serverUrl}/gateway/send`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      text,
      channel: target.channel,
      to: target.to,
      persona: target.persona,
    }),
  })

  if (!res.ok) {
    const body = await res.text().catch(() => "")
    log.warn("gateway send returned non-ok", {
      status: res.status,
      body: body.slice(0, 200),
    })
  }
}
