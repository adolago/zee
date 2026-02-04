import fs from "node:fs/promises"
import path from "node:path"

import { Global } from "../../../packages/agent-core/src/global"

export type BannerItemKind = "reminder" | "todo" | "message"
export type BannerItemPriority = "low" | "normal" | "high" | "urgent"

export interface ZeeBannerItem {
  id: string
  kind: BannerItemKind
  text: string
  priority: BannerItemPriority
  createdAt: number
  expiresAt?: number
}

export interface ZeeBannerV1 {
  version: 1
  generatedAt: number
  rotationMs: number
  items: ZeeBannerItem[]
}

export const DEFAULT_ROTATION_MS = 8000
export const DEFAULT_MESSAGE_TTL_MINUTES = 60 * 24
export const MAX_TOTAL_ITEMS = 24
export const MAX_MESSAGE_ITEMS = 12
export const MAX_REMINDER_ITEMS = 6
export const MAX_TODO_ITEMS = 6

export function sanitizeOneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim()
}

export function uid(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

export function isExpired(item: Pick<ZeeBannerItem, "expiresAt">, nowMs: number): boolean {
  return typeof item.expiresAt === "number" && Number.isFinite(item.expiresAt) && item.expiresAt <= nowMs
}

export function uniq(items: ZeeBannerItem[]): ZeeBannerItem[] {
  const seen = new Set<string>()
  const result: ZeeBannerItem[] = []
  for (const item of items) {
    const key = `${item.kind}:${item.text}`
    if (seen.has(key)) continue
    seen.add(key)
    result.push(item)
  }
  return result
}

function isValidKind(kind: unknown): kind is BannerItemKind {
  return kind === "reminder" || kind === "todo" || kind === "message"
}

function coercePriority(priority: unknown): BannerItemPriority {
  if (priority === "low" || priority === "normal" || priority === "high" || priority === "urgent") return priority
  return "normal"
}

function normalizeExistingItem(raw: unknown, nowMs: number): ZeeBannerItem | null {
  if (!raw || typeof raw !== "object") return null
  const x = raw as Record<string, unknown>
  const kind = x.kind
  const text = x.text

  if (!isValidKind(kind)) return null
  if (typeof text !== "string" || !text.trim()) return null

  const id = typeof x.id === "string" && x.id.trim() ? x.id.trim() : uid("item")
  const createdAt =
    typeof x.createdAt === "number" && Number.isFinite(x.createdAt) ? (x.createdAt as number) : nowMs
  const expiresAt =
    typeof x.expiresAt === "number" && Number.isFinite(x.expiresAt) ? (x.expiresAt as number) : undefined

  return {
    id,
    kind,
    text: sanitizeOneLine(text),
    priority: coercePriority(x.priority),
    createdAt,
    ...(expiresAt !== undefined ? { expiresAt } : {}),
  }
}

export function parseExistingBanner(raw: unknown, nowMs: number): { rotationMs?: number; items: ZeeBannerItem[] } {
  if (!raw || typeof raw !== "object") return { items: [] }
  const x = raw as Record<string, unknown>
  const rotationMs =
    typeof x.rotationMs === "number" && Number.isFinite(x.rotationMs) && x.rotationMs > 0
      ? (x.rotationMs as number)
      : undefined
  const itemsRaw = x.items
  if (!Array.isArray(itemsRaw)) return { rotationMs, items: [] }

  const items = itemsRaw
    .map((item) => normalizeExistingItem(item, nowMs))
    .filter((item): item is ZeeBannerItem => item !== null)
    .filter((item) => !isExpired(item, nowMs))

  return { rotationMs, items }
}

export async function loadKV(): Promise<Record<string, unknown>> {
  const kvPath = path.join(Global.Path.state, "kv.json")
  try {
    const content = await fs.readFile(kvPath, "utf-8")
    const parsed = JSON.parse(content) as unknown
    if (parsed && typeof parsed === "object") return parsed as Record<string, unknown>
  } catch {
    // ignore
  }
  return {}
}

export async function saveKV(kv: Record<string, unknown>): Promise<void> {
  const kvPath = path.join(Global.Path.state, "kv.json")
  await fs.mkdir(Global.Path.state, { recursive: true })
  await fs.writeFile(kvPath, JSON.stringify(kv, null, 2) + "\n")
}
