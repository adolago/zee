import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { Config } from "../../src/config/config"
import { reloadFlags } from "../../src/flag/flag"
import { Instance } from "../../src/project/instance"
import { Server } from "../../src/server/server"

function basicAuth(username: string, password: string): string {
  const token = Buffer.from(`${username}:${password}`, "utf-8").toString("base64")
  return `Basic ${token}`
}

const ORIGINAL_ENV = {
  ZEE_CONFIG_DIR: process.env.ZEE_CONFIG_DIR,
  ZEE_ENABLE_SERVER_AUTH: process.env.ZEE_ENABLE_SERVER_AUTH,
  ZEE_DISABLE_SERVER_AUTH: process.env.ZEE_DISABLE_SERVER_AUTH,
  ZEE_SERVER_PASSWORD: process.env.ZEE_SERVER_PASSWORD,
  ZEE_SERVER_SCOPES: process.env.ZEE_SERVER_SCOPES,
}

let isolatedConfigDir = ""

async function writeGlobalConfig(contents: Record<string, unknown>) {
  const configFile = path.join(isolatedConfigDir, "zee.jsonc")
  await fs.mkdir(path.dirname(configFile), { recursive: true })
  await fs.writeFile(configFile, JSON.stringify(contents, null, 2), "utf8")
  await Instance.disposeAll()
  Config.global.reset()
  Server.reset()
}

beforeAll(async () => {
  isolatedConfigDir = await fs.mkdtemp(path.join(os.tmpdir(), "zee-control-ui-origin-"))
  process.env.ZEE_CONFIG_DIR = isolatedConfigDir
  process.env.ZEE_ENABLE_SERVER_AUTH = "1"
  delete process.env.ZEE_DISABLE_SERVER_AUTH
  process.env.ZEE_SERVER_PASSWORD = "test-password"
  process.env.ZEE_SERVER_SCOPES = "operator.read"
  reloadFlags()
})

beforeEach(async () => {
  process.env.ZEE_ENABLE_SERVER_AUTH = "1"
  delete process.env.ZEE_DISABLE_SERVER_AUTH
  process.env.ZEE_SERVER_PASSWORD = "test-password"
  process.env.ZEE_SERVER_SCOPES = "operator.read"
  reloadFlags()
  await writeGlobalConfig({
    gateway: {
      controlUi: {
        auth: {
          required: true,
          mode: "token",
        },
        trustedOrigins: ["https://control.example.com"],
      },
    },
  })
})

afterAll(async () => {
  for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  reloadFlags()
  await Instance.disposeAll()
  Config.global.reset()
  Server.reset()
  if (isolatedConfigDir) {
    await fs.rm(isolatedConfigDir, { recursive: true, force: true }).catch(() => {})
  }
})

describe("control UI trusted origins", () => {
  test("enforces token auth from config for browser requests even without env auth enablement", async () => {
    delete process.env.ZEE_ENABLE_SERVER_AUTH
    delete process.env.ZEE_DISABLE_SERVER_AUTH
    process.env.ZEE_SERVER_PASSWORD = "test-password"
    process.env.ZEE_SERVER_SCOPES = "operator.read"
    reloadFlags()
    Server.reset()

    const app = Server.App()

    const denied = await app.request("/global/health/live", {
      method: "GET",
      headers: {
        Origin: "https://control.example.com",
        Authorization: basicAuth("zee", "test-password"),
      },
    })
    expect(denied.status).toBe(401)
    expect(denied.headers.get("WWW-Authenticate")).toBe('Bearer realm="zee"')

    const allowed = await app.request("/global/health/live", {
      method: "GET",
      headers: {
        Origin: "https://control.example.com",
        Authorization: "Bearer test-password",
      },
    })
    expect(allowed.status).toBe(200)
  })

  test("accepts X-Zee-Token for trusted browser origins in token mode", async () => {
    const app = Server.App()
    const res = await app.request("/global/health/live", {
      method: "GET",
      headers: {
        Origin: "https://control.example.com",
        "x-zee-token": "test-password",
      },
    })

    expect(res.status).toBe(200)
  })

  test("forbids browser-originated requests from untrusted origins", async () => {
    const app = Server.App()
    const res = await app.request("/global/health/live", {
      method: "GET",
      headers: {
        Origin: "https://evil.example.com",
        Authorization: basicAuth("zee", "test-password"),
      },
    })

    expect(res.status).toBe(403)
  })

  test("allows trusted browser origins and loopback origins with token auth", async () => {
    const app = Server.App()

    const trusted = await app.request("/global/health/live", {
      method: "GET",
      headers: {
        Origin: "https://control.example.com",
        Authorization: "Bearer test-password",
      },
    })
    expect(trusted.status).toBe(200)

    const local = await app.request("/global/health/live", {
      method: "GET",
      headers: {
        Origin: "http://localhost:5173",
        Authorization: "Bearer test-password",
      },
    })
    expect(local.status).toBe(200)
  })
})
