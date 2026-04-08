/**
 * Zee Notification Tool
 *
 * Multi-channel notification delivery for the personal assistant.
 * Supports delivering messages via:
 * - TUI banner (KV store, always available)
 * - WhatsApp (via wacli personal bridge)
 *
 * Ported from OpenClaw notification patterns.
 */

import { z } from "zod";
import path from "node:path";
import fs from "node:fs/promises";
import type { ToolDefinition, ToolExecutionResult } from "../../mcp/types.js";
import { sendWhatsAppMessage } from "./whatsapp-send.js";
import { Global } from "../../../packages/zee/src/global/index.js";

// =============================================================================
// Types
// =============================================================================

type DeliveryStatus = {
  channel: string;
  success: boolean;
  error?: string;
};

// =============================================================================
// KV helpers (shared with banner.ts)
// =============================================================================

async function loadKV(): Promise<Record<string, unknown>> {
  const kvPath = path.join(Global.Path.state, "kv.json");
  try {
    const content = await fs.readFile(kvPath, "utf-8");
    const parsed = JSON.parse(content) as unknown;
    if (parsed && typeof parsed === "object") return parsed as Record<string, unknown>;
  } catch {
    // Ignore missing/invalid file
  }
  return {};
}

async function saveKV(kv: Record<string, unknown>): Promise<void> {
  const kvPath = path.join(Global.Path.state, "kv.json");
  await fs.mkdir(Global.Path.state, { recursive: true });
  await fs.writeFile(kvPath, JSON.stringify(kv, null, 2));
}

function uid(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

// =============================================================================
// Banner delivery
// =============================================================================

async function deliverToBanner(message: string, priority: string, ttlMinutes: number): Promise<DeliveryStatus> {
  try {
    const nowMs = Date.now();
    const kv = await loadKV();
    const existing = kv.zee_banner as Record<string, unknown> | undefined;
    const existingItems = Array.isArray((existing as any)?.items) ? (existing as any).items : [];

    // Keep non-expired items
    const liveItems = existingItems.filter(
      (i: any) => !(typeof i.expiresAt === "number" && i.expiresAt <= nowMs),
    );

    const item = {
      id: uid("notif"),
      kind: "message",
      priority,
      createdAt: nowMs,
      expiresAt: nowMs + ttlMinutes * 60 * 1000,
      text: message.replace(/\s+/g, " ").trim(),
    };

    const nextItems = [item, ...liveItems].slice(0, 24);

    kv.zee_banner = {
      version: 1,
      generatedAt: nowMs,
      rotationMs: (existing as any)?.rotationMs ?? 8000,
      items: nextItems,
    };

    await saveKV(kv);
    return { channel: "banner", success: true };
  } catch (error) {
    return {
      channel: "banner",
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

// =============================================================================
// WhatsApp delivery
// =============================================================================

async function deliverToWhatsApp(to: string, message: string): Promise<DeliveryStatus> {
  try {
    const result = await sendWhatsAppMessage({ to, message });
    if (!result.success) {
      return { channel: "whatsapp", success: false, error: result.error };
    }
    return { channel: "whatsapp", success: true };
  } catch (error) {
    return {
      channel: "whatsapp",
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

// =============================================================================
// Schema
// =============================================================================

const NotifyParams = z.object({
  message: z.string().min(1).describe("Notification message content"),
  title: z.string().optional().describe("Optional title/subject for the notification"),
  priority: z.enum(["low", "normal", "high", "urgent"]).default("normal")
    .describe("Priority level"),
  channels: z.array(z.enum(["banner", "whatsapp"])).default(["banner"])
    .describe("Delivery channels. banner = TUI banner, whatsapp = WhatsApp message"),
  // WhatsApp-specific
  to: z.string().optional()
    .describe("WhatsApp recipient (E.164 phone). Required when channels includes 'whatsapp'. Search contacts first."),
  // Banner-specific
  ttlMinutes: z.number().int().min(1).max(60 * 24 * 14).default(60 * 24)
    .describe("How long the banner notification stays visible (minutes, default: 24h)"),
});

// =============================================================================
// Tool
// =============================================================================

export const notifyTool: ToolDefinition = {
  id: "zee:notify",
  category: "domain",
  init: async () => ({
    description: `Send notifications via one or more channels.

Channels:
- banner: Push to TUI banner (always available, shown in zee prompt)
- whatsapp: Send via WhatsApp (requires 'to' phone number; search contacts first)

Examples:
- Banner only: { message: "Meeting in 15 min", priority: "high" }
- WhatsApp: { message: "Reminder: call dentist", channels: ["whatsapp"], to: "+15551234567" }
- Both: { message: "Important update", channels: ["banner", "whatsapp"], to: "+15551234567" }`,
    parameters: NotifyParams,
    execute: async (args, ctx): Promise<ToolExecutionResult> => {
      const { message, title, priority, channels, to, ttlMinutes } = args;

      ctx.metadata({ title: `Notify: ${channels.join("+")}` });

      const fullMessage = title ? `${title}: ${message}` : message;
      const deliveries: DeliveryStatus[] = [];

      // Deliver to each requested channel
      for (const channel of channels) {
        if (channel === "banner") {
          deliveries.push(await deliverToBanner(fullMessage, priority, ttlMinutes));
        } else if (channel === "whatsapp") {
          if (!to) {
            deliveries.push({
              channel: "whatsapp",
              success: false,
              error: "Missing 'to' phone number for WhatsApp delivery. Search contacts first.",
            });
            continue;
          }
          deliveries.push(await deliverToWhatsApp(to, fullMessage));
        }
      }

      const successCount = deliveries.filter((d) => d.success).length;
      const failCount = deliveries.filter((d) => !d.success).length;

      const statusLines = deliveries.map((d) => {
        const icon = d.success ? "delivered" : "failed";
        return `- ${d.channel}: ${icon}${d.error ? ` (${d.error})` : ""}`;
      });

      const allSuccess = failCount === 0;
      const titleStr = allSuccess
        ? `Notification Sent (${successCount} channel${successCount !== 1 ? "s" : ""})`
        : `Notification Partial (${successCount}/${deliveries.length})`;

      return {
        title: titleStr,
        metadata: {
          priority,
          channels,
          successCount,
          failCount,
          deliveries: deliveries.map((d) => ({ channel: d.channel, success: d.success })),
        },
        output: `${titleStr}\n\nMessage: "${fullMessage.substring(0, 120)}${fullMessage.length > 120 ? "..." : ""}"\nPriority: ${priority}\n\nDelivery status:\n${statusLines.join("\n")}`,
      };
    },
  }),
};

// =============================================================================
// Exports
// =============================================================================

export const NOTIFICATION_TOOLS = [notifyTool];
