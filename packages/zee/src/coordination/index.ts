/**
 * Coordination Module
 *
 * Load balancing, consensus, and task coordination for multi-agent scenarios.
 */

// Work Stealing (load balancing)
export { WorkStealingService, loadWorkStealingConfig, getWorkStealingService, initWorkStealing } from "./work-stealing"
export type { WorkStealingConfig, WorkStealingStats, WorkStealRequest, AgentWorkload } from "./work-stealing"

// Consensus Gate (approval for side effects)
export { ConsensusGate, loadConsensusConfig, getConsensusGate, initConsensus, checkApproval } from "./consensus-gate"
export type {
  ConsensusConfig,
  ConsensusMode,
  ProposalType,
  Proposal,
  Vote,
  Decision,
  ConsensusStats,
} from "./consensus-gate"

// Hierarchical mesh (v3 swarm coordination)
export { HierarchicalMeshCoordinator, getHierarchicalMeshCoordinator, loadHierarchicalMeshConfig } from "./hierarchical-mesh"
export type { HierarchicalMeshConfig, HierarchicalMeshNode, HierarchicalMeshSnapshot } from "./hierarchical-mesh"
