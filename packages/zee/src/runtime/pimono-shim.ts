import { Log } from "@/util/log"
import { PIMONO_COMPAT_BOUNDARIES, type PiMonoCompatBoundary } from "./pimono-compat"

const log = Log.create({ service: "runtime:pimono-shim" })

const warnedBoundaries = new Set<string>()

function resolveBoundary(boundaryID: string): PiMonoCompatBoundary {
  const boundary = PIMONO_COMPAT_BOUNDARIES.find((item) => item.id === boundaryID)
  if (!boundary) {
    throw new Error(`Unknown pi-mono shim boundary: ${boundaryID}`)
  }
  return boundary
}

export function recordPiMonoShimUsage(input: {
  boundaryID: string
  traceID?: string
  requestID?: string
  sessionID?: string
  messageID?: string
  providerID?: string
  modelID?: string
  dedupeKey?: string
  metadata?: Record<string, unknown>
}) {
  const boundary = resolveBoundary(input.boundaryID)

  if (!warnedBoundaries.has(boundary.id)) {
    warnedBoundaries.add(boundary.id)
    log.warn("pi-mono compatibility shim invoked", {
      boundaryID: boundary.id,
      surface: boundary.surface,
      kind: boundary.kind,
      status: boundary.status,
      legacyInterface: boundary.legacyInterface,
      exitPath: boundary.exitPath,
    })
  }

  return boundary
}
