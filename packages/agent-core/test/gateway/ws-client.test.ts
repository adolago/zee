import { afterEach, describe, expect, test } from "bun:test"
import { GatewayWsClient } from "../../src/gateway/ws-client"

const OriginalWebSocket = globalThis.WebSocket

type Listener = (event: any) => void

class MockWebSocket {
  static CONNECTING = 0
  static OPEN = 1
  static CLOSING = 2
  static CLOSED = 3

  static created = 0
  static instances: MockWebSocket[] = []

  url: string
  readyState = MockWebSocket.CONNECTING
  sent: string[] = []
  private listeners = new Map<string, Listener[]>()

  constructor(url: string) {
    this.url = url
    MockWebSocket.created += 1
    MockWebSocket.instances.push(this)
    queueMicrotask(() => {
      this.readyState = MockWebSocket.OPEN
      this.dispatch("open", {})
    })
  }

  addEventListener(type: string, listener: Listener) {
    const list = this.listeners.get(type) ?? []
    list.push(listener)
    this.listeners.set(type, list)
  }

  send(data: string) {
    this.sent.push(String(data))

    let parsed: any
    try {
      parsed = JSON.parse(String(data))
    } catch {
      return
    }

    if (parsed?.type !== "req" || typeof parsed?.id !== "string") return

    if (parsed.method === "connect") {
      queueMicrotask(() => {
        this.dispatch("message", {
          data: JSON.stringify({ type: "res", id: parsed.id, ok: true }),
        })
      })
      return
    }

    queueMicrotask(() => {
      this.dispatch("message", {
        data: JSON.stringify({ type: "res", id: parsed.id, ok: true, payload: { method: parsed.method } }),
      })
    })
  }

  close() {
    if (this.readyState === MockWebSocket.CLOSED) return
    this.readyState = MockWebSocket.CLOSED
    queueMicrotask(() => {
      this.dispatch("close", { code: 1000, reason: "", wasClean: true })
    })
  }

  private dispatch(type: string, event: any) {
    const list = this.listeners.get(type) ?? []
    for (const listener of list) {
      listener(event)
    }
  }
}

afterEach(() => {
  globalThis.WebSocket = OriginalWebSocket
  MockWebSocket.created = 0
  MockWebSocket.instances = []
})

describe("GatewayWsClient", () => {
  test("reuses a single websocket for multiple calls", async () => {
    globalThis.WebSocket = MockWebSocket as any

    const client = new GatewayWsClient({
      resolveUrl: () => "ws://127.0.0.1:18789",
      getConnectParams: async () => ({ minProtocol: 3, maxProtocol: 3, client: { id: "test" } }),
    })

    const r1 = await client.call("first")
    const r2 = await client.call("second")

    expect(r1).toEqual({ method: "first" })
    expect(r2).toEqual({ method: "second" })
    expect(MockWebSocket.created).toBe(1)

    const sent = MockWebSocket.instances[0]?.sent ?? []
    const methods = sent.map((raw) => JSON.parse(raw).method)
    expect(methods[0]).toBe("connect")
    expect(methods).toContain("first")
    expect(methods).toContain("second")
  })

  test("multiplexes concurrent calls over one connection", async () => {
    globalThis.WebSocket = MockWebSocket as any

    const client = new GatewayWsClient({
      resolveUrl: () => "ws://127.0.0.1:18789",
      getConnectParams: async () => ({ minProtocol: 3, maxProtocol: 3, client: { id: "test" } }),
    })

    const [r1, r2] = await Promise.all([client.call("a"), client.call("b")])
    expect(r1).toEqual({ method: "a" })
    expect(r2).toEqual({ method: "b" })
    expect(MockWebSocket.created).toBe(1)
  })
})

