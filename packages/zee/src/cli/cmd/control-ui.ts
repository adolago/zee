import type { Argv } from "yargs"
import { createAuthorizedFetch } from "../../server/auth"
import { normalizeHttpUrl } from "../../util/net"
import { UI } from "../ui"
import { cmd } from "./cmd"
import { buildWebCommand, resolveWebBackendUrl, runWebCommand, type WebArgs } from "./web"

type ControlUiStatusArgs = {
  serverUrl?: string
  timeoutMs?: number
  json?: boolean
  strict?: boolean
}

type ControlUiProbe = {
  id: "session_visibility" | "approvals" | "pairing" | "health" | "channel_state"
  method: "GET"
  path: string
  description: string
}

type ControlUiProbeResult = {
  id: ControlUiProbe["id"]
  path: string
  ok: boolean
  status?: number
  error?: string
}

const DEFAULT_STATUS_TIMEOUT_MS = 3000

const CORE_WORKFLOW_PROBES: readonly ControlUiProbe[] = [
  {
    id: "session_visibility",
    method: "GET",
    path: "/session",
    description: "List sessions for operator visibility",
  },
  {
    id: "approvals",
    method: "GET",
    path: "/question",
    description: "List pending approvals/questions",
  },
  {
    id: "pairing",
    method: "GET",
    path: "/gateway/status",
    description: "Gateway pairing/availability status",
  },
  {
    id: "health",
    method: "GET",
    path: "/health/status",
    description: "Core system health",
  },
  {
    id: "channel_state",
    method: "GET",
    path: "/gateway/channels/status",
    description: "Messaging channel connectivity state",
  },
]

export function getControlUiWorkflowProbes(): ControlUiProbe[] {
  return [...CORE_WORKFLOW_PROBES]
}

async function runControlUiProbe(baseUrl: string, probe: ControlUiProbe, timeoutMs: number): Promise<ControlUiProbeResult> {
  const authorizedFetch = createAuthorizedFetch(fetch)
  const url = new URL(probe.path, baseUrl).toString()
  try {
    const response = await authorizedFetch(url, {
      method: probe.method,
      signal: AbortSignal.timeout(timeoutMs),
    })
    return {
      id: probe.id,
      path: probe.path,
      ok: response.ok,
      status: response.status,
      ...(response.ok ? {} : { error: `HTTP ${response.status}` }),
    }
  } catch (error) {
    return {
      id: probe.id,
      path: probe.path,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

const ControlUiStartCommand = cmd({
  command: "start",
  describe: "start Zee Control UI / WebChat",
  builder: (yargs: Argv) => buildWebCommand(yargs),
  handler: async (args) => {
    await runWebCommand(args as WebArgs)
  },
})

const ControlUiStatusCommand = cmd({
  command: "status",
  describe: "probe core web control workflows against the Zee server API",
  builder: (yargs: Argv) =>
    yargs
      .option("server-url", {
        type: "string",
        describe: "Zee daemon base URL (defaults to ZEE_URL or local daemon URL)",
      })
      .option("timeout-ms", {
        type: "number",
        default: DEFAULT_STATUS_TIMEOUT_MS,
        describe: "per-probe timeout in milliseconds",
      })
      .option("json", {
        type: "boolean",
        default: false,
        describe: "output as JSON",
      })
      .option("strict", {
        type: "boolean",
        default: false,
        describe: "exit with code 1 when any probe fails",
      }),
  handler: async (args: ControlUiStatusArgs) => {
    const rawBase = resolveWebBackendUrl({ serverUrl: args.serverUrl, env: process.env })
    const baseUrl = normalizeHttpUrl(rawBase)
    if (!baseUrl) {
      UI.error("Invalid --server-url (must be a valid http(s) URL).")
      process.exitCode = 1
      return
    }

    const timeoutMs = Number.isFinite(args.timeoutMs)
      ? Math.max(250, Math.floor(Number(args.timeoutMs)))
      : DEFAULT_STATUS_TIMEOUT_MS

    const results = await Promise.all(
      CORE_WORKFLOW_PROBES.map((probe) => runControlUiProbe(baseUrl, probe, timeoutMs)),
    )
    const failed = results.filter((result) => !result.ok)

    if (args.json) {
      console.log(
        JSON.stringify(
          {
            baseUrl,
            timeoutMs,
            workflows: results,
            ok: failed.length === 0,
          },
          null,
          2,
        ),
      )
    } else {
      UI.info(`Control UI status against ${baseUrl}`)
      for (const result of results) {
        const statusLabel = result.ok ? "ok" : "fail"
        const detail = result.ok ? `HTTP ${result.status ?? 200}` : result.error ?? `HTTP ${result.status ?? "?"}`
        UI.println(`- ${result.id}: ${statusLabel} (${detail})`)
      }
      if (failed.length === 0) {
        UI.success("Core web control workflows are reachable.")
      } else {
        UI.warn(`${failed.length} core workflow probe(s) failed.`)
      }
    }

    if (args.strict && failed.length > 0) {
      process.exit(1)
    }
  },
})

export const ControlUiCommand = cmd({
  command: "control-ui",
  aliases: ["webchat"],
  describe: "first-class web operator surface (Control UI + WebChat)",
  builder: (yargs: Argv) => yargs.command(ControlUiStartCommand).command(ControlUiStatusCommand).demandCommand(),
  async handler() {},
})
