import { Bus } from "@/bus"
import { BusEvent } from "@/bus/bus-event"
import { FluxRecorder } from "@/flux"
import { Flag } from "@/flag/flag"
import { Log } from "@/util/log"
import type { RuntimeContractSurface } from "./opencode-contract"
import z from "zod"

const log = Log.create({ service: "runtime:opencode-rollout" })

const DEFAULT_PRIMARY_SURFACES: RuntimeContractSurface[] = ["cli", "orchestration", "gateway"]
const ENABLE_FLAG = "ZEE_RUNTIME_OPENCODE_SURFACES"
const FORCE_LEGACY_FLAG = "ZEE_RUNTIME_OPENCODE_FORCE_LEGACY_SURFACES"
const ALLOW_LEGACY_FALLBACK_FLAG = "ZEE_RUNTIME_OPENCODE_ALLOW_LEGACY_FALLBACK"

export type OpenCodeRuntimeRoute = "opencode_primary" | "legacy_fallback"
export type OpenCodeRuntimeRouteReason = "default_primary" | "surface_disabled" | "forced_legacy"

export type OpenCodeRuntimeRouteSelection = {
  surface: RuntimeContractSurface
  route: OpenCodeRuntimeRoute
  reason: OpenCodeRuntimeRouteReason
  allowLegacyFallback: boolean
  enabledSurfaces: RuntimeContractSurface[]
  forcedLegacySurfaces: RuntimeContractSurface[]
}

export type OpenCodeRuntimeRolloutSurface = {
  surface: RuntimeContractSurface
  route: OpenCodeRuntimeRoute
  reason: OpenCodeRuntimeRouteReason
}

export type OpenCodeRuntimeRolloutReport = {
  reportId: "opencode-runtime-rollout"
  reportVersion: 1
  generatedAt: string
  roadmapIssue: number
  upstreamTarget: "sst/opencode"
  defaultRoute: OpenCodeRuntimeRoute
  controlFlags: {
    enableFlag: typeof ENABLE_FLAG
    forceLegacyFlag: typeof FORCE_LEGACY_FLAG
    allowLegacyFallbackFlag: typeof ALLOW_LEGACY_FALLBACK_FLAG
    configuredPrimarySurfaces: RuntimeContractSurface[]
    forcedLegacySurfaces: RuntimeContractSurface[]
    allowLegacyFallback: boolean
  }
  surfaces: OpenCodeRuntimeRolloutSurface[]
  telemetry: {
    eventType: string
    fluxKinds: ["runtime.opencode.route.selected", "runtime.opencode.route.fallback"]
    metrics: {
      surfaceCount: number
      primarySurfaceCount: number
      legacySurfaceCount: number
      forcedLegacySurfaceCount: number
      allowLegacyFallback: boolean
    }
  }
}

export const OpenCodeRuntimeRolloutInspected = BusEvent.define(
  "runtime.opencode-rollout.inspected",
  z.object({
    reportId: z.literal("opencode-runtime-rollout"),
    reportVersion: z.literal(1),
    surfaceCount: z.number().int().nonnegative(),
    primarySurfaceCount: z.number().int().nonnegative(),
    legacySurfaceCount: z.number().int().nonnegative(),
    forcedLegacySurfaceCount: z.number().int().nonnegative(),
    allowLegacyFallback: z.boolean(),
  }),
)

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (!value) return fallback
  const normalized = value.trim().toLowerCase()
  if (normalized === "1" || normalized === "true" || normalized === "yes") return true
  if (normalized === "0" || normalized === "false" || normalized === "no") return false
  return fallback
}

function parseSurfaceList(value: string | undefined, fallback: RuntimeContractSurface[]): RuntimeContractSurface[] {
  if (!value?.trim()) return [...fallback]

  const allowed = new Set<RuntimeContractSurface>(DEFAULT_PRIMARY_SURFACES)
  const parsed = value
    .split(",")
    .map((item) => item.trim())
    .filter((item): item is RuntimeContractSurface => allowed.has(item as RuntimeContractSurface))

  return parsed.length > 0 ? [...new Set(parsed)] : [...fallback]
}

