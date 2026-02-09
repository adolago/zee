import { cmd } from "../cmd"
import { Session } from "../../../session"
import { SessionStatus } from "../../../session/status"
import { Timestamp } from "../../../util/timestamp"
import { bootstrap } from "../../bootstrap"

export const TasksCommand = cmd({
  command: "tasks",
  describe: "show active sessions and background tasks",
  builder: (yargs) =>
    yargs.option("json", {
      type: "boolean",
      default: false,
      describe: "output as JSON",
    }),
  async handler(args) {
    await bootstrap(process.cwd(), async () => {
      const tasks: Array<{
        sessionId: string
        title: string
        status: string
        statusDetails?: Record<string, unknown>
        created: string
        updated: string
      }> = []

      // Get all sessions and their statuses
      for await (const session of Session.list()) {
        const status = SessionStatus.get(session.id)

        tasks.push({
          sessionId: session.id,
          title: session.title || "(untitled)",
          status: status?.type || "idle",
          statusDetails: status,
          created: new Date(session.time.created).toISOString(),
          updated: session.time.updated ? new Date(session.time.updated).toISOString() : "-",
        })
      }

      // Sort by updated time (most recent first)
      tasks.sort((a, b) => {
        const aTime = a.updated === "-" ? a.created : a.updated
        const bTime = b.updated === "-" ? b.created : b.updated
        return bTime.localeCompare(aTime)
      })

      if (args.json) {
        console.log(JSON.stringify(tasks, null, 2))
        return
      }

      if (tasks.length === 0) {
        console.log("No active sessions")
        return
      }

      // Count by status
      const statusCounts = tasks.reduce(
        (acc, t) => {
          acc[t.status] = (acc[t.status] || 0) + 1
          return acc
        },
        {} as Record<string, number>,
      )

      console.log("Session Status Summary:")
      for (const [status, count] of Object.entries(statusCounts)) {
        console.log(`  ${status}: ${count}`)
      }
      console.log("")

      // Show active sessions (non-idle)
      const activeTasks = tasks.filter((t) => t.status !== "idle")
      if (activeTasks.length > 0) {
        console.log("Active Sessions:")
        for (const task of activeTasks) {
          console.log(`  ${task.sessionId.slice(0, 8)}  ${task.status.padEnd(12)}  ${task.title.slice(0, 40)}`)
          if (task.statusDetails && task.status === "retry") {
            const details = task.statusDetails as { attempt?: number; message?: string; next?: number }
            if (details.next) {
              const waitTime = Math.max(0, details.next - Date.now())
              console.log(`             Retry #${details.attempt}, waiting ${Math.round(waitTime / 1000)}s`)
            }
          }
        }
        console.log("")
      }

      // Show recent sessions
      console.log("Recent Sessions (last 10):")
      for (const task of tasks.slice(0, 10)) {
        const statusIcon = task.status === "idle" ? " " : "*"
        const updated = task.updated === "-" ? task.created : task.updated
        const time = Timestamp.time(new Date(updated))
        console.log(`  ${statusIcon} ${task.sessionId.slice(0, 8)}  ${time}  ${task.title.slice(0, 40)}`)
      }
    })
  },
})
