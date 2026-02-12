// Attach TUI to a running zee process.

import { cmd } from "../cmd"
import { UI } from "../../ui"
import { Daemon } from "../daemon"
import { attachTui } from "./attach-shared"

function normalizeDaemonHost(hostname?: string): string {
  if (!hostname || hostname === "0.0.0.0") return "127.0.0.1"
  return hostname
}

export const AttachCommand = cmd({
  command: "attach [url]",
  describe: "Attach TUI to a running zee process",
  builder: (yargs) =>
    yargs
      .positional("url", {
        type: "string",
        describe: "server URL (auto-detected if omitted)",
      })
      .option("dir", {
        type: "string",
        description: "directory to run in",
      })
      .option("model", {
        type: "string",
        alias: ["m"],
        describe: "model to use in the format of provider/model",
      })
      .option("continue", {
        alias: ["c"],
        describe: "continue the last session",
        type: "boolean",
      })
      .option("session", {
        alias: ["s"],
        type: "string",
        describe: "session id to continue",
      })
      .option("agent", {
        type: "string",
        describe: "agent to use",
      })
      .option("password", {
        type: "string",
        describe: "password for server authentication",
      }),
  handler: async (args) => {
    if (args.dir) process.chdir(args.dir)
    const cwd = process.cwd()

    let url: string

    if (args.url) {
      // Explicit URL provided
      url = args.url
    } else {
      // Auto-detect running process
      const running = await Daemon.isRunning()
      if (!running) {
        UI.error("No zee process is running.")
        UI.info("Start one with: zee")
        UI.info("Or headless: zee --headless")
        process.exit(1)
      }

      const state = await Daemon.readPidFile()
      if (!state) {
        UI.error("Could not read PID file.")
        process.exit(1)
      }

      const hostname = normalizeDaemonHost(state.hostname)
      url = `http://${hostname}:${state.port}`
    }

      // Apply password from CLI flag
    await attachTui({
      url,
      directory: cwd,
      password: args.password,
      continue: args.continue,
      sessionID: args.session,
      agent: args.agent,
      model: args.model,
    })
  },
})
