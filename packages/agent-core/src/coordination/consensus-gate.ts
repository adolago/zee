/**
 * Consensus Gate
 *
 * A simplified consensus mechanism for gating tool side effects.
 * Provides approval/rejection for actions that have external effects
 * (sending messages, creating calendar events, financial transactions, etc.)
 *
 * Modes:
 * - "auto": Always approve (logging only)
 * - "majority": Require majority approval from registered voters
 * - "unanimous": Require all voters to approve
 * - "single": Require at least one approval
 *
 * This is designed for single-node use cases. For distributed consensus,
 * use a dedicated consensus engine.
 */

import { EventEmitter } from "events"
import { randomUUID } from "crypto"
import { Log } from "../util/log"

const log = Log.create({ service: "consensus-gate" })

// =============================================================================
// Types
// =============================================================================

export type ConsensusMode = "auto" | "majority" | "unanimous" | "single"

export type ProposalType =
  | "tool_side_effect"
  | "message_send"
  | "calendar_create"
  | "financial_transaction"
  | "file_write"
  | "external_api"
  | "custom"

export interface ConsensusConfig {
  /** Enable consensus gating */
  enabled: boolean
  /** Consensus mode */
  mode: ConsensusMode
  /** Types of actions that require consensus */
  requireApprovalFor: ProposalType[]
  /** Timeout for gathering votes (ms) */
  voteTimeout: number
  /** Auto-approve if no voters registered */
  autoApproveIfNoVoters: boolean
}

export interface Proposal {
  id: string
  type: ProposalType
  description: string
  content: unknown
  proposer: string
  timestamp: number
  metadata?: Record<string, unknown>
}

export interface Vote {
  voterId: string
  approved: boolean
  confidence: number
  reason?: string
  timestamp: number
}

export interface Decision {
  proposalId: string
  approved: boolean
  votes: Vote[]
  mode: ConsensusMode
  decidedAt: number
  reason: string
}

export interface ConsensusStats {
  enabled: boolean
  mode: ConsensusMode
  totalProposals: number
  approved: number
  rejected: number
  pending: number
  voterCount: number
}

// =============================================================================
// Default Configuration
// =============================================================================

const DEFAULT_CONFIG: ConsensusConfig = {
  enabled: false,
  mode: "auto",
  requireApprovalFor: ["tool_side_effect", "message_send"],
  voteTimeout: 5000,
  autoApproveIfNoVoters: true,
}

// =============================================================================
// Consensus Gate Service
// =============================================================================

export class ConsensusGate extends EventEmitter {
  private static instance: ConsensusGate | null = null

  private config: ConsensusConfig
  private voters = new Map<string, { name: string; capabilities: string[] }>()
  private pendingProposals = new Map<string, { proposal: Proposal; votes: Vote[] }>()
  private decisions: Decision[] = []
  private initialized = false

  private constructor(config?: Partial<ConsensusConfig>) {
    super()
    this.config = { ...DEFAULT_CONFIG, ...config }
  }

  /**
   * Get singleton instance
   */
  static getInstance(config?: Partial<ConsensusConfig>): ConsensusGate {
    if (!ConsensusGate.instance) {
      ConsensusGate.instance = new ConsensusGate(config)
    } else if (config) {
      ConsensusGate.instance.config = {
        ...ConsensusGate.instance.config,
        ...config,
      }
    }
    return ConsensusGate.instance
  }

  /**
   * Reset singleton (for testing)
   */
  static reset(): void {
    ConsensusGate.instance = null
  }

  /**
   * Initialize the gate
   */
  async initialize(): Promise<void> {
    if (this.initialized) return

    if (!this.config.enabled) {
      log.info("Consensus gate is disabled")
      return
    }

    log.info("Initializing consensus gate", {
      mode: this.config.mode,
      requireApprovalFor: this.config.requireApprovalFor,
    })

    this.initialized = true
  }

  /**
   * Shutdown the gate
   */
  shutdown(): void {
    this.pendingProposals.clear()
    this.voters.clear()
    this.initialized = false
    log.info("Consensus gate shutdown")
  }

  /**
   * Register a voter
   */
  registerVoter(id: string, name: string, capabilities: string[] = []): void {
    this.voters.set(id, { name, capabilities })
    log.debug("Voter registered", { id, name })
  }

