import { cmd } from "../cmd"
import { bootstrap } from "../../bootstrap"
import fs from "fs/promises"
import path from "path"
import { Global } from "../../../global"
import { Log } from "../../../util/log"
import { toLogString } from "../../../util/timestamp"

export const ErrorsCommand = cmd({
  command: "errors",
  describe: "show recent errors from log files",
  builder: (yargs) =>
    yargs
      .option("limit", {
        alias: "n",
        type: "number",
        default: 20,
        describe: "number of errors to show",
      })
      .option("json", {
        type: "boolean",
        default: false,
        describe: "output as JSON",
      })
      .option("follow", {
        alias: "f",
        type: "boolean",
        default: false,
        describe: "follow log file for new errors",
      }),
  async handler(args) {
    await bootstrap(process.cwd(), async () => {
      const logFile = Log.file()

      if (!logFile) {
        console.error("No log file configured")
        return
      }

      try {
        // Read the log file
        const content = await fs.readFile(logFile, "utf-8")
        const lines = content.split("\n").filter((line) => line.trim())

        // Parse and filter for errors
        const errors: Array<{
          timestamp: string
          service: string
          message: string
          error?: string
          stack?: string
          extra?: Record<string, unknown>
        }> = []

        for (const line of lines) {
          try {
            const parsed = JSON.parse(line)
            if (parsed.level === "ERROR") {
              errors.push({
                timestamp: parsed.timestamp || parsed.time || "unknown",
                service: parsed.service || "unknown",
                message: parsed.message || parsed.msg || "No message",
                error: parsed.error,
                stack: parsed.stack,
                extra: parsed,
              })
            }
          } catch {
            // Not JSON, try to detect error patterns
            if (line.toLowerCase().includes("error") || line.includes("[ERROR]")) {
              errors.push({
                timestamp: "unknown",
                service: "unknown",
                message: line.substring(0, 200),
              })
            }
          }
        }

        // Get the most recent errors
        const recentErrors = errors.slice(-args.limit)

        if (args.json) {
          console.log(JSON.stringify(recentErrors, null, 2))
          return
        }

        if (recentErrors.length === 0) {
          console.log("No errors found in log file.")
          console.log(`Log file: ${logFile}`)
          return
        }

        console.log(`Recent errors (${recentErrors.length} of ${errors.length} total):`)
        console.log(`Log file: ${logFile}`)
        console.log("")

        for (let i = 0; i < recentErrors.length; i++) {
          const err = recentErrors[i]
          const ts = err.timestamp !== "unknown" ? toLogString(err.timestamp) : "unknown"
          console.log(`${i + 1}. [${ts}] [${err.service}]`)
          console.log(`   ${err.message}`)
          if (err.error) {
            console.log(`   Error: ${err.error}`)
          }
          if (err.stack) {
            // Show first few lines of stack
            const stackLines = err.stack.split("\n").slice(0, 3)
            console.log(`   Stack: ${stackLines.join("\n          ")}`)
          }
          console.log("")
        }

        if (args.follow) {
          console.log("Following log file for new errors (Ctrl+C to stop)...")
          console.log("")

          // Simple follow implementation
          let lastSize = (await fs.stat(logFile)).size

          const checkForNewErrors = async () => {
            try {
              const stats = await fs.stat(logFile)
              if (stats.size > lastSize) {
                const handle = await fs.open(logFile, "r")
                const buffer = Buffer.alloc(stats.size - lastSize)
                await handle.read(buffer, 0, buffer.length, lastSize)
                await handle.close()

                const newContent = buffer.toString("utf-8")
                const newLines = newContent.split("\n").filter((line) => line.trim())

                for (const line of newLines) {
                  try {
                    const parsed = JSON.parse(line)
                    if (parsed.level === "ERROR") {
                      const ts = toLogString(parsed.timestamp || parsed.time)
                      console.log(`[${ts}] [${parsed.service || "unknown"}] ${parsed.message || "Error"}`)
                      if (parsed.error) console.log(`  Error: ${parsed.error}`)
                    }
                  } catch {
                    if (line.toLowerCase().includes("error")) {
                      console.log(line.substring(0, 200))
                    }
                  }
                }

                lastSize = stats.size
              }
            } catch (e) {
              // File might be rotated
            }
          }

          // Check every second
          setInterval(checkForNewErrors, 1000)

          // Keep running
          await new Promise(() => {})
        }
      } catch (e) {
        console.error(`Error reading log file: ${e instanceof Error ? e.message : String(e)}`)
        console.log(`Expected log file at: ${logFile}`)
      }
    })
  },
})
