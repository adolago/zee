// Attach TUI to a running agent-core process.

import { cmd } from "../cmd"
import { tui } from "./app"
import { UI } from "../../ui"
import { Daemon } from "../daemon"
import { createAuthorizedFetch } from "../../../server/auth"
import { reloadFlags } from "../../../flag/flag"
import * as prompts from "@clack/prompts"

function normalizeDaemonHost(hostname?: string): string {
  if (!hostname || hostname === "0.0.0.0") return "127.0.0.1"
  return hostname
}

export const AttachCommand = cmd({
  command: "attach [url]",
  describe: "Attach TUI to a running agent-core process",
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
        UI.error("No agent-core process is running.")
        UI.info("Start one with: agent-core")
        UI.info("Or headless: agent-core --headless")
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
    if (args.password) {
      process.env.AGENT_CORE_SERVER_PASSWORD = args.password
      reloadFlags()
    }

    // Verify health
    let res: Response
    try {
      const authorizedFetch = createAuthorizedFetch(fetch)
      res = await authorizedFetch(`${url}/global/health`, {
        signal: AbortSignal.timeout(3000),
      })
    } catch {
      UI.error(`Cannot reach process at ${url}.`)
      process.exit(1)
    }

    // If 401 and no password was provided, prompt interactively
    if (res.status === 401 && !args.password) {
      const pw = await prompts.password({
        message: "Server requires authentication. Enter password:",
        validate: (x) => (x && x.length > 0 ? undefined : "Required"),
      })
      if (prompts.isCancel(pw)) {
        process.exit(1)
      }
      process.env.AGENT_CORE_SERVER_PASSWORD = pw
      reloadFlags()

      // Retry health check
      try {
        const authorizedFetch = createAuthorizedFetch(fetch)
        res = await authorizedFetch(`${url}/global/health`, {
          signal: AbortSignal.timeout(3000),
        })
      } catch {
        UI.error(`Cannot reach process at ${url}.`)
        process.exit(1)
      }
    }

    if (!res.ok) {
      if (res.status === 401) {
        UI.error("Authentication failed. Check your password.")
      } else {
        UI.error(`Process at ${url} is not healthy (status ${res.status}).`)
      }
      process.exit(1)
    }

    const authorizedFetch = createAuthorizedFetch(fetch)
    await tui({
      url,
      directory: cwd,
      fetch: authorizedFetch,
      args: {
        continue: args.continue,
        sessionID: args.session,
        agent: args.agent,
        model: args.model,
      },
    })
  },
})