  /**
   * Unregister a voter
   */
  unregisterVoter(id: string): void {
    this.voters.delete(id)
    log.debug("Voter unregistered", { id })
  }

  /**
   * Check if an action type requires approval
   */
  requiresApproval(type: ProposalType): boolean {
    if (!this.config.enabled) return false
    return this.config.requireApprovalFor.includes(type)
  }

  /**
   * Submit a proposal for approval
   */
  async propose(input: {
    type: ProposalType
    description: string
    content: unknown
    proposer: string
    metadata?: Record<string, unknown>
  }): Promise<Decision> {
    const proposal: Proposal = {
      id: randomUUID(),
      type: input.type,
      description: input.description,
      content: input.content,
      proposer: input.proposer,
      timestamp: Date.now(),
      metadata: input.metadata,
    }

    log.info("Proposal submitted", {
      id: proposal.id,
      type: proposal.type,
      proposer: proposal.proposer,
    })

    // If disabled or auto mode, always approve
    if (!this.config.enabled || this.config.mode === "auto") {
      const decision = this.createDecision(proposal, [], true, "Auto-approved (consensus disabled or auto mode)")
      this.recordDecision(decision)
      return decision
    }

    // If no voters and auto-approve enabled
    if (this.voters.size === 0 && this.config.autoApproveIfNoVoters) {
      const decision = this.createDecision(proposal, [], true, "Auto-approved (no voters registered)")
      this.recordDecision(decision)
      return decision
    }

    // If no voters and auto-approve disabled
    if (this.voters.size === 0) {
      const decision = this.createDecision(proposal, [], false, "Rejected (no voters available)")
      this.recordDecision(decision)
      return decision
    }

    // Store pending proposal
    this.pendingProposals.set(proposal.id, { proposal, votes: [] })

    // Emit event for voters
    this.emit("proposal", proposal)

    // Wait for votes with timeout
    const votes = await this.gatherVotes(proposal.id)

    // Evaluate votes based on mode
    const decision = this.evaluateVotes(proposal, votes)
    this.recordDecision(decision)

    // Cleanup
    this.pendingProposals.delete(proposal.id)

    return decision
  }

  /**
   * Cast a vote on a pending proposal
   */
  vote(
    proposalId: string,
    voterId: string,
    approved: boolean,
    options?: {
      confidence?: number
      reason?: string
    },
  ): boolean {
    const pending = this.pendingProposals.get(proposalId)
    if (!pending) {
      log.warn("Vote for unknown proposal", { proposalId, voterId })
      return false
    }

    const vote: Vote = {
      voterId,
      approved,
      confidence: options?.confidence ?? 1.0,
      reason: options?.reason,
      timestamp: Date.now(),
    }

    pending.votes.push(vote)
    this.emit("vote", { proposalId, vote })

    log.debug("Vote recorded", {
      proposalId,
      voterId,
      approved,
    })

    return true
  }

  /**
   * Get current stats
   */
  getStats(): ConsensusStats {
    const approved = this.decisions.filter((d) => d.approved).length
    const rejected = this.decisions.filter((d) => !d.approved).length

    return {
      enabled: this.config.enabled,
      mode: this.config.mode,
      totalProposals: this.decisions.length,
      approved,
      rejected,
      pending: this.pendingProposals.size,
      voterCount: this.voters.size,
    }
  }

  /**
   * Get decision history
   */
  getDecisionHistory(limit = 100): Decision[] {
    return this.decisions.slice(-limit)
  }

  /**
   * Get pending proposals
   */
  getPendingProposals(): Proposal[] {
    return Array.from(this.pendingProposals.values()).map((p) => p.proposal)
  }

  // ===========================================================================
  // Private Methods
  // ===========================================================================

  private async gatherVotes(proposalId: string): Promise<Vote[]> {
    return new Promise((resolve) => {
      const pending = this.pendingProposals.get(proposalId)
      if (!pending) {
        resolve([])
        return
      }

      const checkComplete = () => {
        const votes = pending.votes
        // Complete when all voters have voted
        if (votes.length >= this.voters.size) {
          clearTimeout(timeout)
          resolve(votes)
        }
      }

      // Listen for votes
      const voteHandler = (event: { proposalId: string }) => {
        if (event.proposalId === proposalId) {
          checkComplete()
        }
      }
      this.on("vote", voteHandler)

      // Timeout
      const timeout = setTimeout(() => {
        this.off("vote", voteHandler)
        resolve(pending.votes)
      }, this.config.voteTimeout)

      // Check if already complete
      checkComplete()
    })
  }

