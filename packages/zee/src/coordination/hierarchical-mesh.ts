import { EventEmitter } from "events"
import { ProcessRegistry } from "@/process/registry"
import type { ProcessInfo } from "@/process/types"

export type HierarchicalMeshConfig = {
  enabled: boolean
  maxAgents: number
  allowCrossDomain: boolean
}

export type HierarchicalMeshNode = {
  id: string
  name: string
  type: ProcessInfo["type"]
  status: ProcessInfo["status"]
  swarmId?: string
  parentId?: string
  domain: string
  capabilities: string[]
}

export type HierarchicalMeshSnapshot = {
  enabled: boolean
  maxAgents: number
  totalAgents: number
  withinCapacity: boolean
  crossDomainLinks: number
  byDomain: Record<string, number>
  nodes: HierarchicalMeshNode[]
}

const DEFAULT_CONFIG: HierarchicalMeshConfig = {
  enabled: true,
  maxAgents: 15,
  allowCrossDomain: true,
}

function resolveDomain(process: ProcessInfo): string {
  const metadataDomain = process.metadata?.domain
  if (typeof metadataDomain === "string" && metadataDomain.trim().length > 0) {
    return metadataDomain
  }

  for (const capability of process.capabilities) {
    if (capability.startsWith("zee:invest-")) return "investing"
    if (capability.startsWith("zee:learn-")) return "learning"
    if (capability.startsWith("zee:")) return "life"
  }

  if (process.type === "daemon" || process.type === "queen") return "life"
  return "unclassified"
}

export class HierarchicalMeshCoordinator extends EventEmitter {
  private static instance: HierarchicalMeshCoordinator | null = null
  private readonly config: HierarchicalMeshConfig
  private readonly domainLinks = new Map<string, Set<string>>()

  private constructor(config: Partial<HierarchicalMeshConfig> = {}) {
    super()
    this.config = { ...DEFAULT_CONFIG, ...config }
  }

  static getInstance(config: Partial<HierarchicalMeshConfig> = {}): HierarchicalMeshCoordinator {
    if (!HierarchicalMeshCoordinator.instance) {
      HierarchicalMeshCoordinator.instance = new HierarchicalMeshCoordinator(config)
    }
    return HierarchicalMeshCoordinator.instance
  }

  static reset(): void {
    HierarchicalMeshCoordinator.instance = null
  }

  linkDomains(sourceDomain: string, targetDomain: string): void {
    if (!this.domainLinks.has(sourceDomain)) {
      this.domainLinks.set(sourceDomain, new Set())
    }
    this.domainLinks.get(sourceDomain)!.add(targetDomain)
    this.emit("mesh:link", { sourceDomain, targetDomain, timestamp: Date.now() })
  }

  routeCrossDomainMessage(input: { sourceDomain: string; targetDomain: string; topic: string }) {
    if (!this.config.enabled) {
      return { accepted: false, reason: "mesh disabled" as const }
    }
    if (!this.config.allowCrossDomain) {
      return { accepted: false, reason: "cross-domain disabled" as const }
    }

    this.linkDomains(input.sourceDomain, input.targetDomain)
    this.emit("mesh:message", {
      sourceDomain: input.sourceDomain,
      targetDomain: input.targetDomain,
      topic: input.topic,
      timestamp: Date.now(),
    })
    return { accepted: true as const, reason: "ok" as const }
  }

  snapshot(): HierarchicalMeshSnapshot {
    const registry = ProcessRegistry.getInstance()
    const processes = registry.list().filter((p) => p.type === "agent" || p.type === "worker" || p.type === "queen")
    const nodes: HierarchicalMeshNode[] = processes.map((process) => ({
      id: process.id,
      name: process.name,
      type: process.type,
      status: process.status,
      swarmId: process.swarmId,
      parentId: process.parentId,
      domain: resolveDomain(process),
      capabilities: process.capabilities,
    }))

    const byDomain: Record<string, number> = {}
    for (const node of nodes) {
      byDomain[node.domain] = (byDomain[node.domain] ?? 0) + 1
    }

    let crossDomainLinks = 0
    for (const targets of this.domainLinks.values()) {
      crossDomainLinks += targets.size
    }

    return {
      enabled: this.config.enabled,
      maxAgents: this.config.maxAgents,
      totalAgents: nodes.length,
      withinCapacity: nodes.length <= this.config.maxAgents,
      crossDomainLinks,
      byDomain,
      nodes,
    }
  }
}

export function loadHierarchicalMeshConfig(): HierarchicalMeshConfig {
  const maxAgentsRaw = process.env.ZEE_MESH_MAX_AGENTS
  const maxAgentsParsed = maxAgentsRaw ? Number.parseInt(maxAgentsRaw, 10) : NaN
  return {
    enabled: process.env.ZEE_MESH_DISABLE !== "1",
    maxAgents: Number.isFinite(maxAgentsParsed) && maxAgentsParsed > 0 ? maxAgentsParsed : DEFAULT_CONFIG.maxAgents,
    allowCrossDomain: process.env.ZEE_MESH_DISABLE_CROSS_DOMAIN !== "1",
  }
}

export function getHierarchicalMeshCoordinator(
  config: Partial<HierarchicalMeshConfig> = loadHierarchicalMeshConfig(),
): HierarchicalMeshCoordinator {
  return HierarchicalMeshCoordinator.getInstance(config)
}
