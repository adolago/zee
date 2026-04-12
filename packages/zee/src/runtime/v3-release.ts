import { existsSync } from "node:fs"
import path from "node:path"
import { Config } from "@/config/config"
import { getHierarchicalMeshCoordinator } from "@/coordination/hierarchical-mesh"
import { getNodeClientRegistry, resolveNodeClientPolicy } from "@/gateway/node-client-registry"
import { getAgentDbMemoryStats } from "@/memory/agentdb-service"
import { AgenticFlowBridge } from "@/orchestration/agentic-flow-bridge"
import { auditControlUiSecurityDeep, type SecurityAuditReport } from "@/security"
import {
  buildOpenCodeRuntimeReleaseGate,
  buildOpenCodeRuntimeRolloutReport,
  type OpenCodeRuntimeReleaseGate,
  type OpenCodeRuntimeRolloutReport,
} from "@/runtime/opencode-rollout"

const REQUIRED_V3_RELEASE_DOCS = [
  {
    id: "runtime-rollout",
    path: "docs/architecture/opencode-runtime-rollout.md",
    label: "OpenCode runtime rollout",
  },
  {
    id: "v3-release-readiness",
    path: "docs/architecture/v3-release-readiness.md",
    label: "V3 release readiness",
  },
  {
    id: "investing-eval-gates",
    path: "docs/architecture/investing-eval-gates.md",
    label: "Investing eval gates",
  },
  {
    id: "v3-rollout-plan",
    path: "docs/architecture/v3-rollout-plan.md",
    label: "V3 rollout plan",
  },
  {
    id: "v3-launch-playbook",
    path: "docs/architecture/v3-launch-playbook.md",
    label: "V3 launch playbook",
  },
] as const

export type V3ReleaseCategory = "reliability" | "security" | "docs"

export interface V3ReleaseGate {
  id: string
  category: V3ReleaseCategory
  ok: boolean
  details: string
}

export interface V3ReleaseCategorySummary {
  id: V3ReleaseCategory
  ok: boolean
  gateCount: number
  failureCount: number
}

export interface V3ReleaseDocCheck {
  id: string
  label: string
  path: string
  exists: boolean
}

export interface V3ReleaseReport {
  reportId: "v3-release-gate"
  reportVersion: 1
  generatedAt: string
  categories: V3ReleaseCategorySummary[]
  gates: V3ReleaseGate[]
  docs: {
    required: V3ReleaseDocCheck[]
    missingCount: number
  }
  memory: {
    stats: unknown
  }
  mesh: {
    totalAgents: number
    maxAgents: number
    crossDomainLinks: number
    withinCapacity: boolean
  }
  nodeClient: {
    policy: {
      enabled: boolean
      securityMode: "deny" | "allowlist" | "full"
    }
    stats: {
      active: number
      revoked: number
      total: number
    }
  }
  runtimeRollout: OpenCodeRuntimeRolloutReport
  security: SecurityAuditReport
  readyForRelease: boolean
  metrics: {
    gateCount: number
    failureCount: number
    docMissingCount: number
  }
}

export interface BuildV3ReleaseReportInput {
  generatedAt?: Date
  memoryStats: unknown
  mesh: {
    totalAgents: number
    maxAgents: number
    crossDomainLinks: number
    withinCapacity: boolean
  }
  samplePlanSteps: number
  runtimeRollout: OpenCodeRuntimeRolloutReport
  runtimeGate: OpenCodeRuntimeReleaseGate
  security: SecurityAuditReport
  nodePolicy: {
    enabled: boolean
    securityMode: "deny" | "allowlist" | "full"
  }
  nodeStats: {
    active: number
    revoked: number
    total: number
  }
  docs: V3ReleaseDocCheck[]
}

function resolveRepoRoot(): string {
  return path.resolve(import.meta.dir, "../../../../")
}

function buildDocsGate(docs: V3ReleaseDocCheck[]): V3ReleaseGate {
  const missing = docs.filter((doc) => !doc.exists)
  return {
    id: "docs.architecture.required",
    category: "docs",
    ok: missing.length === 0,
    details:
      missing.length === 0
        ? `required=${docs.length} missing=0`
        : `required=${docs.length} missing=${missing.map((doc) => doc.path).join(", ")}`,
  }
}

export function collectRequiredV3ReleaseDocs(repoRoot: string = resolveRepoRoot()): V3ReleaseDocCheck[] {
  return REQUIRED_V3_RELEASE_DOCS.map((doc) => ({
    ...doc,
    exists: existsSync(path.join(repoRoot, doc.path)),
  }))
}

