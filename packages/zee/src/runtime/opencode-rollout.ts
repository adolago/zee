import { Bus } from "@/bus"
import { BusEvent } from "@/bus/bus-event"
import { FluxRecorder, type FluxEvent } from "@/flux"
import { Flag } from "@/flag/flag"
import { Log } from "@/util/log"
import type { RuntimeContractSurface } from "./opencode-contract"
import z from "zod"

const log = Log.create({ service: "runtime:opencode-rollout" })

const DEFAULT_PRIMARY_SURFACES: RuntimeContractSurface[] = ["cli", "orchestration", "gateway"]
const ROUTE_FLUX_KINDS = ["runtime.opencode.route.selected", "runtime.opencode.route.fallback"] as const
const ROLLOUT_WINDOW_HOURS = 24
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

export type OpenCodeRuntimeFallbackSlo = {
  maxFallbackRate: number
  maxFallbackEvents: number
}

export type OpenCodeRuntimeFallbackBreach = {
  surface: RuntimeContractSurface
  route: OpenCodeRuntimeRoute
  reason: OpenCodeRuntimeRouteReason
  fallbackEvents: number
  fallbackRate: number
  maxFallbackRate: number
  maxFallbackEvents: number
  breachReasons: string[]
}

export type OpenCodeRuntimeParitySurface = OpenCodeRuntimeRolloutSurface & {
  selectedEvents: number
  fallbackEvents: number
  routeEvents: number
  fallbackRate: number
  lastSelectedAt?: string
  lastFallbackAt?: string
  reasons: Record<OpenCodeRuntimeRouteReason, number>
  slo: OpenCodeRuntimeFallbackSlo & {
    status: "ok" | "breach" | "no_traffic"
  }
}

export type OpenCodeRuntimeReleaseGate = {
  id: "runtime.opencode-parity"
  ok: boolean
  details: string
  breachCount: number
  fallbackEvents: number
  routeEvents: number
  windowHours: number
}

export type OpenCodeRuntimeRolloutReport = {
  reportId: "opencode-runtime-rollout"
  reportVersion: 1
  generatedAt: string
  roadmapIssue: 487
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
  parityWindow: {
    hours: number
    startedAt: string
    endedAt: string
  }
  parity: {
    routeEvents: number
    selectedEvents: number
    fallbackEvents: number
    fallbackRate: number
    releaseReady: boolean
    breaches: OpenCodeRuntimeFallbackBreach[]
    surfaces: OpenCodeRuntimeParitySurface[]
  }
  rollback: {
    recommended: boolean
    command: string
    reason: string
    runbook: string[]
  }
  telemetry: {
    eventType: string
    fluxKinds: typeof ROUTE_FLUX_KINDS
    metrics: {
      surfaceCount: number
      primarySurfaceCount: number
      legacySurfaceCount: number
      forcedLegacySurfaceCount: number
      routeEventCount: number
      fallbackEventCount: number
      breachCount: number
      releaseReady: boolean
      windowHours: number
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
    routeEventCount: z.number().int().nonnegative(),
    fallbackEventCount: z.number().int().nonnegative(),
    breachCount: z.number().int().nonnegative(),
    releaseReady: z.boolean(),
    windowHours: z.number().int().positive(),
    allowLegacyFallback: z.boolean(),
  }),
)

const FALLBACK_SLO_THRESHOLDS: Record<RuntimeContractSurface, OpenCodeRuntimeFallbackSlo> = {
  cli: { maxFallbackRate: 0, maxFallbackEvents: 0 },
  orchestration: { maxFallbackRate: 0, maxFallbackEvents: 0 },
  gateway: { maxFallbackRate: 0, maxFallbackEvents: 0 },
}

function createReasonCounts(): Record<OpenCodeRuntimeRouteReason, number> {
  return {
    default_primary: 0,
    surface_disabled: 0,
    forced_legacy: 0,
  }
}

function isRuntimeContractSurface(value: unknown): value is RuntimeContractSurface {
  return value === "cli" || value === "orchestration" || value === "gateway"
}

function isOpenCodeRuntimeRouteReason(value: unknown): value is OpenCodeRuntimeRouteReason {
  return value === "default_primary" || value === "surface_disabled" || value === "forced_legacy"
}

function toIsoTimestamp(timestamp: number | undefined): string | undefined {
  return typeof timestamp === "number" ? new Date(timestamp).toISOString() : undefined
}

function listFluxEventsPaginated(query: {
  kind: (typeof ROUTE_FLUX_KINDS)[number]
  from: number
  to: number
}): FluxEvent[] {
  const events: FluxEvent[] = []
  let offset = 0

  while (true) {
    const page = FluxRecorder.list({
      domain: "runtime",
      kind: query.kind,
      from: query.from,
      to: query.to,
      limit: 1000,
      offset,
    })

    events.push(...page.events)
    if (page.events.length < 1000) break
    offset += page.events.length
  }

  return events
}

function collectOpenCodeRuntimeRouteEvents(windowStart: number, windowEnd: number): FluxEvent[] {
  return ROUTE_FLUX_KINDS.flatMap((kind) =>
    listFluxEventsPaginated({
      kind,
      from: windowStart,
      to: windowEnd,
    }),
  )
}

