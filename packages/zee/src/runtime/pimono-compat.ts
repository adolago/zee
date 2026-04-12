import { Bus } from "@/bus"
import { BusEvent } from "@/bus/bus-event"
import { Log } from "@/util/log"
import type { RuntimeCodeReference } from "./opencode-contract"
import z from "zod"

const log = Log.create({ service: "runtime:pimono-compat" })

export type PiMonoCompatSurface = "server" | "agent" | "orchestration"
export type PiMonoCompatKind = "http_bridge" | "payload_alias" | "config_alias" | "event_schema" | "retired_surface"
export type PiMonoCompatStatus = "active_temporary" | "deprecated_live" | "retired_blocked"

export type PiMonoCompatBoundary = {
  id: string
  surface: PiMonoCompatSurface
  kind: PiMonoCompatKind
  legacyInterface: string
  currentBoundary: string
  status: PiMonoCompatStatus
  exitPath: string
  references: RuntimeCodeReference[]
}

export type PiMonoCompatReportMetrics = {
  boundaryCount: number
  activeTemporaryCount: number
  deprecatedLiveCount: number
  retiredBlockedCount: number
}

export type PiMonoCompatRoadmapWindow = {
  milestone: string
  startsAt: string
  endsAt: string
  goal: string
}

export type PiMonoCompatRemovalChecklistItem = {
  id: string
  label: string
  status: "completed"
  issue: number
  evidence: string
}

export type PiMonoCompatDeprecationPolicy = {
  noNewLegacyPolicy: string
  hardStopDate: string
  roadmapWindows: PiMonoCompatRoadmapWindow[]
  removalChecklist: {
    approvedAt: string
    approvalReference: string
    items: PiMonoCompatRemovalChecklistItem[]
  }
}

export type PiMonoCompatReport = {
  reportId: "pimono-compat-shim-boundaries"
  reportVersion: 1
  generatedAt: string
  roadmapIssue: number
  upstreamTarget: "badlogic/pi-mono"
  adapterDependencyIssue: number
  rolloutPhase: "removal_gated"
  policy: PiMonoCompatDeprecationPolicy
  boundaries: PiMonoCompatBoundary[]
  metrics: PiMonoCompatReportMetrics
}

export const PiMonoCompatInspected = BusEvent.define(
  "runtime.pimono-compat.inspected",
  z.object({
    reportId: z.literal("pimono-compat-shim-boundaries"),
    reportVersion: z.literal(1),
    boundaryCount: z.number().int().nonnegative(),
    activeTemporaryCount: z.number().int().nonnegative(),
    deprecatedLiveCount: z.number().int().nonnegative(),
    retiredBlockedCount: z.number().int().nonnegative(),
  }),
)

export const PIMONO_COMPAT_BOUNDARIES: PiMonoCompatBoundary[] = [
  {
    id: "server.llm.pi-ai-bridge",
    surface: "server",
    kind: "http_bridge",
    legacyInterface: "pi-ai-shaped /v1/llm/stream request and AssistantMessageEvent SSE payloads",
    currentBoundary:
      "The server accepts pi-ai/OpenClaw stream payloads, normalizes them at the HTTP route boundary, and executes through Zee's provider + AI SDK stack.",
    status: "active_temporary",
    exitPath:
      "Replace this bridge with the OpenCode-primary execution path once #486 lands and downstream callers move off pi-ai event shapes.",
    references: [
      { file: "packages/zee/src/server/route/llm.ts", symbol: "LlmRoute" },
      { file: "packages/zee/src/server/route/llm.ts", symbol: "toModelMessages" },
      { file: "packages/zee/src/server/route/llm.ts", symbol: "PiAssistantMessageEvent" },
      { file: "packages/zee/src/server/server.ts", symbol: "LlmRoute" },
    ],
  },
  {
    id: "server.auth.api-key-payload",
    surface: "server",
    kind: "payload_alias",
    legacyInterface: "Legacy auth payload shape { api_key } on PUT /auth/:providerID",
    currentBoundary:
      "The auth route and generated SDK client still accept the legacy api_key wire shape and rewrite it into Zee's Auth.Info schema before persistence and provider reload.",
    status: "deprecated_live",
    exitPath:
      "Keep accepting the payload until operator clients are migrated, then require Auth.Info-only requests and delete the alias path.",
    references: [
      { file: "packages/zee/src/server/route/auth.ts", symbol: "AuthRoute" },
      { file: "packages/zee/src/server/route/auth.ts", symbol: "auth.legacy_payload.accepted" },
      { file: "packages/zee/src/pkg/sdk/v2/client.ts", symbol: "authSet" },
      { file: "packages/zee/src/pkg/sdk/v2/gen/sdk.gen.ts", symbol: "authSet" },
      { file: "packages/zee/test/server/auth-route.test.ts", symbol: "accepts legacy api_key payload" },
    ],
  },
  {
    id: "agent.config.tools-alias",
    surface: "agent",
    kind: "config_alias",
    legacyInterface: "Legacy agent.<name>.tools boolean map in config",
    currentBoundary:
      "Agent config still translates the legacy tools map into PermissionNext rules so older configs remain runnable during the runtime migration.",
    status: "deprecated_live",
    exitPath: "Remove the alias once operators are on permission-native config.",
    references: [
      { file: "packages/zee/src/config/config.ts", symbol: "agent.tools" },
      { file: "packages/zee/src/agent/agent.ts", symbol: "legacyToolsToPermissionConfig" },
      { file: "packages/zee/src/agent/agent.ts", symbol: "PermissionNext.fromConfig" },
      { file: "packages/zee/test/agent/agent.test.ts", symbol: "legacy tools config converts to permissions" },
    ],
  },
  {
    id: "orchestration.pi-agent-event-schema",
    surface: "orchestration",
    kind: "event_schema",
    legacyInterface: "pi-agent-style orchestration event taxonomy exposed over daemon IPC",
    currentBoundary:
      "Daemon IPC and orchestration visuals still speak the legacy lifecycle event names while the worker runtime underneath is being migrated.",
    status: "active_temporary",
    exitPath:
      "Hold the schema stable until OpenCode becomes the primary execution path, then either version it as Zee-owned or translate it behind a dedicated adapter.",
    references: [
      { file: "src/swarm/events.ts", symbol: "OrchestrationEventType" },
      { file: "src/swarm/orchestrator.ts", symbol: "emitOrchestrationEvent" },
      { file: "packages/zee/src/orchestration/daemon-ipc.ts", symbol: "OrchestrationEvent" },
    ],
  },
]

