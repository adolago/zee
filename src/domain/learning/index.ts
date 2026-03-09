/**
 * Learning Domain Toolkit
 *
 * TypeScript learning domain implementation featuring:
 * - Knowledge graph with topic prerequisites (DAG)
 * - Spaced repetition with Ebbinghaus decay modeling
 * - FIRe (Fractional Implicit Repetition) for implicit review credit
 * - Mastery tracking across 6 levels
 * - Practice session management
 */

// Knowledge Graph
export {
  type Topic,
  type KnowledgeGraph,
  listTopics,
  getTopic,
  addTopic,
  addPrerequisite,
  getPrerequisites,
  getAllPrerequisites,
  getLearningPath,
  searchTopics,
  calculateFireWeights,
} from "./knowledge-graph"

// Mastery Tracking
export {
  type MasteryLevel,
  type MasteryRecord,
  type MasteryEvent,
  MASTERY_LEVELS,
  MASTERY_THRESHOLDS,
  getMastery,
  getMasteryByDomain,
  updateMastery,
  getMasteryHistory,
  getMasterySummary,
  calculateRetention,
} from "./mastery"

// Spaced Repetition
export {
  type ReviewSchedule,
  type DueReview,
  getDueReviews,
  scheduleReview,
  completeReview,
  getReviewStats,
  getOptimalSchedule,
} from "./review"

// Practice Sessions
export {
  type Session,
  type Problem,
  type NextProblem,
  startSession,
  endSession,
  pauseSession,
  resumeSession,
  getSessionStatus,
  getNextProblem,
  generatePractice,
  completeProblem,
  skipProblem,
} from "./practice"
