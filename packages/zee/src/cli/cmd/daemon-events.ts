import type { Argv } from "yargs"
import { cmd } from "./cmd"
import { listDaemonEvents } from "@/orchestration/daemon-ipc"
import { UI } from "../ui"

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function formatEventLine(event: {
  id: number
  timestamp: number
  type: string
  taskId?: string
  workerId?: string
  sessionId?: string
  details?: Record<string, unknown>
}): string {
  const ts = new Date(event.timestamp).toISOString()
  const tags = [
    event.taskId ? `task=${event.taskId}` : "",
    event.workerId ? `worker=${event.workerId}` : "",
    event.sessionId ? `session=${event.sessionId}` : "",
  ].filter(Boolean)
  const detail = event.details ? ` ${JSON.stringify(event.details)}` : ""
  return `${event.id}\t${ts}\t${event.type}${tags.length > 0 ? `\t${tags.join(" ")}` : ""}${detail}`
}

export const DaemonEventsCommand = cmd({
  command: "daemon-events",
  describe: "Stream or list orchestration events from the daemon IPC",
  builder: (yargs: Argv) =>
    yargs
      .option("cursor", {
        describe: "Only return events with id greater than this cursor",
        type: "number",
        default: 0,
      })
      .option("limit", {
        describe: "Maximum events to fetch per request",
        type: "number",
        default: 100,
      })
      .option("follow", {
        alias: "f",
        describe: "Poll continuously for new events",
        type: "boolean",
        default: false,
      })
      .option("interval", {
        describe: "Polling interval in milliseconds when --follow is used",
        type: "number",
        default: 1000,
      })
      .option("json", {
        describe: "Print raw JSON instead of tabular lines",
        type: "boolean",
        default: false,
      })
      .option("socket-path", {
        describe: "Override daemon socket path",
        type: "string",
      }),
  handler: async (args) => {
    const limit = Math.max(1, Math.min(1000, Number(args.limit ?? 100)))
    const intervalMs = Math.max(250, Number(args.interval ?? 1000))
    let cursor = Number(args.cursor ?? 0)

    const render = (payload: { events: any[]; nextCursor: number }) => {
      if (args.json) {
        console.log(JSON.stringify(payload, null, 2))
        return
      }
      for (const event of payload.events) {
        console.log(formatEventLine(event))
      }
    }

    const fetchOnce = async () => {
      const payload = await listDaemonEvents({ cursor, limit }, { socketPath: args.socketPath })
      render(payload)
      cursor = payload.nextCursor
      return payload.events.length
    }

    try {
      const count = await fetchOnce()
      if (!args.follow) {
        if (!args.json && count === 0) {
          UI.info("No orchestration events at or above the requested cursor.")
        }
        return
      }

      if (!args.json) {
        UI.info(`Following daemon events every ${intervalMs}ms (Ctrl+C to stop)...`)
      }
      while (true) {
        await sleep(intervalMs)
        await fetchOnce()
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      UI.error(`Failed to read daemon events: ${message}`)
      process.exitCode = 1
    }
  },
})