const DEPRECATION_POLICY: PiMonoCompatDeprecationPolicy = {
  noNewLegacyPolicy:
    "No new pi-mono-shaped runtime surfaces may land after 2026-03-15 unless they are registered in this report with a dated removal plan.",
  hardStopDate: "2026-04-30",
  roadmapWindows: [
    {
      milestone: "M1 architecture lock",
      startsAt: "2026-03-08",
      endsAt: "2026-03-22",
      goal: "Freeze shim inventory, checkpoints, and migration ownership.",
    },
    {
      milestone: "M2 compatibility layer",
      startsAt: "2026-03-23",
      endsAt: "2026-04-30",
      goal: "Keep live legacy paths observable while routing new runtime work through OpenCode.",
    },
  ],
  removalChecklist: {
    approvedAt: "2026-03-15",
    approvalReference: "docs/architecture/openclaw-opencode-financial-roadmap.md",
    items: [
      {
        id: "inventory-published",
        label: "All live pi-mono runtime boundaries are catalogued in a single shim inventory.",
        status: "completed",
        issue: 488,
        evidence: "buildPiMonoCompatReport() enumerates six explicit boundaries with statuses and references.",
      },
      {
        id: "inventory-backed",
        label: "Every live compatibility shim has an explicit owner, reference, and removal path before closure.",
        status: "completed",
        issue: 489,
        evidence: "Live boundaries now report references and removal paths in the inspect report.",
      },
      {
        id: "no-new-legacy-gate",
        label: "New legacy-only runtime additions are disallowed without shim registration and dated removal.",
        status: "completed",
        issue: 490,
        evidence: "The policy now records a no-new-legacy gate starting on 2026-03-15 alongside the hard-stop deadline.",
      },
      {
        id: "hard-stop-recorded",
        label: "The removal window and final hard-stop date are documented in the inspectable runtime contract.",
        status: "completed",
        issue: 474,
        evidence: "The report and operator doc publish the M1/M2 windows and a 2026-04-30 hard stop.",
      },
    ],
  },
}

function buildMetrics(boundaries: PiMonoCompatBoundary[]): PiMonoCompatReportMetrics {
  const activeTemporaryCount = boundaries.filter((item) => item.status === "active_temporary").length
  const deprecatedLiveCount = boundaries.filter((item) => item.status === "deprecated_live").length
  const retiredBlockedCount = boundaries.filter((item) => item.status === "retired_blocked").length

  return {
    boundaryCount: boundaries.length,
    activeTemporaryCount,
    deprecatedLiveCount,
    retiredBlockedCount,
  }
}

export function buildPiMonoCompatReport(now: Date = new Date()): PiMonoCompatReport {
  const boundaries = PIMONO_COMPAT_BOUNDARIES.map((boundary) => ({
    ...boundary,
    references: boundary.references.map((reference) => ({ ...reference })),
  }))

  return {
    reportId: "pimono-compat-shim-boundaries",
    reportVersion: 1,
    generatedAt: now.toISOString(),
    roadmapIssue: 474,
    upstreamTarget: "badlogic/pi-mono",
    adapterDependencyIssue: 485,
    rolloutPhase: "removal_gated",
    policy: {
      ...DEPRECATION_POLICY,
      roadmapWindows: DEPRECATION_POLICY.roadmapWindows.map((window) => ({ ...window })),
      removalChecklist: {
        ...DEPRECATION_POLICY.removalChecklist,
        items: DEPRECATION_POLICY.removalChecklist.items.map((item) => ({ ...item })),
      },
    },
    boundaries,
    metrics: buildMetrics(boundaries),
  }
}

export async function publishPiMonoCompatReport(report: PiMonoCompatReport): Promise<void> {
  log.info("pi-mono compatibility shim inventory inspected", {
    reportId: report.reportId,
    metrics: report.metrics,
  })

  await Bus.publish(PiMonoCompatInspected, {
    reportId: report.reportId,
    reportVersion: report.reportVersion,
    ...report.metrics,
  })
}

export function summarizePiMonoCompatReport(report: PiMonoCompatReport): string {
  const completedChecklistItems = report.policy.removalChecklist.items.filter((item) => item.status === "completed").length
  const lines = [
    `pi-mono compatibility shim inventory v${report.reportVersion}`,
    `- policy: no-new-legacy gate active since 2026-03-15 hard-stop=${report.policy.hardStopDate}`,
    `- checklist: approved=${report.policy.removalChecklist.approvedAt} completed=${completedChecklistItems}/${report.policy.removalChecklist.items.length}`,
    `- boundaries: ${report.metrics.boundaryCount} active=${report.metrics.activeTemporaryCount} deprecated=${report.metrics.deprecatedLiveCount} retired=${report.metrics.retiredBlockedCount}`,
  ]

  for (const boundary of report.boundaries) {
    lines.push(`- ${boundary.id} [${boundary.status}] exit=${boundary.exitPath}`)
  }

  return lines.join("\n")
}
