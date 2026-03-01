type Meta = {
  ip?: string
  traceID?: string
  requestID?: string
  sessionID?: string
  agentID?: string
}

const META = new WeakMap<Request, Meta>()
const AGENT_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,63}$/

export namespace RequestMeta {
  export function setIp(req: Request, ip: string | undefined) {
    if (!ip) return
    const existing = META.get(req)
    if (existing) {
      existing.ip = ip
      return
    }
    META.set(req, { ip })
  }

  export function getIp(req: Request): string | undefined {
    return META.get(req)?.ip
  }

  export function setTraceID(req: Request, traceID: string | undefined) {
    if (!traceID) return
    const existing = META.get(req)
    if (existing) {
      existing.traceID = traceID
      return
    }
    META.set(req, { traceID })
  }

  export function getTraceID(req: Request): string | undefined {
    return META.get(req)?.traceID
  }

  export function setRequestID(req: Request, requestID: string | undefined) {
    if (!requestID) return
    const existing = META.get(req)
    if (existing) {
      existing.requestID = requestID
      return
    }
    META.set(req, { requestID })
  }

  export function getRequestID(req: Request): string | undefined {
    return META.get(req)?.requestID
  }

  export function setSessionID(req: Request, sessionID: string | undefined) {
    if (!sessionID) return
    const existing = META.get(req)
    if (existing) {
      existing.sessionID = sessionID
      return
    }
    META.set(req, { sessionID })
  }

  export function getSessionID(req: Request): string | undefined {
    return META.get(req)?.sessionID
  }

  export function parseAgentID(value: string | undefined): string | undefined {
    const trimmed = value?.trim()
    if (!trimmed) return undefined
    if (!AGENT_ID_PATTERN.test(trimmed)) return undefined
    return trimmed
  }

  export function setAgentID(req: Request, agentID: string | undefined) {
    if (!agentID) return
    const existing = META.get(req)
    if (existing) {
      existing.agentID = agentID
      return
    }
    META.set(req, { agentID })
  }

  export function getAgentID(req: Request): string | undefined {
    return META.get(req)?.agentID
  }
}
