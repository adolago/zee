import path from "path"
import fs from "fs/promises"
import { Global } from "@/global"
import { Log } from "@/util/log"

const log = Log.create({ service: "skill:usage-history" })

const USAGE_DIR = path.join(Global.Path.state, "skills")
const USAGE_FILE = path.join(USAGE_DIR, "usage-history.json")
const MAX_EVENTS = 2000

const STOPWORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "from",
  "that",
  "this",
  "then",
  "into",
  "onto",
  "your",
  "have",
  "has",
  "had",
  "set",
  "to",
  "at",
  "in",
  "on",
  "of",
  "a",
  "an",
  "is",
  "it",
  "be",
  "by",
  "or",
  "as",
  "me",
  "my",
  "you",
  "we",
  "our",
])

export type SkillUsageOutcome = "success" | "blocked" | "failed"

export interface SkillUsageEvent {
  query: string
  skill: string
  outcome: SkillUsageOutcome
  timestamp: number
}

export interface SkillUsageBoost {
  boost: number
  matches: number
}

let cache: SkillUsageEvent[] | null = null
let loading: Promise<SkillUsageEvent[]> | null = null

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, " ")
    .split(/\s+/)
    .filter((token) => token.length >= 3 && !STOPWORDS.has(token))
}

function similarityScore(query: string, prior: string): number {
  const q = query.trim().toLowerCase()
  const p = prior.trim().toLowerCase()
  if (!q || !p) return 0
  if (q === p) return 1
  if (q.includes(p) || p.includes(q)) return 0.9

  const qt = new Set(tokenize(q))
  const pt = new Set(tokenize(p))
  if (qt.size === 0 || pt.size === 0) return 0

  let intersection = 0
  for (const token of qt) {
    if (pt.has(token)) intersection++
  }
  const union = qt.size + pt.size - intersection
  if (union <= 0) return 0
  return intersection / union
}

async function loadEvents(): Promise<SkillUsageEvent[]> {
  if (cache) return cache
  if (loading) return loading

  loading = (async () => {
    const raw = await Bun.file(USAGE_FILE)
      .text()
      .catch(() => "")
    if (!raw.trim()) {
      cache = []
      return cache
    }

    try {
      const parsed = JSON.parse(raw)
      if (!Array.isArray(parsed)) {
        cache = []
        return cache
      }

      cache = parsed
        .filter((entry) => entry && typeof entry === "object")
        .map((entry) => {
          const row = entry as Partial<SkillUsageEvent>
          return {
            query: typeof row.query === "string" ? row.query : "",
            skill: typeof row.skill === "string" ? row.skill : "",
            outcome:
              row.outcome === "success" || row.outcome === "blocked" || row.outcome === "failed"
                ? row.outcome
                : "failed",
            timestamp: typeof row.timestamp === "number" ? row.timestamp : 0,
          } satisfies SkillUsageEvent
        })
        .filter((entry) => entry.query && entry.skill)
      return cache
    } catch (error) {
      log.warn("failed to parse skill usage history; resetting", {
        file: USAGE_FILE,
        error: error instanceof Error ? error.message : String(error),
      })
      cache = []
      return cache
    }
  })().finally(() => {
    loading = null
  })

  return loading
}

async function persistEvents(events: SkillUsageEvent[]): Promise<void> {
  await Bun.write(USAGE_FILE, JSON.stringify(events, null, 2))
}

export async function recordSkillUsage(input: {
  query: string
  skill: string
  outcome: SkillUsageOutcome
}): Promise<void> {
  const query = input.query.trim()
  const skill = input.skill.trim()
  if (!query || !skill) return

  const events = await loadEvents()
  const next = [
    ...events,
    {
      query,
      skill,
      outcome: input.outcome,
      timestamp: Date.now(),
    } satisfies SkillUsageEvent,
  ].slice(-MAX_EVENTS)

  cache = next

  try {
    await fs.mkdir(USAGE_DIR, { recursive: true })
    await persistEvents(next)
  } catch (error) {
    log.warn("failed to persist skill usage history", {
      file: USAGE_FILE,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

export async function getSkillUsageBoostMap(query: string): Promise<Map<string, SkillUsageBoost>> {
  const normalized = query.trim().toLowerCase()
  if (!normalized) return new Map()

  const events = await loadEvents()
  const now = Date.now()
  const boosts = new Map<string, SkillUsageBoost>()

  for (const event of events) {
    if (event.outcome !== "success") continue

    const similarity = similarityScore(normalized, event.query)
    if (similarity <= 0) continue

    const ageDays = Math.max(0, (now - event.timestamp) / (1000 * 60 * 60 * 24))
    const decay = Math.exp(-ageDays / 30)
    const weighted = Math.min(12, similarity * 8 * decay)
    if (weighted <= 0.1) continue

    const current = boosts.get(event.skill) ?? { boost: 0, matches: 0 }
    boosts.set(event.skill, {
      boost: Math.min(12, Math.max(current.boost, weighted)),
      matches: current.matches + 1,
    })
  }

  return boosts
}
