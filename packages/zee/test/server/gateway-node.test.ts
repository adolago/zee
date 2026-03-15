import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { Config } from "../../src/config/config"
import { FluxRecorder } from "../../src/flux"
import { resetNodeClientRegistry } from "../../src/gateway/node-client-registry"
import { Instance } from "../../src/project/instance"
import { Server } from "../../src/server/server"

const ORIGINAL_ENV = {
  ZEE_CONFIG_DIR: process.env.ZEE_CONFIG_DIR,
  ZEE_STATE_DIR: process.env.ZEE_STATE_DIR,
  ZEE_ENABLE_SERVER_AUTH: process.env.ZEE_ENABLE_SERVER_AUTH,
  ZEE_DISABLE_SERVER_AUTH: process.env.ZEE_DISABLE_SERVER_AUTH,
  ZEE_SERVER_PASSWORD: process.env.ZEE_SERVER_PASSWORD,
}

let isolatedConfigDir = ""
let isolatedStateDir = ""

async function writeGlobalConfig(contents: Record<string, unknown>) {
  const configFile = path.join(isolatedConfigDir, "zee.jsonc")
  await fs.mkdir(path.dirname(configFile), { recursive: true })
  await fs.writeFile(configFile, JSON.stringify(contents, null, 2), "utf8")
  await Instance.disposeAll()
  Config.global.reset()
  Server.reset()
  resetNodeClientRegistry()
}

async function mutateNodeClientState(
  updater: (state: {
    version: number
    nodes: Record<string, Record<string, unknown>>
  }) => void,
) {
  const stateFile = path.join(isolatedStateDir, "gateway-node-clients.json")
  const state = JSON.parse(await fs.readFile(stateFile, "utf8")) as {
    version: number
    nodes: Record<string, Record<string, unknown>>
  }
  updater(state)
  await fs.writeFile(stateFile, JSON.stringify(state, null, 2), "utf8")
  resetNodeClientRegistry()
}

beforeAll(async () => {
  isolatedConfigDir = await fs.mkdtemp(path.join(os.tmpdir(), "zee-gateway-node-config-"))
  isolatedStateDir = await fs.mkdtemp(path.join(os.tmpdir(), "zee-gateway-node-state-"))
  process.env.ZEE_CONFIG_DIR = isolatedConfigDir
  process.env.ZEE_STATE_DIR = isolatedStateDir
  delete process.env.ZEE_ENABLE_SERVER_AUTH
  delete process.env.ZEE_DISABLE_SERVER_AUTH
  delete process.env.ZEE_SERVER_PASSWORD
})

beforeEach(async () => {
  await fs.rm(path.join(isolatedStateDir, "gateway-node-clients.json"), { force: true }).catch(() => {})
  resetNodeClientRegistry()
  await writeGlobalConfig({
    gateway: {
      nodeClient: {
        enabled: true,
        securityMode: "allowlist",
        toolAllowlist: ["zee_invest_research"],
        allowRemotePairing: false,
        maxPairedNodes: 3,
        credentialMaxAgeHours: 24,
      },
    },
  })
})

afterAll(async () => {
  for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }

  await Instance.disposeAll()
  Config.global.reset()
  Server.reset()
  resetNodeClientRegistry()

  if (isolatedConfigDir) {
    await fs.rm(isolatedConfigDir, { recursive: true, force: true }).catch(() => {})
  }
  if (isolatedStateDir) {
    await fs.rm(isolatedStateDir, { recursive: true, force: true }).catch(() => {})
  }
})

