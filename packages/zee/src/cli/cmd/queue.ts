import type { Argv } from "yargs"
import { cmd } from "./cmd"
import { bootstrap } from "../bootstrap"
import { Session } from "../../session"
import { SessionStatus } from "../../session/status"

type QueueStatusArgs = {
  json?: boolean
}

type QueueEntry = {
  sessionID: string
  title: string
  status: SessionStatus.Info
}

const QueueStatusCommand = cmd({
  command: "status",
  describe: "show queued/running session status",
  builder: (yargs: Argv) =>
    yargs.option("json", {
      type: "boolean",
      default: false,
      describe: "output as JSON",
    }),
  handler: async (args: QueueStatusArgs) => {
    await bootstrap(process.cwd(), async () => {
      const titleBySession = new Map<string, string>()
      for await (const session of Session.list()) {
        titleBySession.set(session.id, session.title)
      }

      const statuses = SessionStatus.list()
      const entries: QueueEntry[] = Object.entries(statuses)
        .map(([sessionID, status]) => ({
          sessionID,
          title: titleBySession.get(sessionID) ?? "(unknown)",
          status,
        }))
        .sort((a, b) => a.sessionID.localeCompare(b.sessionID))

      const summary = {
        busy: entries.filter((entry) => entry.status.type === "busy").length,
        retry: entries.filter((entry) => entry.status.type === "retry").length,
        total: entries.length,
      }

      if (args.json) {
        console.log(
          JSON.stringify(
            {
              generatedAt: new Date().toISOString(),
              summary,
              entries,
            },
            null,
            2,
          ),
        )
        return
      }

      console.log(`Queue status: total=${summary.total} busy=${summary.busy} retry=${summary.retry}`)
      if (entries.length === 0) {
        console.log("No active queue entries")
        return
      }

      for (const entry of entries) {
        if (entry.status.type === "retry") {
          const nextInMs = Math.max(0, entry.status.next - Date.now())
          console.log(
            `${entry.sessionID} retry attempt=${entry.status.attempt} nextIn=${Math.ceil(nextInMs / 1000)}s title=${entry.title}`,
          )
          continue
        }

        if (entry.status.type === "busy") {
          const streamHealth = entry.status.streamHealth
          const stalled = streamHealth?.isStalled ? " stalled" : ""
          const phase = streamHealth?.phase ? ` phase=${streamHealth.phase}` : ""
          console.log(`${entry.sessionID} busy${stalled}${phase} title=${entry.title}`)
          continue
        }

        console.log(`${entry.sessionID} idle title=${entry.title}`)
      }
    })
  },
})

export const QueueCommand = cmd({
  command: "queue",
  describe: "queue and run-state tools",
  builder: (yargs: Argv) => yargs.command(QueueStatusCommand).demandCommand(),
  async handler() {},
})
