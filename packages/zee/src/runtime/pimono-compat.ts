import { Bus } from "@/bus"
import { BusEvent } from "@/bus/bus-event"
import { Log } from "@/util/log"
import type { RuntimeCodeReference } from "./opencode-contract"
import z from "zod"

const log = Log.create({ service: "runtime:pimono-compat" })

export type PiMonoCompatSurface = "server" | "agent" | "orchestration"
export type PiMonoCompatKind = "http_bridge" | "payload_alias" | "config_alias" | "event_schema" | "retired_surface"
export type PiMonoCompatStatus = "active_temporary" | "deprecated_live" | "retired_blocked"
export type PiMonoCompatTelemetryState = "emitted" | "missing" | "not_applicable"

export type PiMonoCompatTelemetryBinding = {
  state: PiMonoCompatTelemetryState
  eventKinds: string[]
}

export type PiMonoCompatBoundary = {
  id: string
  surface: PiMonoCompatSurface
  kind: PiMonoCompatKind
  legacyInterface: string
  currentBoundary: string
  status: PiMonoCompatStatus
  exitPath: string
  telemetry: PiMonoCompatTelemetryBinding
  references: RuntimeCodeReference[]
}

export type PiMonoCompatReportTelemetry = {
  eventType: string
  metricNames: string[]
  metrics: {
    boundaryCount: number
    activeTemporaryCount: number
    deprecatedLiveCount: number
    retiredBlockedCount: number
    telemetryBackedCount: number
    missingTelemetryCount: number
  }
}

export type PiMonoCompatReport = {
  reportId: "pimono-compat-shim-boundaries"
  reportVersion: 1
  generatedAt: string
  roadmapIssue: number
  upstreamTarget: "badlogic/pi-mono"
  adapterDependencyIssue: number
  rolloutPhase: "inventory"
  boundaries: PiMonoCompatBoundary[]
  telemetry: PiMonoCompatReportTelemetry
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
    telemetryBackedCount: z.number().int().nonnegative(),
    missingTelemetryCount: z.number().int().nonnegative(),
  }),
)

const BOUNDARIES: PiMonoCompatBoundary[] = [
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
    telemetry: {
      state: "emitted",
      eventKinds: ["llm.bridge.stream.start", "llm.bridge.stream.done", "llm.bridge.stream.error"],
    },
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
    telemetry: {
      state: "emitted",
      eventKinds: ["auth.legacy_payload.accepted"],
    },
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
    exitPath:
      "Add per-call-site shim telemetry in #489, then remove the alias once operators are on permission-native config.",
    telemetry: {
      state: "missing",
      eventKinds: [],
    },
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
    telemetry: {
      state: "missing",
      eventKinds: [],
    },
    references: [
      { file: "src/swarm/events.ts", symbol: "OrchestrationEventType" },
      { file: "src/swarm/orchestrator.ts", symbol: "emitOrchestrationEvent" },
      { file: "packages/zee/src/orchestration/daemon-ipc.ts", symbol: "OrchestrationEvent" },
    ],
  },
  {
    id: "agent.persona-ids",
    surface: "agent",
    kind: "retired_surface",
    legacyInterface: "Legacy persona ids (stanley, johny, other persona-style defaults) resolving as agents",
    currentBoundary:
      "Persona ids are intentionally blocked from agent resolution and default_agent selection; the compatibility stance is explicit rejection rather than a hidden alias.",
    status: "retired_blocked",
    exitPath:
      "Keep blocked. Do not reintroduce persona-id aliasing while the runtime surface converges on Zee/OpenCode naming.",
    telemetry: {
      state: "not_applicable",
      eventKinds: [],
    },
    references: [
      { file: "packages/zee/src/agent/agent.ts", symbol: "Agent.get" },
      { file: "packages/zee/src/agent/agent.ts", symbol: "Agent.defaultAgent" },
      { file: "packages/zee/test/agent/agent.test.ts", symbol: "legacy persona ids are not registered as agents" },
    ],
  },
  {
    id: "server.personas-endpoint",
    surface: "server",
    kind: "retired_surface",
    legacyInterface: "Legacy /personas HTTP endpoint",
    currentBoundary:
      "The endpoint is intentionally absent from Zee's public server contract and returns 404; the retirement is guarded by a public-contract test.",
    status: "retired_blocked",
    exitPath:
      "Keep blocked. Any future compatibility surface should be versioned under a dedicated migration route, not by reviving /personas.",
    telemetry: {
      state: "not_applicable",
      eventKinds: [],
    },
    references: [
      { file: "packages/zee/src/server/server.ts", symbol: "Server.App" },
      {
        file: "packages/zee/test/server/public-contracts.test.ts",
        symbol: "does not expose the legacy /personas endpoint",
      },
    ],
  },
]

