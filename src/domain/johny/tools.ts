/**
 * Johny Domain Tools
 *
 * Learning and study tools powered by TypeScript implementation:
 * - Knowledge graph with topic prerequisites (DAG)
 * - Spaced repetition with Ebbinghaus decay modeling
 * - FIRe (Fractional Implicit Repetition) for implicit review credit
 * - Mastery tracking across 6 levels
 */

import { z } from "zod"
import type { ToolDefinition, ToolExecutionResult } from "../../mcp/types"
import * as johny from "../../personas/johny"

// =============================================================================
// Study Session Tool
// =============================================================================

const StudyParams = z.object({
  action: z.enum(["start", "end", "status", "pause", "resume"]).default("status").describe("Study session action"),
  domain: z.string().optional().describe("Learning domain (math, cs, etc.)"),
  minutes: z.number().optional().describe("Session duration in minutes"),
  sessionId: z.string().optional().describe("Session ID for end/pause/resume actions"),
})

export const studyTool: ToolDefinition = {
  id: "johny:study",
  category: "domain",
  init: async () => ({
    description: `Manage study sessions for deliberate practice.

**Session continuity**: Before starting a new session, check zee:memory-agentic-search (domain "learning") for the user's most recent session summary and study plan.

Actions:
- start: Begin a focused study session with optional duration
- end: End current session and record progress
- status: Check active session and statistics
- pause/resume: Pause or resume a session

Examples:
- Start 30-min math session: { action: "start", domain: "math", minutes: 30 }
- Check status: { action: "status" }
- End session: { action: "end", sessionId: "session-123" }`,
    parameters: StudyParams,
    execute: async (args, ctx): Promise<ToolExecutionResult> => {
      const { action, domain, minutes, sessionId } = args
      ctx.metadata({ title: `Study: ${action}` })

      try {
        switch (action) {
          case "start": {
            const session = johny.startSession(domain, minutes)
            return {
              title: "Session Started",
              metadata: { ok: true },
              output: JSON.stringify(session, null, 2),
            }
          }
          case "end": {
            if (!sessionId) {
              const status = johny.getSessionStatus()
              if (!status.active) {
                return { title: "No Active Session", metadata: { ok: false }, output: "No active session to end." }
              }
              const session = johny.endSession(status.active.id)
              return {
                title: "Session Ended",
                metadata: { ok: true },
                output: JSON.stringify(session, null, 2),
              }
            }
            const session = johny.endSession(sessionId)
            return {
              title: "Session Ended",
              metadata: { ok: true },
              output: session ? JSON.stringify(session, null, 2) : "Session not found.",
            }
          }
          case "status": {
            const status = johny.getSessionStatus()
            return {
              title: "Session Status",
              metadata: { ok: true },
              output: JSON.stringify(status, null, 2),
            }
          }
          case "pause": {
            const status = johny.getSessionStatus()
            const id = sessionId || status.active?.id
            if (!id) {
              return { title: "No Session", metadata: { ok: false }, output: "No session to pause." }
            }
            const session = johny.pauseSession(id)
            return {
              title: "Session Paused",
              metadata: { ok: true },
              output: session ? JSON.stringify(session, null, 2) : "Could not pause session.",
            }
          }
          case "resume": {
            if (!sessionId) {
              return { title: "Error", metadata: { ok: false }, output: "Session ID required for resume." }
            }
            const session = johny.resumeSession(sessionId)
            return {
              title: "Session Resumed",
              metadata: { ok: true },
              output: session ? JSON.stringify(session, null, 2) : "Could not resume session.",
            }
          }
        }
      } catch (error) {
        return {
          title: `Study: ${action}`,
          metadata: { ok: false },
          output: error instanceof Error ? error.message : "Unknown error",
        }
      }
    },
  }),
}

// =============================================================================
// Knowledge Graph Tool
// =============================================================================

const KnowledgeParams = z.object({
  action: z.enum(["topics", "prerequisites", "path", "add-topic", "add-prereq", "search"]).describe("Knowledge graph action"),
  domain: z.string().optional().describe("Filter by domain (math, cs, etc.)"),
  topicId: z.string().optional().describe("Topic ID for queries"),
  targetId: z.string().optional().describe("Target topic ID for path finding"),
  query: z.string().optional().describe("Search query for topics"),
  topic: z
    .object({
      id: z.string(),
      name: z.string(),
      domain: z.string(),
      description: z.string().optional(),
    })
    .optional()
    .describe("Topic to add"),
  prerequisiteId: z.string().optional().describe("Prerequisite topic ID to add"),
})

