import { cmd } from "../cmd"
import net from "node:net"
import { Output } from "../../output"
import { resolveGatewayWsUrl } from "./util"
import { readEmbeddedGatewayConfigSnapshot, resolveEmbeddedGatewayPort } from "@/gateway/embedded-gateway"
import { readZeeGatewayTokenFromFile } from "@/gateway/token"
import { GatewayWsClient } from "@/gateway/ws-client"
import { Log } from "@/util/log"

const log = Log.create({ service: "cli:gateway" })

const PROTOCOL_VERSION = 3

async function isPortOpen(host: string, port: number): Promise<boolean> {
  return await new Promise((resolve) => {
    const socket = net.createConnection({ host, port })
    const timeout = setTimeout(() => {
      socket.destroy()
      resolve(false)
    }, 1000)

    socket.once("connect", () => {
      clearTimeout(timeout)
      socket.end()
      resolve(true)
    })
    socket.once("error", () => {
      clearTimeout(timeout)
      resolve(false)
    })
  })
}

async function buildGatewayConnectParams() {
  const envToken = process.env.ZEE_GATEWAY_TOKEN?.trim()
  const fileToken = (await readZeeGatewayTokenFromFile({ log }).catch(() => undefined)) ?? ""
  const token = envToken || fileToken || undefined
  const password = process.env.ZEE_GATEWAY_PASSWORD?.trim() || undefined
  const auth = token || password ? { ...(token ? { token } : {}), ...(password ? { password } : {}) } : undefined

  return {
    minProtocol: PROTOCOL_VERSION,
    maxProtocol: PROTOCOL_VERSION,
    client: {
      id: "cli",
      displayName: "zee",
      version: process.env.ZEE_VERSION?.trim() || "dev",
      platform: process.platform,
      mode: "cli",
    },
    caps: [],
    scopes: ["operator.admin"],
    ...(auth ? { auth } : {}),
  }
}

function summarizeTokenSource(): string {
  if (process.env.ZEE_GATEWAY_TOKEN?.trim()) return "env"
  if (process.env.ZEE_GATEWAY_TOKEN_FILE?.trim()) return "file (ZEE_GATEWAY_TOKEN_FILE)"
  return "file (default)"
}

export async function printGatewayStatus(): Promise<void> {
  const wsUrl = resolveGatewayWsUrl()
  let host = "127.0.0.1"
  let port = resolveEmbeddedGatewayPort()

  try {
    const parsed = new URL(wsUrl)
    if (parsed.hostname) host = parsed.hostname
    if (parsed.port) port = Number.parseInt(parsed.port, 10)
  } catch {
    // Ignore parsing issues; fall back to resolvedEmbeddedGatewayPort.
  }

  const config = await readEmbeddedGatewayConfigSnapshot().catch(() => null)
  const configLabel = config
    ? config.exists
      ? config.path ?? "Configured"
      : config.path
        ? `Not found (${config.path})`
        : "Not found"
    : "Unknown"

  const tokenSet = Boolean(process.env.ZEE_GATEWAY_TOKEN?.trim())
  const passwordSet = Boolean(process.env.ZEE_GATEWAY_PASSWORD?.trim())

  const listening = await isPortOpen(host, port)

  let rpcOk: boolean | null = null
  let rpcError: string | undefined
  if (listening) {
    try {
      const gatewayClient = new GatewayWsClient({
        resolveUrl: () => wsUrl,
        getConnectParams: buildGatewayConnectParams,
        log,
        idleCloseMs: 1000,
      })
      await gatewayClient.call("health", { probe: true }, { timeoutMs: 2500 })
      gatewayClient.close()
      rpcOk = true
    } catch (error) {
      rpcOk = false
      rpcError = error instanceof Error ? error.message : String(error)
    }
  }

  Output.log("Zee Gateway")
  Output.log(`  URL:       ${wsUrl}`)
  Output.log(`  Port:      ${port} (${listening ? "listening" : "closed"})`)
  Output.log(`  Config:    ${configLabel}${config && config.exists ? (config.valid ? "" : " (invalid)") : ""}`)
  Output.log(
    `  Auth:      token=${tokenSet ? "set" : "unset"} (${summarizeTokenSource()}), password=${passwordSet ? "set" : "unset"}`,
  )
  if (!listening) {
    Output.log("  RPC:       skipped (port closed)")
  } else if (rpcOk === true) {
    Output.log("  RPC:       ok")
  } else if (rpcOk === false) {
    Output.log(`  RPC:       failed (${rpcError ?? "unknown error"})`)
  }

  const issues: string[] = []
  if (config && !config.valid) {
    for (const issue of config.issues) {
      const location = issue.path?.trim() ? issue.path : "<root>"
      issues.push(`Config ${location}: ${issue.message}`)
    }
  }
  if (issues.length > 0) {
    Output.log("  Issues:")
    for (const issue of issues) Output.log(`    - ${issue}`)
  }
}

export const GatewayStatusCommand = cmd({
  command: "status",
  describe: "Check gateway configuration and reachability",
  handler: async () => {
    await printGatewayStatus()
  },
})