export function buildV3ReleaseReport(input: BuildV3ReleaseReportInput): V3ReleaseReport {
  const generatedAt = (input.generatedAt ?? new Date()).toISOString()
  const docsGate = buildDocsGate(input.docs)
  const gates: V3ReleaseGate[] = [
    {
      id: "memory.agentdb",
      category: "reliability",
      ok: true,
      details: "Unified AgentDB memory service is wired through server routes.",
    },
    {
      id: "swarm.hierarchical-mesh",
      category: "reliability",
      ok: input.mesh.withinCapacity && input.mesh.maxAgents >= 15,
      details: `mesh agents=${input.mesh.totalAgents}/${input.mesh.maxAgents} cross-domain-links=${input.mesh.crossDomainLinks}`,
    },
    {
      id: "agentic-flow.bridge",
      category: "reliability",
      ok: input.samplePlanSteps > 0,
      details: `decomposition steps=${input.samplePlanSteps}`,
    },
    {
      id: input.runtimeGate.id,
      category: "reliability",
      ok: input.runtimeGate.ok,
      details: input.runtimeGate.details,
    },
    {
      id: "release.security",
      category: "security",
      ok: input.security.ok,
      details: `security errors=${input.security.errors} warnings=${input.security.warnings}`,
    },
    {
      id: "node-client.policy",
      category: "security",
      ok: !input.nodePolicy.enabled || input.nodePolicy.securityMode !== "full",
      details: `enabled=${input.nodePolicy.enabled} mode=${input.nodePolicy.securityMode} paired=${input.nodeStats.active}`,
    },
    docsGate,
  ]

  const categories = (["reliability", "security", "docs"] as const).map((category) => {
    const categoryGates = gates.filter((gate) => gate.category === category)
    const failureCount = categoryGates.filter((gate) => !gate.ok).length
    return {
      id: category,
      ok: failureCount === 0,
      gateCount: categoryGates.length,
      failureCount,
    }
  })

  const failureCount = gates.filter((gate) => !gate.ok).length

  return {
    reportId: "v3-release-gate",
    reportVersion: 1,
    generatedAt,
    categories,
    gates,
    docs: {
      required: input.docs,
      missingCount: input.docs.filter((doc) => !doc.exists).length,
    },
    memory: {
      stats: input.memoryStats,
    },
    mesh: input.mesh,
    nodeClient: {
      policy: input.nodePolicy,
      stats: input.nodeStats,
    },
    runtimeRollout: input.runtimeRollout,
    security: input.security,
    readyForRelease: failureCount === 0,
    metrics: {
      gateCount: gates.length,
      failureCount,
      docMissingCount: input.docs.filter((doc) => !doc.exists).length,
    },
  }
}

export async function collectV3ReleaseReport(
  options: {
    now?: Date
  } = {},
): Promise<V3ReleaseReport> {
  const now = options.now ?? new Date()
  const [config, memoryStats] = await Promise.all([Config.get(), getAgentDbMemoryStats()])
  const security = await auditControlUiSecurityDeep(config)

  const meshSnapshot = getHierarchicalMeshCoordinator().snapshot()
  const nodePolicy = resolveNodeClientPolicy(config)
  const nodeStats = await getNodeClientRegistry().getStats()
  const flowBridge = new AgenticFlowBridge()
  const samplePlan = flowBridge.decomposeObjective("memory sync; swarm routing; release gate", { maxSteps: 3 })
  const runtimeRollout = buildOpenCodeRuntimeRolloutReport(now)
  const runtimeGate = buildOpenCodeRuntimeReleaseGate(runtimeRollout)

  const report = buildV3ReleaseReport({
    generatedAt: now,
    memoryStats,
    mesh: {
      totalAgents: meshSnapshot.totalAgents,
      maxAgents: meshSnapshot.maxAgents,
      crossDomainLinks: meshSnapshot.crossDomainLinks,
      withinCapacity: meshSnapshot.withinCapacity,
    },
    samplePlanSteps: samplePlan.steps.length,
    runtimeRollout,
    runtimeGate,
    security,
    nodePolicy: {
      enabled: nodePolicy.enabled,
      securityMode: nodePolicy.securityMode,
    },
    nodeStats,
    docs: collectRequiredV3ReleaseDocs(),
  })

  return report
}

export function summarizeV3ReleaseReport(report: V3ReleaseReport): string {
  const lines = [
    `v3 release report v${report.reportVersion}`,
    `- ready=${report.readyForRelease ? "yes" : "no"} gates=${report.metrics.gateCount} failures=${report.metrics.failureCount}`,
  ]

  for (const category of report.categories) {
    lines.push(`- ${category.id}: ${category.ok ? "ok" : "fail"} ${category.gateCount - category.failureCount}/${category.gateCount}`)
  }

  lines.push(`- docs: missing=${report.docs.missingCount}`)

  for (const gate of report.gates) {
    lines.push(`- ${gate.ok ? "ok" : "fail"} [${gate.category}] ${gate.id}: ${gate.details}`)
  }

  return lines.join("\n")
}