export const knowledgeTool: ToolDefinition = {
  id: "johny:knowledge",
  category: "domain",
  init: async () => ({
    description: `Interact with the knowledge graph (topic DAG with prerequisites).
Actions:
- topics: List all topics, optionally filtered by domain
- prerequisites: Get prerequisites for a topic
- path: Get learning path from current knowledge to target topic
- add-topic: Add a new topic to the graph
- add-prereq: Add a prerequisite relationship
- search: Search topics by name or description

The knowledge graph is a DAG where edges represent "is prerequisite for" relationships.

Examples:
- List math topics: { action: "topics", domain: "math" }
- Get calculus prerequisites: { action: "prerequisites", topicId: "calculus" }
- Path to integration: { action: "path", targetId: "integration" }`,
    parameters: KnowledgeParams,
    execute: async (args, ctx): Promise<ToolExecutionResult> => {
      const { action, domain, topicId, targetId, query, topic, prerequisiteId } = args
      ctx.metadata({ title: `Knowledge: ${action}` })

      try {
        switch (action) {
          case "topics": {
            const topics = johny.listTopics(domain)
            return {
              title: "Topics",
              metadata: { ok: true, count: topics.length },
              output: JSON.stringify(topics, null, 2),
            }
          }
          case "prerequisites": {
            if (!topicId) {
              return { title: "Error", metadata: { ok: false }, output: "topicId required" }
            }
            const prereqs = johny.getPrerequisites(topicId)
            return {
              title: "Prerequisites",
              metadata: { ok: true, count: prereqs.length },
              output: JSON.stringify(prereqs, null, 2),
            }
          }
          case "path": {
            if (!targetId) {
              return { title: "Error", metadata: { ok: false }, output: "targetId required" }
            }
            const path = johny.getLearningPath(targetId)
            return {
              title: "Learning Path",
              metadata: { ok: true, count: path.length },
              output: JSON.stringify(path, null, 2),
            }
          }
          case "add-topic": {
            if (!topic) {
              return { title: "Error", metadata: { ok: false }, output: "topic object required" }
            }
            const newTopic = johny.addTopic(topic)
            return {
              title: "Topic Added",
              metadata: { ok: true },
              output: JSON.stringify(newTopic, null, 2),
            }
          }
          case "add-prereq": {
            if (!topicId || !prerequisiteId) {
              return { title: "Error", metadata: { ok: false }, output: "topicId and prerequisiteId required" }
            }
            const success = johny.addPrerequisite(topicId, prerequisiteId)
            return {
              title: success ? "Prerequisite Added" : "Failed",
              metadata: { ok: success },
              output: success ? `Added ${prerequisiteId} as prerequisite of ${topicId}` : "Failed to add prerequisite (topic not found or would create cycle)",
            }
          }
          case "search": {
            if (!query) {
              return { title: "Error", metadata: { ok: false }, output: "query required" }
            }
            const results = johny.searchTopics(query, domain)
            return {
              title: "Search Results",
              metadata: { ok: true, count: results.length },
              output: JSON.stringify(results, null, 2),
            }
          }
        }
      } catch (error) {
        return {
          title: `Knowledge: ${action}`,
          metadata: { ok: false },
          output: error instanceof Error ? error.message : "Unknown error",
        }
      }
    },
  }),
}

// =============================================================================
// Mastery Tool
// =============================================================================

const MasteryParams = z.object({
  action: z.enum(["status", "update", "history", "decay", "summary"]).describe("Mastery tracking action"),
  topicId: z.string().optional().describe("Topic ID"),
  domain: z.string().optional().describe("Filter by domain"),
  level: z.enum(["unknown", "introduced", "developing", "proficient", "mastered", "fluent"]).optional().describe("Mastery level to set"),
  score: z.number().min(0).max(1).optional().describe("Practice score (0-1) for implicit level update"),
})

