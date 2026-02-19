import { afterEach, describe, expect, test } from "bun:test"
import * as fs from "node:fs/promises"
import * as path from "node:path"
import { runSecurityChecks } from "../../src/diagnostics/checks/security"
import { Config } from "../../src/config/config"
import { resolveConfigDir, resolveDataDir } from "../../src/global/dirs"

const CHECK_OPTIONS = { full: false, fix: false, verbose: false, timeout: 5000 }

async function writeGlobalConfig(contents: string) {
  const configFile = path.join(resolveConfigDir(), "zee.jsonc")
  await fs.mkdir(path.dirname(configFile), { recursive: true })
  await fs.writeFile(configFile, contents, "utf8")
  Config.global.reset()
}

afterEach(async () => {
  Config.global.reset()
  const configFile = path.join(resolveConfigDir(), "zee.jsonc")
  await fs.rm(configFile, { force: true }).catch(() => {})
})

describe("security diagnostics", () => {
  test("treats default bind as loopback even when mDNS is enabled", async () => {
    await writeGlobalConfig(JSON.stringify({ server: { mdns: true } }))

    const checks = await runSecurityChecks(CHECK_OPTIONS)
    const bindCheck = checks.find((check) => check.id === "security.server.non_loopback_requires_auth")

    expect(bindCheck).toBeDefined()
    expect(bindCheck?.status).toBe("pass")
    expect(bindCheck?.metadata).toMatchObject({
      hostname: "127.0.0.1",
      mdnsEnabled: true,
      source: "default",
    })
  })

  test("flags unsafe credential file permissions and auto-fixes them", async () => {
    const dataDir = resolveDataDir()
    const authPath = path.join(dataDir, "auth.json")
    const mcpAuthPath = path.join(dataDir, "mcp-auth.json")

    await fs.mkdir(dataDir, { recursive: true })
    await fs.writeFile(authPath, "{}", "utf8")
    await fs.writeFile(mcpAuthPath, "{}", "utf8")

    if (process.platform !== "win32") {
      await fs.chmod(authPath, 0o644)
      await fs.chmod(mcpAuthPath, 0o644)
    }

    const checks = await runSecurityChecks(CHECK_OPTIONS)
    const credentialCheck = checks.find((check) => check.id === "security.fs.credential_files.perms")

    expect(credentialCheck).toBeDefined()

    if (process.platform === "win32") {
      expect(["pass", "warn"]).toContain(credentialCheck?.status)
      return
    }

    expect(credentialCheck?.status).toBe("warn")
    expect(credentialCheck?.autoFixable).toBe(true)
    expect(credentialCheck?.fix).toBeDefined()

    const fixResult = await credentialCheck?.fix?.()
    expect(fixResult?.success).toBe(true)

    const authStat = await fs.lstat(authPath)
    const mcpStat = await fs.lstat(mcpAuthPath)
    expect(authStat.mode & 0o777).toBe(0o600)
    expect(mcpStat.mode & 0o777).toBe(0o600)
  })
})