function buildSurfaceParity(input: {
  surfaces: OpenCodeRuntimeRolloutSurface[]
  routeEvents: FluxEvent[]
}): {
  surfaces: OpenCodeRuntimeParitySurface[]
  breaches: OpenCodeRuntimeFallbackBreach[]
  routeEvents: number
  selectedEvents: number
  fallbackEvents: number
  fallbackRate: number
  releaseReady: boolean
} {
  const eventsBySurface = new Map<RuntimeContractSurface, FluxEvent[]>()
  for (const surface of DEFAULT_PRIMARY_SURFACES) {
    eventsBySurface.set(surface, [])
  }

  let selectedEvents = 0
  let fallbackEvents = 0

  for (const event of input.routeEvents) {
    if (event.kind === "runtime.opencode.route.selected") selectedEvents++
    if (event.kind === "runtime.opencode.route.fallback") fallbackEvents++

    const surface = event.metadata?.surface
    if (!isRuntimeContractSurface(surface)) continue
    eventsBySurface.get(surface)?.push(event)
  }

  const paritySurfaces = input.surfaces.map((surface) => {
    const events = eventsBySurface.get(surface.surface) ?? []
    const selectedForSurface = events.filter((event) => event.kind === "runtime.opencode.route.selected")
    const fallbackForSurface = events.filter((event) => event.kind === "runtime.opencode.route.fallback")
    const reasons = createReasonCounts()

    for (const event of events) {
      const reason = event.metadata?.reason
      if (isOpenCodeRuntimeRouteReason(reason)) {
        reasons[reason]++
      }
    }

    const routeEvents = events.length
    const fallbackRate = routeEvents > 0 ? fallbackForSurface.length / routeEvents : 0
    const threshold = FALLBACK_SLO_THRESHOLDS[surface.surface]
    const forcedLegacyBreach = surface.route === "legacy_fallback"
    const countBreach = fallbackForSurface.length > threshold.maxFallbackEvents
    const rateBreach = fallbackRate > threshold.maxFallbackRate
    const breached = forcedLegacyBreach || countBreach || rateBreach
    const status: OpenCodeRuntimeParitySurface["slo"]["status"] =
      routeEvents === 0 && !breached ? "no_traffic" : breached ? "breach" : "ok"

    return {
      surface: surface.surface,
      route: surface.route,
      reason: surface.reason,
      selectedEvents: selectedForSurface.length,
      fallbackEvents: fallbackForSurface.length,
      routeEvents,
      fallbackRate,
      lastSelectedAt: toIsoTimestamp(selectedForSurface.at(-1)?.timestamp),
      lastFallbackAt: toIsoTimestamp(fallbackForSurface.at(-1)?.timestamp),
      reasons,
      slo: {
        ...threshold,
        status,
      },
    }
  })

  const breaches = paritySurfaces
    .filter((surface) => surface.slo.status === "breach")
    .map((surface) => {
      const breachReasons: string[] = []
      if (surface.route === "legacy_fallback") {
        breachReasons.push("surface is not routed to the OpenCode primary path")
      }
      if (surface.fallbackEvents > surface.slo.maxFallbackEvents) {
        breachReasons.push(`fallback events ${surface.fallbackEvents} exceed limit ${surface.slo.maxFallbackEvents}`)
      }
      if (surface.fallbackRate > surface.slo.maxFallbackRate) {
        breachReasons.push(`fallback rate ${(surface.fallbackRate * 100).toFixed(1)}% exceeds ${(surface.slo.maxFallbackRate * 100).toFixed(1)}%`)
      }

      return {
        surface: surface.surface,
        route: surface.route,
        reason: surface.reason,
        fallbackEvents: surface.fallbackEvents,
        fallbackRate: surface.fallbackRate,
        maxFallbackRate: surface.slo.maxFallbackRate,
        maxFallbackEvents: surface.slo.maxFallbackEvents,
        breachReasons,
      }
    })

  const routeEventCount = input.routeEvents.length

  return {
    surfaces: paritySurfaces,
    breaches,
    routeEvents: routeEventCount,
    selectedEvents,
    fallbackEvents,
    fallbackRate: routeEventCount > 0 ? fallbackEvents / routeEventCount : 0,
    releaseReady: breaches.length === 0,
  }
}

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