export const masteryTool: ToolDefinition = {
  id: "johny:mastery",
  category: "domain",
  init: async () => ({
    description: `Track mastery levels across topics.
Mastery Levels (inspired by MathAcademy):
1. Unknown - Never encountered
2. Introduced - Seen but not practiced
3. Developing - Practicing, making progress
4. Proficient - Can solve with effort
5. Mastered - Reliable recall and application
6. Fluent - Automatic, effortless mastery

Actions:
- status: Get mastery level for a topic or domain
- update: Update mastery based on practice score
- history: Get mastery history for a topic
- decay: Calculate current retention with Ebbinghaus decay
- summary: Overall mastery summary across domains

Examples:
- Check calculus mastery: { action: "status", topicId: "calculus" }
- Update after practice: { action: "update", topicId: "limits", score: 0.85 }
- Domain summary: { action: "summary", domain: "math" }`,
    parameters: MasteryParams,
    execute: async (args, ctx): Promise<ToolExecutionResult> => {
      const { action, topicId, domain, score } = args
      ctx.metadata({ title: `Mastery: ${action}` })

      try {
        switch (action) {
          case "status": {
            if (topicId) {
              const mastery = johny.getMastery(topicId)
              return {
                title: "Mastery Status",
                metadata: { ok: true },
                output: JSON.stringify(mastery, null, 2),
              }
            }
            const summary = johny.getMasterySummary(domain)
            return {
              title: "Mastery Summary",
              metadata: { ok: true },
              output: JSON.stringify(summary, null, 2),
            }
          }
          case "update": {
            if (!topicId || score === undefined) {
              return { title: "Error", metadata: { ok: false }, output: "topicId and score required" }
            }
            const mastery = johny.updateMastery(topicId, score)
            return {
              title: "Mastery Updated",
              metadata: { ok: true },
              output: JSON.stringify(mastery, null, 2),
            }
          }
          case "history": {
            if (!topicId) {
              return { title: "Error", metadata: { ok: false }, output: "topicId required" }
            }
            const history = johny.getMasteryHistory(topicId)
            return {
              title: "Mastery History",
              metadata: { ok: true, count: history.length },
              output: JSON.stringify(history, null, 2),
            }
          }
          case "decay": {
            if (!topicId) {
              return { title: "Error", metadata: { ok: false }, output: "topicId required" }
            }
            const retention = johny.calculateRetention(topicId)
            return {
              title: "Retention",
              metadata: { ok: true },
              output: `Current retention for ${topicId}: ${(retention * 100).toFixed(1)}%`,
            }
          }
          case "summary": {
            const summary = johny.getMasterySummary(domain)
            return {
              title: "Mastery Summary",
              metadata: { ok: true },
              output: JSON.stringify(summary, null, 2),
            }
          }
        }
      } catch (error) {
        return {
          title: `Mastery: ${action}`,
          metadata: { ok: false },
          output: error instanceof Error ? error.message : "Unknown error",
        }
      }
    },
  }),
}

// =============================================================================
// Review Tool (Spaced Repetition)
// =============================================================================

const ReviewParams = z.object({
  action: z.enum(["due", "schedule", "complete", "stats", "optimize"]).describe("Review action"),
  topicId: z.string().optional().describe("Topic ID"),
  domain: z.string().optional().describe("Filter by domain"),
  score: z.number().min(0).max(1).optional().describe("Review score (0-1)"),
  limit: z.number().optional().describe("Max items to return"),
})

export const reviewTool: ToolDefinition = {
  id: "johny:review",
  category: "domain",
  init: async () => ({
    description: `Manage spaced repetition reviews using Ebbinghaus decay modeling.
Features:
- Optimal review scheduling based on retention curves
- FIRe (Fractional Implicit Repetition) - practicing advanced topics gives partial credit to prerequisites
- Adaptive intervals based on performance

Actions:
- due: Get topics due for review (sorted by urgency)
- schedule: Schedule a review for a topic
- complete: Record a review completion with score
- stats: Get review statistics
- optimize: Suggest optimal review schedule

FIRe Example:
When you practice "Integration by Parts", you get implicit review credit for:
- Integration (50%)
- Derivatives (25%)
- Limits (12.5%)
This reduces explicit review burden by ~80%.

Examples:
- Get due reviews: { action: "due", limit: 5 }
- Complete review: { action: "complete", topicId: "derivatives", score: 0.9 }`,
    parameters: ReviewParams,
    execute: async (args, ctx): Promise<ToolExecutionResult> => {
      const { action, topicId, domain, score, limit } = args
      ctx.metadata({ title: `Review: ${action}` })

      try {
        switch (action) {
          case "due": {
            const due = johny.getDueReviews(limit || 10, domain)
            return {
              title: "Due Reviews",
              metadata: { ok: true, count: due.length },
              output: JSON.stringify(due, null, 2),
            }
          }
          case "schedule": {
            if (!topicId) {
              return { title: "Error", metadata: { ok: false }, output: "topicId required" }
            }
            const schedule = johny.scheduleReview(topicId)
            return {
              title: "Review Scheduled",
              metadata: { ok: true },
              output: JSON.stringify(schedule, null, 2),
            }
          }
          case "complete": {
            if (!topicId || score === undefined) {
              return { title: "Error", metadata: { ok: false }, output: "topicId and score required" }
            }
            const schedule = johny.completeReview(topicId, score)
            return {
              title: "Review Completed",
              metadata: { ok: true },
              output: JSON.stringify(schedule, null, 2),
            }
          }
          case "stats": {
            const stats = johny.getReviewStats()
            return {
              title: "Review Stats",
              metadata: { ok: true },
              output: JSON.stringify(stats, null, 2),
            }
          }
          case "optimize": {
            const suggestions = johny.getOptimalSchedule(limit || 10)
            return {
              title: "Optimization Suggestions",
              metadata: { ok: true, count: suggestions.length },
              output: JSON.stringify(suggestions, null, 2),
            }
          }
        }
      } catch (error) {
        return {
          title: `Review: ${action}`,
          metadata: { ok: false },
          output: error instanceof Error ? error.message : "Unknown error",
        }
      }
    },
  }),
}