function describeRouteReason(reason: OpenCodeRuntimeRouteReason): string {
  switch (reason) {
    case "default_primary":
      return "surface is enabled for OpenCode primary routing"
    case "surface_disabled":
      return "surface is not enabled for OpenCode primary routing"
    case "forced_legacy":
      return "surface is pinned to the legacy fallback path"
  }
}

export function resolveOpenCodeRuntimeSurface(input: {
  client?: string
  sessionSurface?: string
} = {}): RuntimeContractSurface {
  const sessionSurface = input.sessionSurface?.trim().toLowerCase()
  if (sessionSurface === "whatsapp" || sessionSurface === "telegram") return "gateway"

  const client = input.client?.trim().toLowerCase()
  if (client === "daemon") return "orchestration"

  return "cli"
}

export function resolveOpenCodeRuntimeRoute(surface: RuntimeContractSurface): OpenCodeRuntimeRouteSelection {
  const enabledSurfaces = parseSurfaceList(Flag.ZEE_RUNTIME_OPENCODE_SURFACES, DEFAULT_PRIMARY_SURFACES)
  const forcedLegacySurfaces = parseSurfaceList(Flag.ZEE_RUNTIME_OPENCODE_FORCE_LEGACY_SURFACES, [])
  const allowLegacyFallback = parseBoolean(Flag.ZEE_RUNTIME_OPENCODE_ALLOW_LEGACY_FALLBACK, true)

  if (forcedLegacySurfaces.includes(surface)) {
    return {
      surface,
      route: "legacy_fallback",
      reason: "forced_legacy",
      allowLegacyFallback,
      enabledSurfaces,
      forcedLegacySurfaces,
    }
  }

  if (!enabledSurfaces.includes(surface)) {
    return {
      surface,
      route: "legacy_fallback",
      reason: "surface_disabled",
      allowLegacyFallback,
      enabledSurfaces,
      forcedLegacySurfaces,
    }
  }

  return {
    surface,
    route: "opencode_primary",
    reason: "default_primary",
    allowLegacyFallback,
    enabledSurfaces,
    forcedLegacySurfaces,
  }
}

export function recordOpenCodeRuntimeRoute(input: {
  surface: RuntimeContractSurface
  sessionID?: string
  messageID?: string
  providerID?: string
  modelID?: string
  traceID?: string
  requestID?: string
  metadata?: Record<string, unknown>
}): OpenCodeRuntimeRouteSelection {
  const selection = resolveOpenCodeRuntimeRoute(input.surface)
  const traceID = input.traceID ?? input.requestID ?? input.messageID ?? input.sessionID ?? crypto.randomUUID()
  const kind = selection.route === "opencode_primary" ? "runtime.opencode.route.selected" : "runtime.opencode.route.fallback"

  if (selection.route === "legacy_fallback") {
    log.warn("OpenCode primary runtime not selected", {
      surface: input.surface,
      reason: selection.reason,
      reasonDetail: describeRouteReason(selection.reason),
      [ENABLE_FLAG]: selection.enabledSurfaces.join(","),
      [FORCE_LEGACY_FLAG]: selection.forcedLegacySurfaces.join(","),
      [ALLOW_LEGACY_FALLBACK_FLAG]: selection.allowLegacyFallback,
    })
  }

  FluxRecorder.record({
    traceID,
    requestID: input.requestID,
    sessionID: input.sessionID,
    messageID: input.messageID,
    providerID: input.providerID,
    modelID: input.modelID,
    direction: "internal",
    domain: "runtime",
    kind,
    status: "ok",
    metadata: {
      surface: input.surface,
      route: selection.route,
      reason: selection.reason,
      allowLegacyFallback: selection.allowLegacyFallback,
      enabledSurfaces: selection.enabledSurfaces,
      forcedLegacySurfaces: selection.forcedLegacySurfaces,
      ...input.metadata,
    },
  })

  return selection
}

