import { expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { Config } from "../../src/config/config"
import { tmpdir } from "../fixture/fixture"

async function exists(p: string): Promise<boolean> {
  try {
    await fs.stat(p)
    return true
  } catch {
    return false
  }
}

test("Config.installDependencies is a no-op when ZEE_DISABLE_CONFIG_DEPENDENCY_INSTALL=1", async () => {
  const original = process.env.ZEE_DISABLE_CONFIG_DEPENDENCY_INSTALL
  process.env.ZEE_DISABLE_CONFIG_DEPENDENCY_INSTALL = "1"
  try {
    await using tmp = await tmpdir()
    const dir = path.join(tmp.path, "config-dir")
    await fs.mkdir(dir, { recursive: true })

    await Config.installDependencies(dir)

    expect(await exists(path.join(dir, "node_modules"))).toBe(false)
    expect(await exists(path.join(dir, "package.json"))).toBe(false)
    expect(await exists(path.join(dir, ".gitignore"))).toBe(false)
    expect(await exists(path.join(dir, "bun.lock"))).toBe(false)
  } finally {
    if (typeof original === "string") {
      process.env.ZEE_DISABLE_CONFIG_DEPENDENCY_INSTALL = original
    } else {
      delete process.env.ZEE_DISABLE_CONFIG_DEPENDENCY_INSTALL
    }
  }
})

