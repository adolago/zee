/**
 * Mastery Tracking
 *
 * Track mastery levels across topics using a 6-level scale inspired by MathAcademy:
 * 1. Unknown - Never encountered
 * 2. Introduced - Seen but not practiced
 * 3. Developing - Practicing, making progress
 * 4. Proficient - Can solve with effort
 * 5. Mastered - Reliable recall and application
 * 6. Fluent - Automatic, effortless mastery
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs"
import { join, dirname } from "node:path"
import { homedir } from "node:os"
import { calculateFireWeights } from "./knowledge-graph"

export type MasteryLevel = "unknown" | "introduced" | "developing" | "proficient" | "mastered" | "fluent"

export const MASTERY_LEVELS: MasteryLevel[] = ["unknown", "introduced", "developing", "proficient", "mastered", "fluent"]

export const MASTERY_THRESHOLDS: Record<MasteryLevel, number> = {
  unknown: 0,
  introduced: 0.1,
  developing: 0.3,
  proficient: 0.5,
  mastered: 0.75,
  fluent: 0.9,
}

export interface MasteryRecord {
  topicId: string
  level: MasteryLevel
  score: number // 0-1 aggregate score
  practiceCount: number
  lastPracticed: number | null
  history: MasteryEvent[]
}

export interface MasteryEvent {
  timestamp: number
  score: number
  level: MasteryLevel
  type: "explicit" | "implicit" // explicit practice vs FIRe credit
}

interface MasteryStore {
  records: Record<string, MasteryRecord>
}

function getDataPath(): string {
  const dataDir = process.env.ZEE_LEARNING_DATA_DIR || join(homedir(), ".zee", "learning")
  return join(dataDir, "mastery.json")
}

function loadStore(): MasteryStore {
  const path = getDataPath()
  if (!existsSync(path)) {
    return { records: {} }
  }
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as MasteryStore
  } catch {
    return { records: {} }
  }
}

function saveStore(store: MasteryStore): void {
  const path = getDataPath()
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(store, null, 2))
}

function scoreToLevel(score: number): MasteryLevel {
  for (let i = MASTERY_LEVELS.length - 1; i >= 0; i--) {
    if (score >= MASTERY_THRESHOLDS[MASTERY_LEVELS[i]]) {
      return MASTERY_LEVELS[i]
    }
  }
  return "unknown"
}

export function getMastery(topicId: string): MasteryRecord {
  const store = loadStore()
  return (
    store.records[topicId] || {
      topicId,
      level: "unknown",
      score: 0,
      practiceCount: 0,
      lastPracticed: null,
      history: [],
    }
  )
}

export function getMasteryByDomain(domain: string): MasteryRecord[] {
  const store = loadStore()
  // Note: This requires topic info - for now return all records
  // In practice, you'd filter by topic domain
  return Object.values(store.records)
}

export function updateMastery(topicId: string, practiceScore: number, applyFire = true): MasteryRecord {
  const store = loadStore()
  const now = Date.now()

  // Update the main topic
  const record = store.records[topicId] || {
    topicId,
    level: "unknown",
    score: 0,
    practiceCount: 0,
    lastPracticed: null,
    history: [],
  }

  // Moving average with emphasis on recent performance
  const alpha = 0.3 // Weight for new score
  record.score = record.score * (1 - alpha) + practiceScore * alpha
  record.level = scoreToLevel(record.score)
  record.practiceCount++
  record.lastPracticed = now
  record.history.push({
    timestamp: now,
    score: practiceScore,
    level: record.level,
    type: "explicit",
  })

  // Keep history bounded
  if (record.history.length > 100) {
    record.history = record.history.slice(-100)
  }

  store.records[topicId] = record

  // Apply FIRe to prerequisites
  if (applyFire) {
    const fireWeights = calculateFireWeights(topicId)
    for (const [prereqId, weight] of Object.entries(fireWeights)) {
      if (prereqId === topicId) continue
      const prereqRecord = store.records[prereqId] || {
        topicId: prereqId,
        level: "unknown",
        score: 0,
        practiceCount: 0,
        lastPracticed: null,
        history: [],
      }

      const implicitScore = practiceScore * weight
      const implicitAlpha = 0.1 // Lower weight for implicit updates
      prereqRecord.score = prereqRecord.score * (1 - implicitAlpha) + implicitScore * implicitAlpha
      prereqRecord.level = scoreToLevel(prereqRecord.score)
      prereqRecord.history.push({
        timestamp: now,
        score: implicitScore,
        level: prereqRecord.level,
        type: "implicit",
      })

      if (prereqRecord.history.length > 100) {
        prereqRecord.history = prereqRecord.history.slice(-100)
      }

      store.records[prereqId] = prereqRecord
    }
  }

  saveStore(store)
  return record
}

export function getMasteryHistory(topicId: string): MasteryEvent[] {
  const record = getMastery(topicId)
  return record.history
}

export function getMasterySummary(domain?: string): {
  total: number
  byLevel: Record<MasteryLevel, number>
  averageScore: number
} {
  const store = loadStore()
  const records = Object.values(store.records)

  const byLevel: Record<MasteryLevel, number> = {
    unknown: 0,
    introduced: 0,
    developing: 0,
    proficient: 0,
    mastered: 0,
    fluent: 0,
  }

  let totalScore = 0
  for (const record of records) {
    byLevel[record.level]++
    totalScore += record.score
  }

  return {
    total: records.length,
    byLevel,
    averageScore: records.length > 0 ? totalScore / records.length : 0,
  }
}

/**
 * Calculate retention using Ebbinghaus forgetting curve.
 * R = e^(-t/S) where t is time since last practice and S is stability.
 */
export function calculateRetention(topicId: string): number {
  const record = getMastery(topicId)
  if (!record.lastPracticed) return 0

  const timeSinceLastPractice = Date.now() - record.lastPracticed
  const hoursElapsed = timeSinceLastPractice / (1000 * 60 * 60)

  // Stability increases with practice count and mastery level
  const levelBonus = MASTERY_LEVELS.indexOf(record.level) + 1
  const stability = 24 * levelBonus * Math.log2(record.practiceCount + 1)

  const retention = Math.exp(-hoursElapsed / stability)
  return Math.max(0, Math.min(1, retention))
}
