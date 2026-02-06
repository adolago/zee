type Meta = {
  ip?: string
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
}

