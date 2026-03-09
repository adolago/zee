/**
 * Practice Session Management
 *
 * Manages study sessions and practice problem selection.
 * Features:
 * - Session tracking with duration and focus area
 * - Optimal problem selection based on mastery and decay
 * - Problem generation prompts for different types
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs"
import { join, dirname } from "node:path"
import { homedir } from "node:os"
import { getDueReviews } from "./review"
import { getMastery, updateMastery, calculateRetention } from "./mastery"
import { listTopics, getTopic, getPrerequisites } from "./knowledge-graph"

export interface Session {
  id: string
  domain: string | null
  startTime: number
  endTime: number | null
  status: "active" | "paused" | "completed"
  pausedDuration: number // milliseconds spent paused
  targetMinutes: number | null
  problemsCompleted: number
  totalScore: number
}

export interface Problem {
  id: string
  topicId: string
  type: "concept" | "calculation" | "proof" | "application"
  difficulty: "easy" | "medium" | "hard"
  prompt: string
  hints: string[]
  createdAt: number
  completedAt: number | null
  score: number | null
}

interface PracticeStore {
  sessions: Record<string, Session>
  currentSessionId: string | null
  problems: Record<string, Problem>
  stats: {
    totalSessions: number
    totalMinutes: number
    totalProblems: number
  }
}

function getDataPath(): string {
  const dataDir = process.env.ZEE_LEARNING_DATA_DIR || join(homedir(), ".zee", "learning")
  return join(dataDir, "practice.json")
}

function loadStore(): PracticeStore {
  const path = getDataPath()
  if (!existsSync(path)) {
    return {
      sessions: {},
      currentSessionId: null,
      problems: {},
      stats: {
        totalSessions: 0,
        totalMinutes: 0,
        totalProblems: 0,
      },
    }
  }
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as PracticeStore
  } catch {
    return {
      sessions: {},
      currentSessionId: null,
      problems: {},
      stats: {
        totalSessions: 0,
        totalMinutes: 0,
        totalProblems: 0,
      },
    }
  }
}

function saveStore(store: PracticeStore): void {
  const path = getDataPath()
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(store, null, 2))
}

function generateId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

export function startSession(domain?: string, targetMinutes?: number): Session {
  const store = loadStore()

  // End any existing active session
  if (store.currentSessionId) {
    const existing = store.sessions[store.currentSessionId]
    if (existing && existing.status === "active") {
      endSession(store.currentSessionId)
    }
  }

  const session: Session = {
    id: generateId(),
    domain: domain || null,
    startTime: Date.now(),
    endTime: null,
    status: "active",
    pausedDuration: 0,
    targetMinutes: targetMinutes || null,
    problemsCompleted: 0,
    totalScore: 0,
  }

  store.sessions[session.id] = session
  store.currentSessionId = session.id
  store.stats.totalSessions++

  saveStore(store)
  return session
}

export function endSession(sessionId: string): Session | null {
  const store = loadStore()
  const session = store.sessions[sessionId]
  if (!session) return null

  session.endTime = Date.now()
  session.status = "completed"

  const activeMs = session.endTime - session.startTime - session.pausedDuration
  store.stats.totalMinutes += Math.round(activeMs / (1000 * 60))

  if (store.currentSessionId === sessionId) {
    store.currentSessionId = null
  }

  saveStore(store)
  return session
}

export function pauseSession(sessionId: string): Session | null {
  const store = loadStore()
  const session = store.sessions[sessionId]
  if (!session || session.status !== "active") return null

  session.status = "paused"
  ;(session as any).pauseStartTime = Date.now()

  saveStore(store)
  return session
}

export function resumeSession(sessionId: string): Session | null {
  const store = loadStore()
  const session = store.sessions[sessionId]
  if (!session || session.status !== "paused") return null

  const pauseStart = (session as any).pauseStartTime
  if (pauseStart) {
    session.pausedDuration += Date.now() - pauseStart
    delete (session as any).pauseStartTime
  }

  session.status = "active"
  store.currentSessionId = sessionId

  saveStore(store)
  return session
}

export function getSessionStatus(): {
  active: Session | null
  recent: Session[]
  stats: PracticeStore["stats"]
} {
  const store = loadStore()
  const active = store.currentSessionId ? store.sessions[store.currentSessionId] : null

  const recent = Object.values(store.sessions)
    .filter((s) => s.status === "completed")
    .sort((a, b) => (b.endTime || 0) - (a.endTime || 0))
    .slice(0, 5)

  return {
    active,
    recent,
    stats: store.stats,
  }
}

export interface NextProblem {
  topicId: string
  topicName: string
  type: "concept" | "calculation" | "proof" | "application"
  difficulty: "easy" | "medium" | "hard"
  reason: string
  promptTemplate: string
}

export function getNextProblem(domain?: string): NextProblem | null {
  // Get topics due for review
  const dueReviews = getDueReviews(5, domain)

  if (dueReviews.length === 0) {
    // No reviews due, find a topic to advance
    const topics = listTopics(domain)
    if (topics.length === 0) return null

    // Find topic with lowest mastery that has prereqs met
    for (const topic of topics) {
      const mastery = getMastery(topic.id)
      const prereqs = getPrerequisites(topic.id)
      const prereqsMet = prereqs.every((p) => {
        const pm = getMastery(p.id)
        return pm.score >= 0.5 // At least proficient
      })

      if (prereqsMet && mastery.score < 0.9) {
        return generateProblem(topic.id, topic.name, mastery.score)
      }
    }

    // If all topics are mastered, pick one randomly for maintenance
    const topic = topics[Math.floor(Math.random() * topics.length)]
    return generateProblem(topic.id, topic.name, 0.9)
  }

  // Pick the most urgent review
  const target = dueReviews[0]
  return generateProblem(target.topicId, target.topicName, 1 - target.retention)
}

function generateProblem(topicId: string, topicName: string, needLevel: number): NextProblem {
  // Determine difficulty based on need level
  let difficulty: "easy" | "medium" | "hard"
  if (needLevel < 0.3) {
    difficulty = "hard" // They're doing well, challenge them
  } else if (needLevel < 0.6) {
    difficulty = "medium"
  } else {
    difficulty = "easy" // They're struggling, start simple
  }

  // Determine problem type
  const types: Array<"concept" | "calculation" | "proof" | "application"> = [
    "concept",
    "calculation",
    "proof",
    "application",
  ]
  const type = types[Math.floor(Math.random() * types.length)]

  const prompts: Record<typeof type, string> = {
    concept: `Generate a conceptual understanding question about ${topicName}. The question should test whether the student understands the core ideas, not just mechanical procedures. Difficulty: ${difficulty}.`,
    calculation: `Generate a ${difficulty} calculation problem involving ${topicName}. Include clear steps the student should follow.`,
    proof: `Generate a ${difficulty} proof exercise related to ${topicName}. The student should prove a statement using the concepts.`,
    application: `Generate a ${difficulty} real-world application problem that uses ${topicName}. Provide context that makes the problem meaningful.`,
  }

  return {
    topicId,
    topicName,
    type,
    difficulty,
    reason:
      needLevel > 0.5
        ? `Topic needs review (retention: ${Math.round((1 - needLevel) * 100)}%)`
        : `Building mastery (current: ${Math.round((1 - needLevel) * 100)}%)`,
    promptTemplate: prompts[type],
  }
}

export function generatePractice(
  topicId: string,
  type?: "concept" | "calculation" | "proof" | "application",
  difficulty?: "easy" | "medium" | "hard"
): NextProblem | null {
  const topic = getTopic(topicId)
  if (!topic) return null

  const mastery = getMastery(topicId)
  const retention = calculateRetention(topicId)

  // Auto-select type if not specified
  const problemType = type || (["concept", "calculation", "proof", "application"] as const)[Math.floor(Math.random() * 4)]

  // Auto-select difficulty if not specified
  let problemDifficulty = difficulty
  if (!problemDifficulty) {
    if (mastery.score >= 0.75) {
      problemDifficulty = "hard"
    } else if (mastery.score >= 0.4) {
      problemDifficulty = "medium"
    } else {
      problemDifficulty = "easy"
    }
  }

  return generateProblem(topicId, topic.name, 1 - retention)
}

export function completeProblem(topicId: string, score: number): void {
  const store = loadStore()

  // Update mastery
  updateMastery(topicId, score)

  // Update current session if active
  if (store.currentSessionId) {
    const session = store.sessions[store.currentSessionId]
    if (session && session.status === "active") {
      session.problemsCompleted++
      session.totalScore += score
    }
  }

  store.stats.totalProblems++
  saveStore(store)
}

export function skipProblem(topicId: string): void {
  // Skipping counts as a low score
  completeProblem(topicId, 0.2)
}
