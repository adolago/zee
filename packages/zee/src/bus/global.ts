import { EventEmitter } from "events"

export const GlobalBus = new EventEmitter<{
  event: [
    {
      directory?: string
      payload: any
    },
  ]
}>()

// Prevent memory leak warning during long daemon sessions with many SSE connections
GlobalBus.setMaxListeners(100)

