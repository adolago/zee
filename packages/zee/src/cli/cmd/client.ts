import type { Argv } from "yargs"
import { cmd } from "./cmd"
import { UI } from "../ui"

type ClientArgs = {
  url?: string
  dir?: string
  model?: string
  continue?: boolean
  session?: string
  agent?: string
  password?: string
}

export function resolveClientUrl(args: { url?: unknown; env?: NodeJS.ProcessEnv } = {}): string | undefined {
  const explicit = typeof args.url === "string" ? args.url.trim() : ""
  if (explicit) return explicit
  const envUrl = args.env?.ZEE_URL?.trim()
  if (envUrl) return envUrl
  return undefined
}

export const ClientCommand = cmd({
  command: "client [url]",
  describe: "Start the TUI as a client (requires an explicit server URL or ZEE_URL)",
  builder: (yargs: Argv) =>
    yargs
      .positional("url", {
        type: "string",
        describe: "server URL (or set ZEE_URL)",
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
    const typed = args as ClientArgs
    if (typed.dir) process.chdir(typed.dir)
    const cwd = process.cwd()

    const url = resolveClientUrl({ url: typed.url, env: process.env })
    if (!url) {
      UI.error("Missing server URL.")
      UI.info("Pass a URL: zee client http://127.0.0.1:3210")
      UI.info("Or set ZEE_URL: ZEE_URL=http://127.0.0.1:3210 zee client")
      process.exit(1)
    }

    const { attachTui } = await import("./tui/attach-shared")
    await attachTui({
      url,
      directory: cwd,
      password: typed.password,
      continue: typed.continue,
      sessionID: typed.session,
      agent: typed.agent,
      model: typed.model,
    })
  },
})