function buildTelemetry(boundaries: PiMonoCompatBoundary[]): PiMonoCompatReportTelemetry {
  const activeTemporaryCount = boundaries.filter((item) => item.status === "active_temporary").length
  const deprecatedLiveCount = boundaries.filter((item) => item.status === "deprecated_live").length
  const retiredBlockedCount = boundaries.filter((item) => item.status === "retired_blocked").length
  const telemetryBackedCount = boundaries.filter((item) => item.telemetry.state === "emitted").length
  const missingTelemetryCount = boundaries.filter((item) => item.telemetry.state === "missing").length

  return {
    eventType: PiMonoCompatInspected.type,
    metricNames: [
      "boundaryCount",
      "activeTemporaryCount",
      "deprecatedLiveCount",
      "retiredBlockedCount",
      "telemetryBackedCount",
      "missingTelemetryCount",
    ],
    metrics: {
      boundaryCount: boundaries.length,
      activeTemporaryCount,
      deprecatedLiveCount,
      retiredBlockedCount,
      telemetryBackedCount,
      missingTelemetryCount,
    },
  }
}

export function buildPiMonoCompatReport(now: Date = new Date()): PiMonoCompatReport {
  const boundaries = BOUNDARIES.map((boundary) => ({
    ...boundary,
    references: boundary.references.map((reference) => ({ ...reference })),
    telemetry: {
      ...boundary.telemetry,
      eventKinds: [...boundary.telemetry.eventKinds],
    },
  }))

  return {
    reportId: "pimono-compat-shim-boundaries",
    reportVersion: 1,
    generatedAt: now.toISOString(),
    roadmapIssue: 488,
    upstreamTarget: "badlogic/pi-mono",
    adapterDependencyIssue: 485,
    rolloutPhase: "inventory",
    boundaries,
    telemetry: buildTelemetry(boundaries),
  }
}

export async function emitPiMonoCompatTelemetry(report: PiMonoCompatReport): Promise<void> {
  log.info("pi-mono compatibility shim inventory inspected", {
    reportId: report.reportId,
    metrics: report.telemetry.metrics,
  })

  await Bus.publish(PiMonoCompatInspected, {
    reportId: report.reportId,
    reportVersion: report.reportVersion,
    ...report.telemetry.metrics,
  })
}

export function summarizePiMonoCompatReport(report: PiMonoCompatReport): string {
  const lines = [
    `pi-mono compatibility shim inventory v${report.reportVersion}`,
    `- boundaries: ${report.telemetry.metrics.boundaryCount} active=${report.telemetry.metrics.activeTemporaryCount} deprecated=${report.telemetry.metrics.deprecatedLiveCount} retired=${report.telemetry.metrics.retiredBlockedCount}`,
    `- telemetry: emitted=${report.telemetry.metrics.telemetryBackedCount} missing=${report.telemetry.metrics.missingTelemetryCount}`,
  ]

  for (const boundary of report.boundaries) {
    const telemetry =
      boundary.telemetry.eventKinds.length > 0 ? boundary.telemetry.eventKinds.join(", ") : boundary.telemetry.state
    lines.push(`- ${boundary.id} [${boundary.status}] telemetry=${telemetry}`)
  }

  lines.push(`- telemetry event: ${report.telemetry.eventType}`)
  return lines.join("\n")
}
