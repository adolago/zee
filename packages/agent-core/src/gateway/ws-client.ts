export type GatewayRequestFrame = {
  type: "req"
  id: string
  method: string
  params?: unknown
}

export type GatewayResponseFrame = {
  type: "res"
  id: string
  ok: boolean
  payload?: unknown
  error?: {
    code: string
    message: string
    details?: unknown
  }
}

export type GatewayWsLogger = {
  debug: (message: string, extra?: Record<string, unknown>) => void
}

type Pending = {
  timer: ReturnType<typeof setTimeout>
  resolve: (value: unknown) => void
  reject: (error: Error) => void
}

function parseGatewayResponseFrame(raw: unknown): GatewayResponseFrame | null {
  if (!raw || typeof raw !== "object") return null
  const frame = raw as Record<string, unknown>
  if (frame.type !== "res") return null
  if (typeof frame.id !== "string") return null
  if (typeof frame.ok !== "boolean") return null

  const error = frame.error && typeof frame.error === "object" ? (frame.error as Record<string, unknown>) : undefined

  return {
    type: "res",
    id: frame.id,
    ok: frame.ok,
    payload: frame.payload,
    error:
      error && typeof error.code === "string" && typeof error.message === "string"
        ? {
            code: error.code,
            message: error.message,
            details: error.details,
          }
        : undefined,
  }
}

function toText(data: unknown): string {
  if (typeof data === "string") return data
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString("utf8")
  return String(data)
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string, onTimeout?: () => void): Promise<T> {
  return new Promise((resolve, reject) => {
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      try {
        onTimeout?.()
      } catch {
        // ignore
      }
      reject(new Error(message))
    }, timeoutMs)

    promise.then(
      (value) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        resolve(value)
      },
      (err) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        reject(err)
      },
    )
  })
}

export class GatewayWsClient {
  private readonly resolveUrl: () => string
  private readonly getConnectParams: () => Promise<unknown>
  private readonly log?: GatewayWsLogger
  private readonly idleCloseMs: number

  private ws: WebSocket | null = null
  private url: string | null = null
  private connected = false

  private connectId: string | null = null
  private connectPromise: Promise<void> | null = null
  private connectResolve: (() => void) | null = null
  private connectReject: ((error: Error) => void) | null = null

  private pending = new Map<string, Pending>()
  private idleTimer: ReturnType<typeof setTimeout> | null = null

  constructor(options: {
    resolveUrl: () => string
    getConnectParams: () => Promise<unknown>
    log?: GatewayWsLogger
    idleCloseMs?: number
  }) {
    this.resolveUrl = options.resolveUrl
    this.getConnectParams = options.getConnectParams
    this.log = options.log
    this.idleCloseMs = options.idleCloseMs ?? 30_000
  }

  close() {
    this.cleanupConnection(new Error("Gateway closed"))
  }

  async call<T = unknown>(method: string, params?: unknown, options: { timeoutMs?: number } = {}): Promise<T> {
    const timeoutMs = options.timeoutMs ?? 10_000
    const start = Date.now()

    await this.ensureConnected(timeoutMs)

    const elapsed = Date.now() - start
    const remaining = timeoutMs - elapsed
    if (remaining <= 0) {
      throw new Error(`Gateway timeout after ${timeoutMs}ms (${this.url ?? this.resolveUrl()})`)
    }

    return (await this.sendRequest(method, params, remaining)) as T
  }

  private async ensureConnected(timeoutMs: number): Promise<void> {
    const ws = this.ws
    if (ws && ws.readyState === WebSocket.OPEN && this.connected) return

    await withTimeout(
      this.connect(),
      timeoutMs,
      `Gateway timeout after ${timeoutMs}ms (${this.url ?? this.resolveUrl()})`,
      () => this.cleanupConnection(new Error("Gateway connect timeout")),
    )
  }