describe("gateway node routes", () => {
  test("pairs a node and enforces allowlist authorization deterministically", async () => {
    const app = Server.App()
    const pairResponse = await app.request("/gateway/node/pair", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ label: "Desk", platform: "linux" }),
    })

    expect(pairResponse.status).toBe(200)
    const paired = await pairResponse.json()
    expect(paired.node.label).toBe("Desk")
    expect(typeof paired.token).toBe("string")
    expect(paired.policy.credentialMaxAgeHours).toBe(24)

    const allowed = await app.request("/gateway/node/tool/authorize", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        nodeId: paired.node.id,
        token: paired.token,
        tool: "zee_invest_research",
      }),
    })

    expect(allowed.status).toBe(200)
    expect(await allowed.json()).toMatchObject({
      authorized: true,
      mode: "allowlist",
      reason: "Tool is allowlisted",
    })

    const denied = await app.request("/gateway/node/tool/authorize", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        nodeId: paired.node.id,
        token: paired.token,
        tool: "zee_invest_api",
      }),
    })

    expect(denied.status).toBe(200)
    expect(await denied.json()).toMatchObject({
      authorized: false,
      mode: "allowlist",
      reason: "Tool is not allowlisted",
    })
  })

  test("rotates node credentials, invalidates the old token, and emits lifecycle telemetry", async () => {
    const app = Server.App()
    const before = FluxRecorder.list({ kind: "gateway.node.lifecycle" }).total

    const pairResponse = await app.request("/gateway/node/pair", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ label: "Desk", platform: "linux" }),
    })

    expect(pairResponse.status).toBe(200)
    const paired = await pairResponse.json()

    const rotateResponse = await app.request("/gateway/node/rotate", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        nodeId: paired.node.id,
        token: paired.token,
      }),
    })

    expect(rotateResponse.status).toBe(200)
    const rotated = await rotateResponse.json()
    expect(rotated.node.tokenVersion).toBe(2)
    expect(rotated.token).not.toBe(paired.token)

    const staleReconnect = await app.request("/gateway/node/reconnect", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        nodeId: paired.node.id,
        token: paired.token,
      }),
    })

    expect(staleReconnect.status).toBe(401)

    const refreshedReconnect = await app.request("/gateway/node/reconnect", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        nodeId: paired.node.id,
        token: rotated.token,
      }),
    })

    expect(refreshedReconnect.status).toBe(200)
    expect(await refreshedReconnect.json()).toMatchObject({
      id: paired.node.id,
      tokenVersion: 2,
    })
    expect(FluxRecorder.list({ kind: "gateway.node.lifecycle" }).total).toBe(before + 4)
  })

  test("requires credential rotation before reconnect or tool authorization when a token ages out", async () => {
    await writeGlobalConfig({
      gateway: {
        nodeClient: {
          enabled: true,
          securityMode: "allowlist",
          toolAllowlist: ["zee_invest_research"],
          allowRemotePairing: false,
          maxPairedNodes: 3,
          credentialMaxAgeHours: 1,
        },
      },
    })

    const app = Server.App()
    const pairResponse = await app.request("/gateway/node/pair", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ label: "Desk", platform: "linux" }),
    })

    expect(pairResponse.status).toBe(200)
    const paired = await pairResponse.json()

    await mutateNodeClientState((state) => {
      state.nodes[paired.node.id]!.tokenIssuedAt = Date.now() - 2 * 60 * 60 * 1000
    })

    const expiredReconnect = await app.request("/gateway/node/reconnect", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        nodeId: paired.node.id,
        token: paired.token,
      }),
    })

    expect(expiredReconnect.status).toBe(401)
    expect(await expiredReconnect.json()).toMatchObject({
      error: `Node token expired: ${paired.node.id}`,
    })

    const expiredAuthorize = await app.request("/gateway/node/tool/authorize", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        nodeId: paired.node.id,
        token: paired.token,
        tool: "zee_invest_research",
      }),
    })

    expect(expiredAuthorize.status).toBe(401)
    expect(await expiredAuthorize.json()).toMatchObject({
      error: `Node token expired: ${paired.node.id}`,
    })

    const rotateResponse = await app.request("/gateway/node/rotate", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        nodeId: paired.node.id,
        token: paired.token,
      }),
    })

    expect(rotateResponse.status).toBe(200)
    const rotated = await rotateResponse.json()

    const refreshedReconnect = await app.request("/gateway/node/reconnect", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        nodeId: paired.node.id,
        token: rotated.token,
      }),
    })

    expect(refreshedReconnect.status).toBe(200)
  })

  test("rejects reconnect and tool authorization when node-client policy is disabled", async () => {
    const app = Server.App()
    const pairResponse = await app.request("/gateway/node/pair", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ label: "Desk", platform: "linux" }),
    })
    expect(pairResponse.status).toBe(200)
    const paired = await pairResponse.json()

    await writeGlobalConfig({
      gateway: {
        nodeClient: {
          enabled: false,
          securityMode: "deny",
        },
      },
    })

    const disabledApp = Server.App()

    const reconnect = await disabledApp.request("/gateway/node/reconnect", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        nodeId: paired.node.id,
        token: paired.token,
      }),
    })

    expect(reconnect.status).toBe(403)

    const authorize = await disabledApp.request("/gateway/node/tool/authorize", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        nodeId: paired.node.id,
        token: paired.token,
        tool: "zee_invest_research",
      }),
    })

    expect(authorize.status).toBe(403)
  })

  test("allows operators to revoke stale nodes even after the feature is disabled", async () => {
    const app = Server.App()
    const pairResponse = await app.request("/gateway/node/pair", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ label: "Desk", platform: "linux" }),
    })
    expect(pairResponse.status).toBe(200)
    const paired = await pairResponse.json()

    await writeGlobalConfig({
      gateway: {
        nodeClient: {
          enabled: false,
          securityMode: "deny",
        },
      },
    })

    const disabledApp = Server.App()
    const revoke = await disabledApp.request("/gateway/node/revoke", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        nodeId: paired.node.id,
        reason: "cleanup",
      }),
    })

    expect(revoke.status).toBe(200)
    expect(await revoke.json()).toMatchObject({
      id: paired.node.id,
      status: "revoked",
      revokeReason: "cleanup",
    })
  })
})
