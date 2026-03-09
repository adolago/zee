/**
 * Knowledge Graph - Topic DAG with Prerequisites
 *
 * A directed acyclic graph where nodes are topics and edges represent
 * "is prerequisite for" relationships. This enables:
 * - Learning path generation
 * - FIRe (Fractional Implicit Repetition)
 * - Dependency-aware scheduling
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs"
import { join, dirname } from "node:path"
import { homedir } from "node:os"

export interface Topic {
  id: string
  name: string
  domain: string
  description?: string
  createdAt: number
  updatedAt: number
}

export interface KnowledgeGraph {
  topics: Record<string, Topic>
  // edges[topicId] = array of prerequisite topic IDs
  edges: Record<string, string[]>
}

function getDataPath(): string {
  const dataDir = process.env.ZEE_LEARNING_DATA_DIR || join(homedir(), ".zee", "learning")
  return join(dataDir, "knowledge-graph.json")
}

function loadGraph(): KnowledgeGraph {
  const path = getDataPath()
  if (!existsSync(path)) {
    return { topics: {}, edges: {} }
  }
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as KnowledgeGraph
  } catch {
    return { topics: {}, edges: {} }
  }
}

function saveGraph(graph: KnowledgeGraph): void {
  const path = getDataPath()
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(graph, null, 2))
}

export function listTopics(domain?: string): Topic[] {
  const graph = loadGraph()
  let topics = Object.values(graph.topics)
  if (domain) {
    topics = topics.filter((t) => t.domain === domain)
  }
  return topics.sort((a, b) => a.name.localeCompare(b.name))
}

export function getTopic(topicId: string): Topic | null {
  const graph = loadGraph()
  return graph.topics[topicId] || null
}

export function addTopic(topic: Omit<Topic, "createdAt" | "updatedAt">): Topic {
  const graph = loadGraph()
  const now = Date.now()
  const newTopic: Topic = {
    ...topic,
    createdAt: now,
    updatedAt: now,
  }
  graph.topics[topic.id] = newTopic
  if (!graph.edges[topic.id]) {
    graph.edges[topic.id] = []
  }
  saveGraph(graph)
  return newTopic
}

export function addPrerequisite(topicId: string, prerequisiteId: string): boolean {
  const graph = loadGraph()
  if (!graph.topics[topicId] || !graph.topics[prerequisiteId]) {
    return false
  }
  // Check for cycles
  if (wouldCreateCycle(graph, topicId, prerequisiteId)) {
    return false
  }
  if (!graph.edges[topicId]) {
    graph.edges[topicId] = []
  }
  if (!graph.edges[topicId].includes(prerequisiteId)) {
    graph.edges[topicId].push(prerequisiteId)
  }
  saveGraph(graph)
  return true
}

function wouldCreateCycle(graph: KnowledgeGraph, topicId: string, newPrereqId: string): boolean {
  // If adding newPrereqId as a prerequisite of topicId would create a cycle
  // This happens if topicId is reachable from newPrereqId
  const visited = new Set<string>()
  const stack = [newPrereqId]
  while (stack.length > 0) {
    const current = stack.pop()!
    if (current === topicId) return true
    if (visited.has(current)) continue
    visited.add(current)
    const prereqs = graph.edges[current] || []
    stack.push(...prereqs)
  }
  return false
}

export function getPrerequisites(topicId: string): Topic[] {
  const graph = loadGraph()
  const prereqIds = graph.edges[topicId] || []
  return prereqIds.map((id) => graph.topics[id]).filter(Boolean)
}

export function getAllPrerequisites(topicId: string): Topic[] {
  const graph = loadGraph()
  const result: Topic[] = []
  const visited = new Set<string>()
  const stack = [...(graph.edges[topicId] || [])]
  while (stack.length > 0) {
    const current = stack.pop()!
    if (visited.has(current)) continue
    visited.add(current)
    const topic = graph.topics[current]
    if (topic) {
      result.push(topic)
      const prereqs = graph.edges[current] || []
      stack.push(...prereqs)
    }
  }
  return result
}

export function getLearningPath(targetId: string): Topic[] {
  const graph = loadGraph()
  if (!graph.topics[targetId]) return []

  // Topological sort of prerequisites
  const visited = new Set<string>()
  const result: Topic[] = []

  function dfs(topicId: string) {
    if (visited.has(topicId)) return
    visited.add(topicId)
    const prereqs = graph.edges[topicId] || []
    for (const prereq of prereqs) {
      dfs(prereq)
    }
    const topic = graph.topics[topicId]
    if (topic) result.push(topic)
  }

  dfs(targetId)
  return result
}

export function searchTopics(query: string, domain?: string): Topic[] {
  const graph = loadGraph()
  const lowerQuery = query.toLowerCase()
  let topics = Object.values(graph.topics)
  if (domain) {
    topics = topics.filter((t) => t.domain === domain)
  }
  return topics.filter((t) => t.name.toLowerCase().includes(lowerQuery) || t.description?.toLowerCase().includes(lowerQuery))
}

/**
 * Calculate FIRe (Fractional Implicit Repetition) weights.
 * When practicing a topic, you get implicit review credit for prerequisites.
 * Weight decays by 50% per level of depth.
 */
export function calculateFireWeights(topicId: string): Record<string, number> {
  const graph = loadGraph()
  const weights: Record<string, number> = { [topicId]: 1.0 }
  const visited = new Set<string>([topicId])
  const queue: Array<{ id: string; depth: number }> = [{ id: topicId, depth: 0 }]

  while (queue.length > 0) {
    const { id, depth } = queue.shift()!
    const prereqs = graph.edges[id] || []
    for (const prereq of prereqs) {
      if (visited.has(prereq)) continue
      visited.add(prereq)
      const weight = Math.pow(0.5, depth + 1) // 50%, 25%, 12.5%, ...
      weights[prereq] = weight
      queue.push({ id: prereq, depth: depth + 1 })
    }
  }

  return weights
}
