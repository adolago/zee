#!/usr/bin/env bun

type ConnResult = { ok: true; firstChunkBytes: number; abort: () => void } | { ok: false; error: string }

function parseArgs(argv: string[]) {
  const args: Record<string, string> = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (!a?.startsWith("--")) continue
    const key = a.slice(2)
    const value = argv[i + 1]
    if (!value || value.startsWith("--")) {
      args[key] = "true"
      continue
    }
    args[key] = value
    i++
  }
  return args
}

async function openSse(url: string): Promise<ConnResult> {
  const controller = new AbortController()
  try {
    const res = await fetch(url, {
      headers: { Accept: "text/event-stream" },
      signal: controller.signal,
    })
    if (!res.ok) {
      return { ok: false, error: `HTTP ${res.status} ${res.statusText}` }
    }
    if (!res.body) {
      return { ok: false, error: "missing response body" }
    }
    const reader = res.body.getReader()
    const first = await reader.read()
    if (first.done) {
      return { ok: false, error: "stream ended before first chunk" }
    }
    const bytes = first.value?.byteLength ?? 0
    // Keep the connection open; do not consume further.
    return { ok: true, firstChunkBytes: bytes, abort: () => controller.abort() }
  } catch (e: any) {
    return { ok: false, error: typeof e?.message === "string" ? e.message : String(e) }
  }
}

const args = parseArgs(process.argv.slice(2))

const baseUrl = (args["url"] ?? "http://127.0.0.1:3210").replace(/\/+$/, "")
const path = args["path"] ?? "/event"
const n = Number(args["n"] ?? "16")
const durationMs = Number(args["duration-ms"] ?? "5000")

if (!Number.isFinite(n) || n <= 0) throw new Error("invalid --n")
if (!Number.isFinite(durationMs) || durationMs < 0) throw new Error("invalid --duration-ms")

const sseUrl = `${baseUrl}${path}`

console.log(`bench: SSE connect`)
console.log(`- url: ${sseUrl}`)
console.log(`- connections: ${n}`)
console.log(`- durationMs: ${durationMs}`)

const t0 = performance.now()
const conns = await Promise.all(Array.from({ length: n }, () => openSse(sseUrl)))
const t1 = performance.now()

const ok = conns.filter((c) => c.ok) as Extract<ConnResult, { ok: true }>[]
const fail = conns.filter((c) => !c.ok) as Extract<ConnResult, { ok: false }>[]

console.log("")
console.log(`connect:`)
console.log(`- ok: ${ok.length}`)
console.log(`- fail: ${fail.length}`)
console.log(`- timeMs: ${(t1 - t0).toFixed(2)}`)
if (fail.length > 0) {
  const sample = fail.slice(0, 5).map((f) => f.error)
  console.log(`- sampleErrors: ${JSON.stringify(sample)}`)
}

if (durationMs > 0) {
  await new Promise((r) => setTimeout(r, durationMs))
}

for (const c of ok) c.abort()
