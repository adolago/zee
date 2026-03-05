import fs from "node:fs"
import path from "node:path"
import type { Argv } from "yargs"
import { Global } from "../../global"
import { normalizeHttpUrl } from "../../util/net"
import { openExternalUrl } from "../../util/open-external-url"
import { cmd } from "./cmd"
import { UI } from "../ui"

const DEFAULT_WEB_HOST = "127.0.0.1"
const DEFAULT_WEB_PORT = 3000
const DEFAULT_DAEMON_PORT = 3210
const DEFAULT_READY_TIMEOUT_MS = 15_000

export type WebArgs = {
  host?: string
  port?: number
  serverUrl?: string
  open?: boolean
  readyTimeoutMs?: number
}

type BackendTarget = {
  origin: string
  hostForEnv: string
  port: number
  basePath: string
}

export function resolveWebBackendUrl(input: { serverUrl?: unknown; env?: NodeJS.ProcessEnv } = {}): string {
  const explicit = typeof input.serverUrl === "string" ? input.serverUrl.trim() : ""
  const envUrl = input.env?.ZEE_URL?.trim() ?? ""
  const daemonPort = input.env?.ZEE_PORT?.trim() || input.env?.ZEE_DAEMON_PORT?.trim() || String(DEFAULT_DAEMON_PORT)
  return explicit || envUrl || `http://127.0.0.1:${daemonPort}`
}

export function resolveWebBackendTarget(rawUrl: string): BackendTarget {
  const safe = normalizeHttpUrl(rawUrl)
  if (!safe) {
    throw new Error("Web UI backend URL must be a valid http(s) URL.")
  }

  const url = new URL(safe)
  if (url.protocol !== "http:") {
    throw new Error("Web UI backend URL must use http:// (the app dev server does not support https backend env vars).")
  }

  const port = url.port ? Number(url.port) : 80
  const normalizedHostname = url.hostname.replace(/^\[(.*)\]$/, "$1")
  const hostForEnv = normalizedHostname.includes(":") ? `[${normalizedHostname}]` : normalizedHostname
  const pathname = url.pathname.replace(/\/+$/, "")
  const basePath = pathname && pathname !== "/" ? pathname : ""
  return {
    origin: url.origin,
    hostForEnv,
    port,
    basePath,
  }
}

export function resolveWebAppDirectory(sourceRoot: string): string | undefined {
  const candidate = path.join(sourceRoot, "packages", "app")
  const packageJson = path.join(candidate, "package.json")
  if (!fs.existsSync(packageJson)) return undefined
  return candidate
}

function renderHttpHost(host: string): string {
  return host.includes(":") && !host.startsWith("[") ? `[${host}]` : host
}

async function waitForWebReady(url: string, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs

  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(700),
      })
      if (response.ok || response.status >= 300) return true
    } catch {
      // Keep polling until timeout.
    }
    await new Promise((resolve) => setTimeout(resolve, 150))
  }

  return false
}

export function buildWebCommand(yargs: Argv) {
  return yargs
    .option("host", {
      type: "string",
      default: DEFAULT_WEB_HOST,
      describe: "host to bind the web UI dev server",
    })
    .option("port", {
      type: "number",
      default: DEFAULT_WEB_PORT,
      describe: "port to bind the web UI dev server",
    })
    .option("server-url", {
      type: "string",
      describe: "Zee daemon base URL for the web app (defaults to ZEE_URL or local daemon URL)",
    })
    .option("open", {
      type: "boolean",
      default: true,
      describe: "open the web UI in your default browser",
    })
    .option("ready-timeout-ms", {
      type: "number",
      default: DEFAULT_READY_TIMEOUT_MS,
      describe: "time to wait for the web UI dev server before opening browser",
    })
}

export async function runWebCommand(args: WebArgs) {
  const host = (args.host ?? DEFAULT_WEB_HOST).trim()
  const port = Number.isFinite(args.port) ? Number(args.port) : DEFAULT_WEB_PORT
  const readyTimeoutMs = Number.isFinite(args.readyTimeoutMs)
    ? Math.max(500, Math.floor(Number(args.readyTimeoutMs)))
    : DEFAULT_READY_TIMEOUT_MS

  if (!host) {
    UI.error("Invalid --host value.")
    process.exitCode = 1
    return
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    UI.error("Invalid --port value. Use an integer from 1 to 65535.")
    process.exitCode = 1
    return
  }

  const appDir = resolveWebAppDirectory(Global.Path.source)
  if (!appDir) {
    UI.error(`Could not find packages/app from source root: ${Global.Path.source}`)
    UI.info("Run this command from the Zee repository checkout.")
    process.exitCode = 1
    return
  }

  let backend: BackendTarget
  try {
    backend = resolveWebBackendTarget(resolveWebBackendUrl({ serverUrl: args.serverUrl, env: process.env }))
  } catch (error) {
    UI.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
    return
  }

  const uiUrl = `http://${renderHttpHost(host)}:${port}`
  const bunBin = Bun.which("bun") ?? "bun"
  const child = Bun.spawn({
    cmd: [bunBin, "run", "dev", "--host", host, "--port", String(port)],
    cwd: appDir,
    env: {
      ...process.env,
      VITE_ZEE_SERVER_HOST: backend.hostForEnv,
      VITE_ZEE_SERVER_PORT: String(backend.port),
      VITE_ZEE_SERVER_BASE_PATH: backend.basePath,
    },
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  })

  const stop = () => {
    try {
      child.kill()
    } catch {
      // Child may already be exiting.
    }
  }
  process.once("SIGINT", stop)
  process.once("SIGTERM", stop)

  UI.success(`Starting Zee Web UI at ${uiUrl}`)
  UI.info(`Backend URL: ${backend.origin}`)

  if (args.open !== false) {
    const ready = await waitForWebReady(uiUrl, readyTimeoutMs)
    if (!ready) {
      UI.warn(`Web UI did not report ready within ${readyTimeoutMs}ms. Opening browser anyway.`)
    }
    const opened = await openExternalUrl(uiUrl)
    if (!opened.ok) {
      UI.warn(`Could not open browser automatically (${opened.reason}).`)
      UI.info(`Open manually: ${uiUrl}`)
    }
  }

  const exitCode = await child.exited
  process.off("SIGINT", stop)
  process.off("SIGTERM", stop)

  if (exitCode !== 0) {
    process.exitCode = exitCode
  }
}

export const WebCommand = cmd({
  command: "web",
  describe: "run the local Zee web UI from packages/app",
  builder: (yargs: Argv) => buildWebCommand(yargs),
  handler: async (args) => {
    await runWebCommand(args as WebArgs)
  },
})