export function buildOpenCodeRuntimeRolloutReport(
  now: Date = new Date(),
  options: {
    routeEvents?: FluxEvent[]
  } = {},
): OpenCodeRuntimeRolloutReport {
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
  const windowEnd = now.getTime()
  const windowStart = windowEnd - ROLLOUT_WINDOW_HOURS * 60 * 60 * 1000
  const routeEvents = options.routeEvents ?? collectOpenCodeRuntimeRouteEvents(windowStart, windowEnd)
  const parity = buildSurfaceParity({
    surfaces,
    routeEvents,
  })
  const rollbackCommand = `export ${FORCE_LEGACY_FLAG}=cli,orchestration,gateway`
  const rollbackReason =
    parity.breaches.length > 0
      ? `fallback SLO breach on ${parity.breaches.map((breach) => breach.surface).join(", ")}`
      : "OpenCode primary parity is within the fallback SLO for all tracked surfaces."

  return {
    reportId: "opencode-runtime-rollout",
    reportVersion: 1,
    generatedAt: now.toISOString(),
    roadmapIssue: 487,
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
    parityWindow: {
      hours: ROLLOUT_WINDOW_HOURS,
      startedAt: new Date(windowStart).toISOString(),
      endedAt: now.toISOString(),
    },
    parity,
    rollback: {
      recommended: parity.breaches.length > 0,
      command: rollbackCommand,
      reason: rollbackReason,
      runbook: [
        `1. Execute \`${rollbackCommand}\` to pin all tracked surfaces to the legacy fallback path.`,
        `2. Keep ${ALLOW_LEGACY_FALLBACK_FLAG}=true while parity or control-plane regressions are investigated.`,
        "3. Restart Zee server and daemon workers so the updated route controls take effect everywhere.",
        "4. Re-run `zee inspect runtime-rollout --no-json` and confirm the breach surfaces are now explicitly forced to legacy.",
        "5. Fix the parity gap, clear the forced-legacy override, and require `zee v3 release --strict` to pass before resuming rollout.",
      ],
    },
    telemetry: {
      eventType: OpenCodeRuntimeRolloutInspected.type,
      fluxKinds: ROUTE_FLUX_KINDS,
      metrics: {
        surfaceCount: surfaces.length,
        primarySurfaceCount,
        legacySurfaceCount,
        forcedLegacySurfaceCount,
        routeEventCount: parity.routeEvents,
        fallbackEventCount: parity.fallbackEvents,
        breachCount: parity.breaches.length,
        releaseReady: parity.releaseReady,
        windowHours: ROLLOUT_WINDOW_HOURS,
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
    routeEventCount: report.telemetry.metrics.routeEventCount,
    fallbackEventCount: report.telemetry.metrics.fallbackEventCount,
    breachCount: report.telemetry.metrics.breachCount,
    releaseReady: report.telemetry.metrics.releaseReady,
    windowHours: report.telemetry.metrics.windowHours,
    allowLegacyFallback: report.telemetry.metrics.allowLegacyFallback,
  })
}

export function buildOpenCodeRuntimeReleaseGate(report: OpenCodeRuntimeRolloutReport): OpenCodeRuntimeReleaseGate {
  const forcedLegacyCount = report.surfaces.filter((surface) => surface.route === "legacy_fallback").length

  return {
    id: "runtime.opencode-parity",
    ok: report.parity.releaseReady,
    details:
      `window=${report.parityWindow.hours}h route-events=${report.parity.routeEvents} ` +
      `fallback=${report.parity.fallbackEvents} breaches=${report.parity.breaches.length} forced-legacy=${forcedLegacyCount}`,
    breachCount: report.parity.breaches.length,
    fallbackEvents: report.parity.fallbackEvents,
    routeEvents: report.parity.routeEvents,
    windowHours: report.parityWindow.hours,
  }
}

export function summarizeOpenCodeRuntimeRollout(report: OpenCodeRuntimeRolloutReport): string {
  const fallbackRate = `${(report.parity.fallbackRate * 100).toFixed(1)}%`
  const lines = [
    `OpenCode runtime rollout v${report.reportVersion}`,
    `- default=${report.defaultRoute} primary=${report.telemetry.metrics.primarySurfaceCount} legacy=${report.telemetry.metrics.legacySurfaceCount}`,
    `- flags: ${report.controlFlags.enableFlag}=${report.controlFlags.configuredPrimarySurfaces.join(",")} ${report.controlFlags.forceLegacyFlag}=${report.controlFlags.forcedLegacySurfaces.join(",") || "none"}`,
    `- fallback: ${report.controlFlags.allowLegacyFallbackFlag}=${String(report.controlFlags.allowLegacyFallback)}`,
    `- parity: window=${report.parityWindow.hours}h route-events=${report.parity.routeEvents} fallback=${report.parity.fallbackEvents} rate=${fallbackRate} breaches=${report.parity.breaches.length} release=${report.parity.releaseReady ? "ready" : "blocked"}`,
  ]

  for (const surface of report.parity.surfaces) {
    lines.push(
      `- ${surface.surface}: ${surface.route} (${surface.reason}) selected=${surface.selectedEvents} fallback=${surface.fallbackEvents} rate=${(surface.fallbackRate * 100).toFixed(1)}% slo<=${surface.slo.maxFallbackEvents}/${(surface.slo.maxFallbackRate * 100).toFixed(1)}% status=${surface.slo.status}`,
    )
  }

  lines.push(`- rollback: ${report.rollback.recommended ? "recommended" : "not-required"} :: ${report.rollback.reason}`)
  lines.push(`- telemetry: ${report.telemetry.eventType}`)
  lines.push(`- flux: ${report.telemetry.fluxKinds.join(", ")}`)
  return lines.join("\n")
}
