import { createOpencodeClient } from "@agent-core/sdk/v2"
import { createOpencodeClient as createEventClient } from "@agent-core/sdk"
import { createSimpleContext } from "./helper"
import { createGlobalEmitter } from "@solid-primitives/event-bus"
import { batch, onCleanup, onMount } from "solid-js"

type AppEvent = {
  type: string
  properties: any
}

export type EventSource = {
  on: (handler: (event: AppEvent) => void) => () => void
}

export const { use: useSDK, provider: SDKProvider } = createSimpleContext({
  name: "SDK",
  init: (props: { url: string; directory?: string; fetch?: typeof fetch; events?: EventSource }) => {
    const abort = new AbortController()
    const sdk = createOpencodeClient({
      baseUrl: props.url,
      signal: abort.signal,
      directory: props.directory,
      fetch: props.fetch,
    })
    const eventSdk = createEventClient({
      baseUrl: props.url,
      signal: abort.signal,
      directory: props.directory,
      fetch: props.fetch,
    })

    const emitter = createGlobalEmitter<{
      [key: string]: AppEvent
    }>()

    let queue: AppEvent[] = []
    let timer: Timer | undefined
    let last = 0

    const flush = () => {
      if (queue.length === 0) return
      const events = queue
      queue = []
      timer = undefined
      last = Date.now()
      // Batch all event emissions so all store updates result in a single render
      batch(() => {
        for (const event of events) {
          emitter.emit(event.type, event)
        }
      })
    }

    const handleEvent = (event: AppEvent) => {
      queue.push(event)
      const elapsed = Date.now() - last

      if (timer) return
      // If we just flushed recently (within 16ms), batch this with future events
      // Otherwise, process immediately to avoid latency
      if (elapsed < 50) {
        timer = setTimeout(flush, 50)
        return
      }
      flush()
    }

    const resolveEvent = (input: any): AppEvent | undefined => {
      if (!input || typeof input !== "object") return
      if (input.payload && typeof input.payload === "object") {
        const payload = input.payload as AppEvent
        if (payload?.type) return payload
      }
      if (typeof input.type === "string") {
        return input as AppEvent
      }
    }

    onMount(async () => {
      // If an event source is provided, use it instead of SSE
      if (props.events) {
        const unsub = props.events.on(handleEvent)
        onCleanup(unsub)
        return
      }

      // Fall back to SSE
      while (true) {
        if (abort.signal.aborted) break
        const events = await eventSdk.event.subscribe({ signal: abort.signal })

        for await (const event of events.stream) {
          const resolved = resolveEvent(event)
          if (!resolved) continue
          if (props.directory && (event as any)?.directory && (event as any).directory !== props.directory) {
            continue
          }
          handleEvent(resolved)
        }

        // Flush any remaining events
        if (timer) clearTimeout(timer)
        if (queue.length > 0) {
          flush()
        }
      }
    })

    onCleanup(() => {
      abort.abort()
      if (timer) clearTimeout(timer)
    })

    return { client: sdk, event: emitter, url: props.url }
  },
})
