import { expect, test } from "bun:test"
import net from "node:net"
import path from "node:path"
import { GatewayWsClient } from "../../src/gateway/ws-client"
import {
  getEmbeddedGatewayState,
  startEmbeddedGateway,
  stopEmbeddedGateway,
} from "../../src/gateway/embedded-gateway"
import { tmpdir } from "../fixture/fixture"

async function getFreePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = net.createServer()
    server.once("error", reject)
    server.listen(0, "127.0.0.1", () => {
      const address = server.address()
      if (!address || typeof address === "string") {
        reject(new Error("Failed to resolve test port"))
        return
      }
      const { port } = address
      server.close((error) => {
        if (error) reject(error)
        else resolve(port)
      })
    })
  })
}

test("embedded gateway starts locally and answers health checks", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(path.join(dir, "config", "zee.jsonc"), JSON.stringify({ $schema: "zee" }))
    },
  })

  const original = {
    ZEE_CONFIG_DIR: process.env.ZEE_CONFIG_DIR,
    ZEE_STATE_DIR: process.env.ZEE_STATE_DIR,
    ZEE_GATEWAY_PORT: process.env.ZEE_GATEWAY_PORT,
    ZEE_GATEWAY_TOKEN: process.env.ZEE_GATEWAY_TOKEN,
    ZEE_GATEWAY_PASSWORD: process.env.ZEE_GATEWAY_PASSWORD,
    ZEE_GATEWAY_TOKEN_FILE: process.env.ZEE_GATEWAY_TOKEN_FILE,
  }

  process.env.ZEE_CONFIG_DIR = path.join(tmp.path, "config")
  process.env.ZEE_STATE_DIR = path.join(tmp.path, "state")
  delete process.env.ZEE_GATEWAY_PORT
  delete process.env.ZEE_GATEWAY_TOKEN
  delete process.env.ZEE_GATEWAY_PASSWORD
  delete process.env.ZEE_GATEWAY_TOKEN_FILE

  const port = await getFreePort()

  try {
    const started = await startEmbeddedGateway({ port })
    expect(started).toBe(true)
    expect(getEmbeddedGatewayState()).toMatchObject({
      running: true,
      port,
      pid: process.pid,
    })

    const client = new GatewayWsClient({
      resolveUrl: () => `ws://127.0.0.1:${port}`,
      getConnectParams: async () => ({
        minProtocol: 3,
        maxProtocol: 3,
        client: { id: "test-client" },
        scopes: ["operator.admin"],
      }),
      idleCloseMs: 100,
    })

    const health = await client.call<{ ok: boolean; port: number; pid: number }>("health", { probe: true })
    const channels = await client.call<{ channelAccounts: { whatsapp: unknown[] } }>("channels.status", {})
    client.close()

    expect(health.ok).toBe(true)
    expect(health.port).toBe(port)
    expect(health.pid).toBe(process.pid)
    expect(channels.channelAccounts.whatsapp).toEqual([])
  } finally {
    await stopEmbeddedGateway({ reason: "test cleanup" })

    if (original.ZEE_CONFIG_DIR === undefined) delete process.env.ZEE_CONFIG_DIR
    else process.env.ZEE_CONFIG_DIR = original.ZEE_CONFIG_DIR

    if (original.ZEE_STATE_DIR === undefined) delete process.env.ZEE_STATE_DIR
    else process.env.ZEE_STATE_DIR = original.ZEE_STATE_DIR

    if (original.ZEE_GATEWAY_PORT === undefined) delete process.env.ZEE_GATEWAY_PORT
    else process.env.ZEE_GATEWAY_PORT = original.ZEE_GATEWAY_PORT

    if (original.ZEE_GATEWAY_TOKEN === undefined) delete process.env.ZEE_GATEWAY_TOKEN
    else process.env.ZEE_GATEWAY_TOKEN = original.ZEE_GATEWAY_TOKEN

    if (original.ZEE_GATEWAY_PASSWORD === undefined) delete process.env.ZEE_GATEWAY_PASSWORD
    else process.env.ZEE_GATEWAY_PASSWORD = original.ZEE_GATEWAY_PASSWORD

    if (original.ZEE_GATEWAY_TOKEN_FILE === undefined) delete process.env.ZEE_GATEWAY_TOKEN_FILE
    else process.env.ZEE_GATEWAY_TOKEN_FILE = original.ZEE_GATEWAY_TOKEN_FILE
  }
})
