type SseStream = {
  writeSSE: (options: { event: string; data: string }) => Promise<void>
}

const DEFAULT_KEEPALIVE_INTERVAL_MS = 30_000

const streams = new Set<SseStream>()
let interval: ReturnType<typeof setInterval> | null = null

function ensureInterval(intervalMs: number) {
  if (interval) return
  interval = setInterval(async () => {
    if (streams.size === 0) return

    const payload = JSON.stringify({ timestamp: Date.now() })
    const list = Array.from(streams)
    const results = await Promise.allSettled(
      list.map((stream) =>
        stream.writeSSE({
          event: "keepalive",
          data: payload,
        }),
      ),
    )

    for (let i = 0; i < list.length; i += 1) {
      if (results[i]?.status === "rejected") {
        streams.delete(list[i]!)
      }
    }

    if (streams.size === 0 && interval) {
      clearInterval(interval)
      interval = null
    }
  }, intervalMs)
}

export function registerSseKeepalive(stream: SseStream, options: { intervalMs?: number } = {}): () => void {
  streams.add(stream)
  ensureInterval(options.intervalMs ?? DEFAULT_KEEPALIVE_INTERVAL_MS)

  let removed = false
  return () => {
    if (removed) return
    removed = true
    streams.delete(stream)
    if (streams.size === 0 && interval) {
      clearInterval(interval)
      interval = null
    }
  }
}
