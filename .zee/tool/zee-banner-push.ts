/**
 * Zee Banner Push Tool
 *
 * Pushes a non-dismissible message into the always-on Zee banner shown in the agent-core TUI.
 */

import { tool } from "@zee/plugin"

import {
  DEFAULT_MESSAGE_TTL_MINUTES,
  DEFAULT_ROTATION_MS,
  MAX_MESSAGE_ITEMS,
  MAX_TOTAL_ITEMS,
  isExpired,
  loadKV,
  parseExistingBanner,
  sanitizeOneLine,
  saveKV,
  uid,
  uniq,
  type ZeeBannerItem,
  type ZeeBannerV1,
} from "./lib/zee-banner"

export default tool({
  description: `Push a message into the Zee banner shown at the top of the agent-core TUI prompt.

Messages are not dismissible in the UI; they expire automatically after ttlMinutes (default: 24h).`,
  args: {
    message: tool.schema.string().min(1).describe("Message to show in the banner"),
    priority: tool.schema
      .enum(["low", "normal", "high", "urgent"])
      .default("normal")
      .describe("Message priority"),
    ttlMinutes: tool.schema
      .number()
      .int()
      .min(1)
      .max(60 * 24 * 14)
      .default(DEFAULT_MESSAGE_TTL_MINUTES)
      .describe("How long the message stays in the banner (minutes)"),
  },
  async execute(args) {
    const { message, priority, ttlMinutes } = args
    const nowMs = Date.now()

    const kv = await loadKV()
    const existing = parseExistingBanner(kv.zee_banner, nowMs)
    const existingItems = existing.items.filter((i) => !isExpired(i, nowMs))
    const nonMessages = existingItems.filter((i) => i.kind !== "message")
    const messages = existingItems
      .filter((i) => i.kind === "message")
      .slice(0, MAX_MESSAGE_ITEMS)

    const item: ZeeBannerItem = {
      id: uid("msg"),
      kind: "message",
      priority,
      createdAt: nowMs,
      expiresAt: nowMs + ttlMinutes * 60 * 1000,
      text: sanitizeOneLine(message),
    }

    const nextMessages = [item, ...messages].slice(0, MAX_MESSAGE_ITEMS)
    const rotationMs =
      existing.rotationMs && Number.isFinite(existing.rotationMs) && existing.rotationMs > 0
        ? existing.rotationMs
        : DEFAULT_ROTATION_MS

    const banner: ZeeBannerV1 = {
      version: 1,
      generatedAt: nowMs,
      rotationMs,
      items: uniq([...nonMessages, ...nextMessages]).slice(0, MAX_TOTAL_ITEMS),
    }

    kv.zee_banner = banner
    await saveKV(kv)

    const preview = item.text.length > 120 ? `${item.text.slice(0, 120)}...` : item.text
    return [
      `Banner message added`,
      `Priority: ${priority}`,
      `TTL: ${ttlMinutes} minute(s)`,
      `Preview: ${preview}`,
      `Saved: kv.zee_banner`,
    ].join("\n")
  },
})