  private connect(): Promise<void> {
    if (this.connectPromise) return this.connectPromise

    const promise = (async () => {
      // Reset any previous connection state.
      this.cleanupConnection(new Error("Gateway reconnect"))

      const url = this.resolveUrl()
      const connectParams = await this.getConnectParams()

      const ws = new WebSocket(url)
      this.ws = ws
      this.url = url
      this.connected = false

      const connectId = crypto.randomUUID()
      this.connectId = connectId

      const connectPromise = new Promise<void>((resolve, reject) => {
        this.connectResolve = resolve
        this.connectReject = reject
      })

      ws.addEventListener("open", () => {
        if (this.ws !== ws) return
        const frame: GatewayRequestFrame = {
          type: "req",
          id: connectId,
          method: "connect",
          params: connectParams,
        }
        ws.send(JSON.stringify(frame))
      })

      ws.addEventListener("message", (event) => {
        if (this.ws !== ws) return
        const rawText = toText((event as MessageEvent).data)

        let parsed: unknown
        try {
          parsed = JSON.parse(rawText)
        } catch (error) {
          this.log?.debug("Failed to parse gateway response", {
            error: error instanceof Error ? error.message : String(error),
            size: rawText.length,
          })
          return
        }

        const frame = parseGatewayResponseFrame(parsed)
        if (!frame) return

        if (!this.connected && frame.id === connectId) {
          if (!frame.ok) {
            this.cleanupConnection(new Error(frame.error?.message || "Gateway connect failed"))
            return
          }
          this.connected = true
          this.connectResolve?.()
          this.connectResolve = null
          this.connectReject = null
          return
        }

        const pending = this.pending.get(frame.id)
        if (!pending) return
        this.pending.delete(frame.id)
        clearTimeout(pending.timer)

        if (!frame.ok) {
          pending.reject(new Error(frame.error?.message || "Gateway request failed"))
          return
        }
        pending.resolve(frame.payload)
      })

      ws.addEventListener("close", (event) => {
        if (this.ws !== ws) return
        const ev = event as CloseEvent
        const reason = typeof ev.reason === "string" && ev.reason ? `: ${ev.reason}` : ""
        this.cleanupConnection(new Error(`Gateway closed (${ev.code})${reason}`))
      })

      ws.addEventListener("error", () => {
        if (this.ws !== ws) return
        this.cleanupConnection(new Error(`Failed to connect to gateway (${url})`))
      })

      return await connectPromise
    })()

    this.connectPromise = promise
    promise.finally(() => {
      if (this.connectPromise === promise) {
        this.connectPromise = null
      }
    })

    return promise
  }

  private scheduleIdleClose() {
    if (this.idleTimer) clearTimeout(this.idleTimer)
    this.idleTimer = setTimeout(() => {
      if (this.pending.size > 0) {
        this.scheduleIdleClose()
        return
      }
      this.cleanupConnection(new Error("Gateway idle"))
    }, this.idleCloseMs)
  }

  private async sendRequest(method: string, params: unknown, timeoutMs: number): Promise<unknown> {
    const ws = this.ws
    if (!ws || ws.readyState !== WebSocket.OPEN || !this.connected) {
      throw new Error("Gateway is not connected")
    }

    if (this.idleTimer) {
      clearTimeout(this.idleTimer)
      this.idleTimer = null
    }

    const requestId = crypto.randomUUID()
    const frame: GatewayRequestFrame = {
      type: "req",
      id: requestId,
      method,
      params,
    }

    return await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId)
        reject(new Error(`Gateway timeout after ${timeoutMs}ms (${this.url ?? this.resolveUrl()})`))
      }, timeoutMs)
      this.pending.set(requestId, { timer, resolve, reject })

      try {
        ws.send(JSON.stringify(frame))
      } catch (error) {
        clearTimeout(timer)
        this.pending.delete(requestId)
        reject(error instanceof Error ? error : new Error(String(error)))
      }
    }).finally(() => {
      this.scheduleIdleClose()
    })
  }

  private cleanupConnection(error: Error) {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer)
      this.idleTimer = null
    }

    const ws = this.ws
    this.ws = null
    this.connected = false
    this.url = null

    if (ws) {
      try {
        ws.close()
      } catch {
        // ignore
      }
    }

    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer)
      pending.reject(error)
    }
    this.pending.clear()

    if (this.connectReject) {
      this.connectReject(error)
    }
    this.connectResolve = null
    this.connectReject = null
    this.connectPromise = null
    this.connectId = null
  }
}
