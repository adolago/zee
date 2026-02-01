// Heartbeat result delivery to TUI and messaging platforms.

import { Log } from "../util/log"
import { Bus } from "../bus"
import { z } from "zod"

const log = Log.create({ service: "heartbeat:delivery" })

// Bus event for heartbeat delivery (TUI subscribes to this)
export const HeartbeatDelivery = Bus.Event.define("heartbeat.delivery", {
  text: z.string(),
  persona: z.string().optional(),
  channel: z.string().optional(),
  suppressMessaging: z.boolean().optional(),
})

export type DeliveryTarget = {
  /** Base URL for the agent-core server. */
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
export async function deliverHeartbeatResult(
  text: string,
  target: DeliveryTarget,
): Promise<void> {
  // Always emit Bus event for TUI display
  try {
    await Bus.publish(HeartbeatDelivery, {
      text,
      persona: target.persona,
      channel: target.channel,
    })
  } catch (err) {
    log.error("failed to publish heartbeat delivery event", {
      error: err instanceof Error ? err.message : String(err),
    })
  }

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
