type Meta = {
  ip?: string
  traceID?: string
  requestID?: string
  sessionID?: string
}

const META = new WeakMap<Request, Meta>()

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
}
