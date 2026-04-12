import { describe, expect, test } from "bun:test"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { prepareLocalMemory, resolveLocalMemoryPaths } from "../../../src/memory/local-runtime"

describe("local memory runtime", () => {
  test("resolves Windows user and machine scopes under the expected roots", () => {
    const env = {
      ZEE_TEST_HOME: "C:\\Users\\artur",
      LOCALAPPDATA: "C:\\Users\\artur\\AppData\\Local",
      APPDATA: "C:\\Users\\artur\\AppData\\Roaming",
      ProgramData: "C:\\ProgramData",
      SystemDrive: "C:",
    } as NodeJS.ProcessEnv

    const user = resolveLocalMemoryPaths({ platform: "win32", scope: "user", env })
    expect(user.memoryDir).toBe("C:\\Users\\artur\\AppData\\Local\\Zee\\state\\memory")
    expect(user.modelDir).toBe("C:\\Users\\artur\\AppData\\Local\\Zee\\cache\\memory\\models")

    const machine = resolveLocalMemoryPaths({ platform: "win32", scope: "machine", env })
    expect(machine.memoryDir).toBe("C:\\ProgramData\\Zee\\state\\memory")
    expect(machine.modelDir).toBe("C:\\ProgramData\\Zee\\cache\\memory\\models")
  })

  test("prepares local SQLite memory and local embedding metadata", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "zee-memory-"))
    const status = await prepareLocalMemory({
      env: {
        ...process.env,
        ZEE_STATE_DIR: root,
      },
      platform: process.platform,
      scope: "user",
    })

    expect(status.ok).toBe(true)
    expect(fs.existsSync(status.paths.vectorDbPath)).toBe(true)
    expect(fs.existsSync(status.paths.ftsDbPath)).toBe(true)
    expect(fs.existsSync(status.paths.modelManifestPath)).toBe(true)
    expect(status.embedding.provider).toBe("local")
  })
})