export function buildOpenCodeRuntimeRolloutReport(now: Date = new Date()): OpenCodeRuntimeRolloutReport {
  const surfaces = DEFAULT_PRIMARY_SURFACES.map((surface) => {
    const selection = resolveOpenCodeRuntimeRoute(surface)
    return {
      surface,
      route: selection.route,
      reason: selection.reason,
    }
  })
  const primarySurfaceCount = surfaces.filter((surface) => surface.route === "opencode_primary").length
  const legacySurfaceCount = surfaces.length - primarySurfaceCount
  const forcedLegacySurfaceCount = surfaces.filter((surface) => surface.reason === "forced_legacy").length
  const sample = resolveOpenCodeRuntimeRoute("cli")

  return {
    reportId: "opencode-runtime-rollout",
    reportVersion: 1,
    generatedAt: now.toISOString(),
    roadmapIssue: 486,
    upstreamTarget: "sst/opencode",
    defaultRoute: "opencode_primary",
    controlFlags: {
      enableFlag: ENABLE_FLAG,
      forceLegacyFlag: FORCE_LEGACY_FLAG,
      allowLegacyFallbackFlag: ALLOW_LEGACY_FALLBACK_FLAG,
      configuredPrimarySurfaces: sample.enabledSurfaces,
      forcedLegacySurfaces: sample.forcedLegacySurfaces,
      allowLegacyFallback: sample.allowLegacyFallback,
    },
    surfaces,
    telemetry: {
      eventType: OpenCodeRuntimeRolloutInspected.type,
      fluxKinds: ["runtime.opencode.route.selected", "runtime.opencode.route.fallback"],
      metrics: {
        surfaceCount: surfaces.length,
        primarySurfaceCount,
        legacySurfaceCount,
        forcedLegacySurfaceCount,
        allowLegacyFallback: sample.allowLegacyFallback,
      },
    },
  }
}

export async function emitOpenCodeRuntimeRolloutTelemetry(report: OpenCodeRuntimeRolloutReport): Promise<void> {
  log.info("OpenCode runtime rollout inspected", {
    reportId: report.reportId,
    defaultRoute: report.defaultRoute,
    metrics: report.telemetry.metrics,
  })

  await Bus.publish(OpenCodeRuntimeRolloutInspected, {
    reportId: report.reportId,
    reportVersion: report.reportVersion,
    surfaceCount: report.telemetry.metrics.surfaceCount,
    primarySurfaceCount: report.telemetry.metrics.primarySurfaceCount,
    legacySurfaceCount: report.telemetry.metrics.legacySurfaceCount,
    forcedLegacySurfaceCount: report.telemetry.metrics.forcedLegacySurfaceCount,
    allowLegacyFallback: report.telemetry.metrics.allowLegacyFallback,
  })
}

export function summarizeOpenCodeRuntimeRollout(report: OpenCodeRuntimeRolloutReport): string {
  const lines = [
    `OpenCode runtime rollout v${report.reportVersion}`,
    `- default=${report.defaultRoute} primary=${report.telemetry.metrics.primarySurfaceCount} legacy=${report.telemetry.metrics.legacySurfaceCount}`,
    `- flags: ${report.controlFlags.enableFlag}=${report.controlFlags.configuredPrimarySurfaces.join(",")} ${report.controlFlags.forceLegacyFlag}=${report.controlFlags.forcedLegacySurfaces.join(",") || "none"}`,
    `- fallback: ${report.controlFlags.allowLegacyFallbackFlag}=${String(report.controlFlags.allowLegacyFallback)}`,
  ]

  for (const surface of report.surfaces) {
    lines.push(`- ${surface.surface}: ${surface.route} (${surface.reason})`)
  }

  lines.push(`- telemetry: ${report.telemetry.eventType}`)
  lines.push(`- flux: ${report.telemetry.fluxKinds.join(", ")}`)
  return lines.join("\n")
}