  private evaluateVotes(proposal: Proposal, votes: Vote[]): Decision {
    const approvalCount = votes.filter((v) => v.approved).length
    const totalVotes = votes.length

    let approved = false
    let reason = ""

    switch (this.config.mode) {
      case "unanimous":
        approved = totalVotes > 0 && approvalCount === totalVotes
        reason = approved
          ? `Unanimous approval (${approvalCount}/${totalVotes})`
          : `Not unanimous (${approvalCount}/${totalVotes} approved)`
        break

      case "majority":
        approved = totalVotes > 0 && approvalCount > totalVotes / 2
        reason = approved
          ? `Majority approved (${approvalCount}/${totalVotes})`
          : `No majority (${approvalCount}/${totalVotes} approved)`
        break

      case "single":
        approved = approvalCount >= 1
        reason = approved
          ? `At least one approval (${approvalCount}/${totalVotes})`
          : `No approvals (${totalVotes} votes)`
        break

      default:
        approved = true
        reason = "Auto-approved"
    }

    return this.createDecision(proposal, votes, approved, reason)
  }

  private createDecision(proposal: Proposal, votes: Vote[], approved: boolean, reason: string): Decision {
    return {
      proposalId: proposal.id,
      approved,
      votes,
      mode: this.config.mode,
      decidedAt: Date.now(),
      reason,
    }
  }

  private recordDecision(decision: Decision): void {
    this.decisions.push(decision)

    // Keep only last 1000 decisions
    if (this.decisions.length > 1000) {
      this.decisions = this.decisions.slice(-1000)
    }

    log.info("Decision recorded", {
      proposalId: decision.proposalId,
      approved: decision.approved,
      reason: decision.reason,
    })

    this.emit("decision", decision)
  }
}

// =============================================================================
// Config Loading
// =============================================================================

/**
 * Load consensus config from environment
 */
export function loadConsensusConfig(): Partial<ConsensusConfig> {
  const config: Partial<ConsensusConfig> = {}

  const envEnabled = process.env.CONSENSUS_ENABLED
  if (envEnabled !== undefined) {
    config.enabled = envEnabled === "true" || envEnabled === "1"
  }

  const envMode = process.env.CONSENSUS_MODE as ConsensusMode | undefined
  if (envMode && ["auto", "majority", "unanimous", "single"].includes(envMode)) {
    config.mode = envMode
  }

  const envTimeout = process.env.CONSENSUS_VOTE_TIMEOUT
  if (envTimeout) {
    const parsed = parseInt(envTimeout, 10)
    if (!isNaN(parsed) && parsed > 0) {
      config.voteTimeout = parsed
    }
  }

  const envTypes = process.env.CONSENSUS_REQUIRE_FOR
  if (envTypes) {
    config.requireApprovalFor = envTypes.split(",").map((t) => t.trim()) as ProposalType[]
  }

  return config
}

// =============================================================================
// Convenience Exports
// =============================================================================

export function getConsensusGate(): ConsensusGate {
  return ConsensusGate.getInstance()
}

export async function initConsensus(config?: Partial<ConsensusConfig>): Promise<ConsensusGate> {
  const mergedConfig = { ...loadConsensusConfig(), ...config }
  const gate = ConsensusGate.getInstance(mergedConfig)
  await gate.initialize()
  return gate
}

/**
 * Quick check if an action should proceed
 * For use in tool execution paths
 */
export async function checkApproval(input: {
  type: ProposalType
  description: string
  content: unknown
  proposer?: string
}): Promise<{ approved: boolean; reason: string }> {
  const gate = getConsensusGate()

  if (!gate.requiresApproval(input.type)) {
    return { approved: true, reason: "No approval required" }
  }

  const decision = await gate.propose({
    type: input.type,
    description: input.description,
    content: input.content,
    proposer: input.proposer ?? "system",
  })

  return {
    approved: decision.approved,
    reason: decision.reason,
  }
}
