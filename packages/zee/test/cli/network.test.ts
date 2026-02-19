import { afterEach, describe, expect, test } from "bun:test"
import * as fs from "node:fs/promises"
import * as path from "node:path"
import { resolveNetworkOptions, type NetworkOptions } from "../../src/cli/network"
import { Config } from "../../src/config/config"
import { reloadFlags } from "../../src/flag/flag"
import { resolveConfigDir } from "../../src/global/dirs"

const ORIGINAL_ARGV = [...process.argv]
const ORIGINAL_ENV = {
  ZEE_ENABLE_SERVER_AUTH: process.env.ZEE_ENABLE_SERVER_AUTH,
  ZEE_DISABLE_SERVER_AUTH: process.env.ZEE_DISABLE_SERVER_AUTH,
  ZEE_SERVER_PASSWORD: process.env.ZEE_SERVER_PASSWORD,
}

const DEFAULT_ARGS: NetworkOptions = {
  port: 0,
  hostname: "127.0.0.1",
  mdns: false,
  "mdns-domain": "zee.local",
  cors: [],
}

async function writeGlobalConfig(contents: string) {
  const configFile = path.join(resolveConfigDir(), "zee.jsonc")
  await fs.mkdir(path.dirname(configFile), { recursive: true })
  await fs.writeFile(configFile, contents, "utf8")
  Config.global.reset()
}

afterEach(async () => {
  for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  process.argv = [...ORIGINAL_ARGV]
  reloadFlags()
  Config.global.reset()

  const configFile = path.join(resolveConfigDir(), "zee.jsonc")
  await fs.rm(configFile, { force: true }).catch(() => {})
})

describe("resolveNetworkOptions", () => {
  test("keeps loopback default when mDNS is enabled without explicit hostname", async () => {
    process.argv = ["bun", "test"]
    await writeGlobalConfig(JSON.stringify({ server: { mdns: true } }))

    const resolved = await resolveNetworkOptions({ ...DEFAULT_ARGS })
    expect(resolved.mdns).toBe(true)
    expect(resolved.hostname).toBe("127.0.0.1")
  })

  test("still honors explicit non-loopback hostname from config", async () => {
    process.argv = ["bun", "test"]
    process.env.ZEE_ENABLE_SERVER_AUTH = "1"
    delete process.env.ZEE_DISABLE_SERVER_AUTH
    process.env.ZEE_SERVER_PASSWORD = "test-password"
    reloadFlags()

    await writeGlobalConfig(JSON.stringify({ server: { mdns: true, hostname: "0.0.0.0" } }))

    const resolved = await resolveNetworkOptions({ ...DEFAULT_ARGS })
    expect(resolved.hostname).toBe("0.0.0.0")
  })
})