// =============================================================================
// Practice Tool
// =============================================================================

const PracticeParams = z.object({
  action: z.enum(["next", "generate", "complete", "skip", "hint"]).describe("Practice action"),
  topicId: z.string().optional().describe("Topic ID for practice"),
  domain: z.string().optional().describe("Domain for practice"),
  difficulty: z.enum(["easy", "medium", "hard", "adaptive"]).optional().describe("Problem difficulty"),
  problemId: z.string().optional().describe("Problem ID for complete/skip/hint"),
  score: z.number().min(0).max(1).optional().describe("Score for completion"),
  type: z.enum(["concept", "calculation", "proof", "application"]).optional().describe("Problem type"),
})

export const practiceTool: ToolDefinition = {
  id: "johny:practice",
  category: "domain",
  init: async () => ({
    description: `Get practice problems for deliberate practice.
Actions:
- next: Get the optimal next practice problem (considers mastery, decay, dependencies)
- generate: Generate a practice problem for a specific topic
- complete: Record problem completion with score
- skip: Skip a problem (affects scheduling)
- hint: Get a hint for a problem

Problem Types:
- concept: Conceptual understanding questions
- calculation: Numerical/symbolic computation
- proof: Mathematical proofs
- application: Real-world applications

Difficulty is adaptive by default - targets the edge of your ability.

Examples:
- Get next problem: { action: "next" }
- Generate calculus problem: { action: "generate", topicId: "derivatives", difficulty: "medium" }
- Complete problem: { action: "complete", problemId: "prob-123", score: 1.0 }`,
    parameters: PracticeParams,
    execute: async (args, ctx): Promise<ToolExecutionResult> => {
      const { action, topicId, domain, difficulty, score, type } = args
      ctx.metadata({ title: `Practice: ${action}` })

      try {
        switch (action) {
          case "next": {
            const problem = johny.getNextProblem(domain)
            if (!problem) {
              return {
                title: "No Problems",
                metadata: { ok: false },
                output: "No topics available. Add topics to the knowledge graph first.",
              }
            }
            return {
              title: "Next Problem",
              metadata: { ok: true },
              output: JSON.stringify(problem, null, 2),
            }
          }
          case "generate": {
            if (!topicId) {
              return { title: "Error", metadata: { ok: false }, output: "topicId required" }
            }
            const problem = johny.generatePractice(
              topicId,
              type,
              difficulty === "adaptive" ? undefined : difficulty
            )
            if (!problem) {
              return {
                title: "Topic Not Found",
                metadata: { ok: false },
                output: `Topic ${topicId} not found in knowledge graph.`,
              }
            }
            return {
              title: "Generated Problem",
              metadata: { ok: true },
              output: JSON.stringify(problem, null, 2),
            }
          }
          case "complete": {
            if (!topicId || score === undefined) {
              return { title: "Error", metadata: { ok: false }, output: "topicId and score required" }
            }
            johny.completeProblem(topicId, score)
            return {
              title: "Problem Completed",
              metadata: { ok: true },
              output: `Recorded score ${score} for ${topicId}`,
            }
          }
          case "skip": {
            if (!topicId) {
              return { title: "Error", metadata: { ok: false }, output: "topicId required" }
            }
            johny.skipProblem(topicId)
            return {
              title: "Problem Skipped",
              metadata: { ok: true },
              output: `Skipped problem for ${topicId}`,
            }
          }
          case "hint": {
            return {
              title: "Hint",
              metadata: { ok: true },
              output: "Hints are generated contextually. Ask Johny for help with the specific problem.",
            }
          }
        }
      } catch (error) {
        return {
          title: `Practice: ${action}`,
          metadata: { ok: false },
          output: error instanceof Error ? error.message : "Unknown error",
        }
      }
    },
  }),
}

// =============================================================================
// Exports
// =============================================================================

export const JOHNY_TOOLS = [studyTool, knowledgeTool, masteryTool, reviewTool, practiceTool]

export function registerJohnyTools(registry: {
  register: (tool: ToolDefinition, options: { source: string }) => void
}): void {
  for (const tool of JOHNY_TOOLS) {
    registry.register(tool, { source: "domain" })
  }
}
