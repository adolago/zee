import type { Argv } from "yargs"
import { cmd } from "../cmd"
import { Output } from "../../output"
import { resolveEmbeddedGatewayPort, startEmbeddedGateway, stopEmbeddedGateway, getEmbeddedGatewayState } from "@/gateway/embedded-gateway"
type StartArgs = {
  port?: number
  daemonUrl?: string
}

export const GatewayStartCommand = cmd({
  command: "start",
  describe: "Start the gateway in the foreground (WebSocket control plane)",
  builder: (yargs: Argv) =>
    yargs
      .option("port", {
        type: "number",
        describe: "Gateway port override (otherwise uses config/env default)",
      })
      .option("daemon-url", {
        type: "string",
        describe: "Optional Zee daemon URL for daemon-bridge features",
      }),
  handler: async (args) => {
    const typed = args as unknown as StartArgs
    const port = Number.isFinite(typed.port as number) && (typed.port as number) > 0 ? (typed.port as number) : resolveEmbeddedGatewayPort()
    const daemonUrl = typeof (args as any)["daemon-url"] === "string" ? String((args as any)["daemon-url"]).trim() : undefined

    let shuttingDown = false
    const shutdown = async (signal?: NodeJS.Signals) => {
      if (shuttingDown) return
      shuttingDown = true
      Output.log(`Stopping gateway${signal ? ` (${signal})` : ""}...`)
      await stopEmbeddedGateway({ reason: `gateway stop (${signal ?? "exit"})` }).catch(() => undefined)
      process.exit(0)
    }

    process.on("SIGINT", () => void shutdown("SIGINT"))
    process.on("SIGTERM", () => void shutdown("SIGTERM"))

    try {
      await startEmbeddedGateway({ port, daemonUrl })
    } catch (error) {
      Output.error(`Gateway failed to start: ${error instanceof Error ? error.message : String(error)}`)
      process.exit(1)
    }

    const state = getEmbeddedGatewayState()
    if (!state.running) {
      Output.error("Gateway runtime is unavailable (embedded gateway disabled).")
      process.exit(1)
    }

    const effectiveUrl = process.env.ZEE_GATEWAY_URL?.trim() ? String(process.env.ZEE_GATEWAY_URL).trim() : `ws://127.0.0.1:${port}`

    Output.log("Gateway started")
    Output.log(`  URL:  ${effectiveUrl}`)
    Output.log("Press Ctrl+C to stop.")

    await new Promise(() => {})
  },
})
