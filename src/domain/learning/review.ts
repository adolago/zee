/**
 * Spaced Repetition Review System
 *
 * Manages review scheduling using Ebbinghaus decay modeling.
 * Features:
 * - Optimal review scheduling based on retention curves
 * - Adaptive intervals based on performance
 * - Priority queue by urgency (lowest retention first)
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs"
import { join, dirname } from "node:path"
import { homedir } from "node:os"
import { calculateRetention, updateMastery, getMastery, MASTERY_LEVELS } from "./mastery"
import { listTopics } from "./knowledge-graph"

export interface ReviewSchedule {
  topicId: string
  nextReview: number // timestamp
  interval: number // hours
  reviewCount: number
  lastScore: number | null
}

interface ReviewStore {
  schedules: Record<string, ReviewSchedule>
  stats: {
    totalReviews: number
    averageScore: number
    streakDays: number
    lastReviewDate: string | null
  }
}

function getDataPath(): string {
  const dataDir = process.env.ZEE_LEARNING_DATA_DIR || join(homedir(), ".zee", "learning")
  return join(dataDir, "reviews.json")
}

function loadStore(): ReviewStore {
  const path = getDataPath()
  if (!existsSync(path)) {
    return {
      schedules: {},
      stats: {
        totalReviews: 0,
        averageScore: 0,
        streakDays: 0,
        lastReviewDate: null,
      },
    }
  }
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as ReviewStore
  } catch {
    return {
      schedules: {},
      stats: {
        totalReviews: 0,
        averageScore: 0,
        streakDays: 0,
        lastReviewDate: null,
      },
    }
  }
}

function saveStore(store: ReviewStore): void {
  const path = getDataPath()
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(store, null, 2))
}

export interface DueReview {
  topicId: string
  topicName: string
  retention: number
  urgency: number // higher = more urgent
  daysSinceLastReview: number | null
  interval: number
}

export function getDueReviews(limit = 10, domain?: string): DueReview[] {
  const store = loadStore()
  const topics = listTopics(domain)
  const now = Date.now()

  const reviews: DueReview[] = []

  for (const topic of topics) {
    const schedule = store.schedules[topic.id]
    const retention = calculateRetention(topic.id)
    const mastery = getMastery(topic.id)

    // Calculate urgency: lower retention = more urgent
    // Also factor in how overdue the review is
    let overdueFactor = 1
    if (schedule && schedule.nextReview < now) {
      const hoursOverdue = (now - schedule.nextReview) / (1000 * 60 * 60)
      overdueFactor = 1 + hoursOverdue / 24
    }

    const urgency = (1 - retention) * overdueFactor

    // Skip topics with high retention unless they're overdue
    if (retention > 0.9 && (!schedule || schedule.nextReview > now)) {
      continue
    }

    const daysSinceLastReview = mastery.lastPracticed ? (now - mastery.lastPracticed) / (1000 * 60 * 60 * 24) : null

    reviews.push({
      topicId: topic.id,
      topicName: topic.name,
      retention,
      urgency,
      daysSinceLastReview,
      interval: schedule?.interval || 24,
    })
  }

  // Sort by urgency (highest first)
  reviews.sort((a, b) => b.urgency - a.urgency)

  return reviews.slice(0, limit)
}

export function scheduleReview(topicId: string, hoursFromNow = 24): ReviewSchedule {
  const store = loadStore()
  const now = Date.now()

  const existing = store.schedules[topicId]
  const schedule: ReviewSchedule = {
    topicId,
    nextReview: now + hoursFromNow * 60 * 60 * 1000,
    interval: hoursFromNow,
    reviewCount: existing?.reviewCount || 0,
    lastScore: existing?.lastScore ?? null,
  }

  store.schedules[topicId] = schedule
  saveStore(store)
  return schedule
}

export function completeReview(topicId: string, score: number): ReviewSchedule {
  const store = loadStore()
  const now = Date.now()
  const today = new Date().toISOString().split("T")[0]

  // Update mastery (which also applies FIRe)
  updateMastery(topicId, score)

  const mastery = getMastery(topicId)
  const existing = store.schedules[topicId]

  // Calculate new interval based on performance
  // Good score = longer interval, poor score = shorter interval
  const baseInterval = existing?.interval || 24
  let newInterval: number

  if (score >= 0.9) {
    // Excellent - increase interval significantly
    newInterval = baseInterval * 2.5
  } else if (score >= 0.7) {
    // Good - increase interval
    newInterval = baseInterval * 1.5
  } else if (score >= 0.5) {
    // OK - maintain interval
    newInterval = baseInterval
  } else if (score >= 0.3) {
    // Poor - decrease interval
    newInterval = baseInterval * 0.5
  } else {
    // Very poor - reset to short interval
    newInterval = 4
  }

  // Cap intervals
  const maxInterval = 90 * 24 // 90 days in hours
  const minInterval = 4 // 4 hours
  newInterval = Math.max(minInterval, Math.min(maxInterval, newInterval))

  // Factor in mastery level
  const levelBonus = MASTERY_LEVELS.indexOf(mastery.level) + 1
  newInterval *= 1 + (levelBonus * 0.1)

  const schedule: ReviewSchedule = {
    topicId,
    nextReview: now + newInterval * 60 * 60 * 1000,
    interval: newInterval,
    reviewCount: (existing?.reviewCount || 0) + 1,
    lastScore: score,
  }

  store.schedules[topicId] = schedule

  // Update stats
  store.stats.totalReviews++
  store.stats.averageScore =
    (store.stats.averageScore * (store.stats.totalReviews - 1) + score) / store.stats.totalReviews

  // Update streak
  if (store.stats.lastReviewDate === today) {
    // Already reviewed today, streak continues
  } else {
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().split("T")[0]
    if (store.stats.lastReviewDate === yesterday) {
      store.stats.streakDays++
    } else if (store.stats.lastReviewDate !== today) {
      store.stats.streakDays = 1
    }
    store.stats.lastReviewDate = today
  }

  saveStore(store)
  return schedule
}

export function getReviewStats(): ReviewStore["stats"] & {
  scheduledCount: number
  overdueCount: number
} {
  const store = loadStore()
  const now = Date.now()

  let overdueCount = 0
  for (const schedule of Object.values(store.schedules)) {
    if (schedule.nextReview < now) {
      overdueCount++
    }
  }

  return {
    ...store.stats,
    scheduledCount: Object.keys(store.schedules).length,
    overdueCount,
  }
}

export function getOptimalSchedule(limit = 10): Array<{
  topicId: string
  suggestedInterval: number
  reason: string
}> {
  const store = loadStore()
  const topics = listTopics()
  const suggestions: Array<{
    topicId: string
    suggestedInterval: number
    reason: string
  }> = []

  for (const topic of topics) {
    const mastery = getMastery(topic.id)
    const retention = calculateRetention(topic.id)
    const schedule = store.schedules[topic.id]

    // Suggest optimal interval to maintain ~85% retention
    const targetRetention = 0.85
    const levelBonus = MASTERY_LEVELS.indexOf(mastery.level) + 1
    const stability = 24 * levelBonus * Math.log2(mastery.practiceCount + 1)
    const optimalInterval = -stability * Math.log(targetRetention)

    const currentInterval = schedule?.interval || 24
    const diff = Math.abs(optimalInterval - currentInterval)

    if (diff > 12) {
      // More than 12 hours difference
      suggestions.push({
        topicId: topic.id,
        suggestedInterval: Math.round(optimalInterval),
        reason:
          optimalInterval > currentInterval
            ? `Current interval too short. Increase to maintain 85% retention.`
            : `Current interval too long. Decrease to prevent excessive decay.`,
      })
    }
  }

  return suggestions.slice(0, limit)
}
