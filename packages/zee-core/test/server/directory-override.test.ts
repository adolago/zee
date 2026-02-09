import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import fs from "fs/promises"
import os from "os"
import path from "path"

import { Config } from "../../src/config/config"
import { reloadFlags } from "../../src/flag/flag"
import { Server } from "../../src/server/server"
import { tmpdir } from "../fixture/fixture"

function basicAuth(username: string, password: string): string {
  const token = Buffer.from(`${username}:${password}`, "utf-8").toString("base64")
  return `Basic ${token}`
}

const ORIGINAL_ENV = {
  AGENT_CORE_CONFIG_DIR: process.env.AGENT_CORE_CONFIG_DIR,
  AGENT_CORE_ENABLE_SERVER_AUTH: process.env.AGENT_CORE_ENABLE_SERVER_AUTH,
  AGENT_CORE_DISABLE_SERVER_AUTH: process.env.AGENT_CORE_DISABLE_SERVER_AUTH,
  AGENT_CORE_SERVER_USERNAME: process.env.AGENT_CORE_SERVER_USERNAME,
  AGENT_CORE_SERVER_PASSWORD: process.env.AGENT_CORE_SERVER_PASSWORD,
  AGENT_CORE_SERVER_SCOPES: process.env.AGENT_CORE_SERVER_SCOPES,
  AGENT_CORE_SERVER_ALLOW_GLOBAL_DIRECTORY: process.env.AGENT_CORE_SERVER_ALLOW_GLOBAL_DIRECTORY,
  AGENT_CORE_SERVER_MAX_INSTANCES: process.env.AGENT_CORE_SERVER_MAX_INSTANCES,
}

let isolatedConfigDir: string | undefined

beforeAll(async () => {
  isolatedConfigDir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-core-test-config-"))
  process.env.AGENT_CORE_CONFIG_DIR = isolatedConfigDir

  process.env.AGENT_CORE_ENABLE_SERVER_AUTH = "1"
  delete process.env.AGENT_CORE_DISABLE_SERVER_AUTH
  delete process.env.AGENT_CORE_SERVER_USERNAME
  process.env.AGENT_CORE_SERVER_PASSWORD = "test-password"
  delete process.env.AGENT_CORE_SERVER_SCOPES
  delete process.env.AGENT_CORE_SERVER_ALLOW_GLOBAL_DIRECTORY

  reloadFlags()
  Config.global.reset()
  Server.App.reset()
})

afterAll(async () => {
  if (isolatedConfigDir) {
    await fs.rm(isolatedConfigDir, { recursive: true, force: true })
  }

  for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }

  reloadFlags()
  Config.global.reset()
  Server.App.reset()
})

describe("server directory override security", () => {
  test("forbids directory override for non-admin scopes when auth is enabled", async () => {
    process.env.AGENT_CORE_SERVER_SCOPES = "operator.read"
    reloadFlags()
    Server.App.reset()

    await using tmp = await tmpdir()
    const app = Server.App()
    const res = await app.request(`/global/health?directory=${encodeURIComponent(tmp.path)}`, {
      method: "GET",
      headers: {
        Authorization: basicAuth("agent-core", "test-password"),
      },
    })
    expect(res.status).toBe(403)
  })

  test("allows directory override for admin scopes when auth is enabled", async () => {
    process.env.AGENT_CORE_SERVER_SCOPES = "operator.admin"
    reloadFlags()
    Server.App.reset()

    await using tmp = await tmpdir()
    const app = Server.App()
    const res = await app.request(`/global/health?directory=${encodeURIComponent(tmp.path)}`, {
      method: "GET",
      headers: {
        Authorization: basicAuth("agent-core", "test-password"),
      },
    })
    expect(res.status).toBe(200)
  })

  test("rejects filesystem root as instance directory by default", async () => {
    process.env.AGENT_CORE_SERVER_SCOPES = "operator.admin"
    delete process.env.AGENT_CORE_SERVER_ALLOW_GLOBAL_DIRECTORY
    reloadFlags()
    Config.global.reset()
    Server.App.reset()

    const root = path.parse(process.cwd()).root
    const app = Server.App()
    const res = await app.request(`/global/health?directory=${encodeURIComponent(root)}`, {
      method: "GET",
      headers: {
        Authorization: basicAuth("agent-core", "test-password"),
      },
    })
    expect(res.status).toBe(400)
  })

  test("allows filesystem root as instance directory with explicit override", async () => {
    process.env.AGENT_CORE_SERVER_SCOPES = "operator.admin"
    process.env.AGENT_CORE_SERVER_ALLOW_GLOBAL_DIRECTORY = "1"
    reloadFlags()
    Config.global.reset()
    Server.App.reset()

    const root = path.parse(process.cwd()).root
    const app = Server.App()
    const res = await app.request(`/global/health?directory=${encodeURIComponent(root)}`, {
      method: "GET",
      headers: {
        Authorization: basicAuth("agent-core", "test-password"),
      },
    })
    expect(res.status).toBe(200)
  })

  test("enforces max instance cache size when using directory override", async () => {
    process.env.AGENT_CORE_SERVER_SCOPES = "operator.admin"
    process.env.AGENT_CORE_SERVER_MAX_INSTANCES = "1"
    reloadFlags()
    Config.global.reset()
    Server.App.reset()

    await using tmp1 = await tmpdir()
    await using tmp2 = await tmpdir()

    const app = Server.App()
    const headers = {
      Authorization: basicAuth("agent-core", "test-password"),
    }

    const res1 = await app.request(`/global/health?directory=${encodeURIComponent(tmp1.path)}`, {
      method: "GET",
      headers,
    })
    expect(res1.status).toBe(200)

    const res2 = await app.request(`/global/health?directory=${encodeURIComponent(tmp2.path)}`, {
      method: "GET",
      headers,
    })
    expect(res2.status).toBe(429)
  })
})
