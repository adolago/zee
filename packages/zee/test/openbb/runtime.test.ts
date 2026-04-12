import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import path from "path"
import { probeOpenBBAvailability, resolveOpenBBRuntime } from "../../src/openbb/runtime"

const windowsEnv = {
  ZEE_TEST_HOME: "C:\\Users\\alice",
  APPDATA: "C:\\Users\\alice\\AppData\\Roaming",
  LOCALAPPDATA: "C:\\Users\\alice\\AppData\\Local",
  ProgramData: "C:\\ProgramData",
  ProgramW6432: "C:\\Program Files",
} as NodeJS.ProcessEnv

const originalEnv = {
  apiUrl: process.env.ZEE_OPENBB_API_URL,
  command: process.env.ZEE_OPENBB_API_CMD,
  home: process.env.ZEE_OPENBB_HOME,
  autoStart: process.env.ZEE_OPENBB_AUTOSTART,
}

beforeEach(() => {
  delete process.env.ZEE_OPENBB_API_URL
  delete process.env.ZEE_OPENBB_API_CMD
  delete process.env.ZEE_OPENBB_HOME
  delete process.env.ZEE_OPENBB_AUTOSTART
})

afterEach(() => {
  if (originalEnv.apiUrl === undefined) delete process.env.ZEE_OPENBB_API_URL
  else process.env.ZEE_OPENBB_API_URL = originalEnv.apiUrl
  if (originalEnv.command === undefined) delete process.env.ZEE_OPENBB_API_CMD
  else process.env.ZEE_OPENBB_API_CMD = originalEnv.command
  if (originalEnv.home === undefined) delete process.env.ZEE_OPENBB_HOME
  else process.env.ZEE_OPENBB_HOME = originalEnv.home
  if (originalEnv.autoStart === undefined) delete process.env.ZEE_OPENBB_AUTOSTART
  else process.env.ZEE_OPENBB_AUTOSTART = originalEnv.autoStart
})

describe("resolveOpenBBRuntime", () => {
  test("defaults to a local OpenBB runtime without a remote override", () => {
    const runtime = resolveOpenBBRuntime()

    expect(["managed-local", "path-command"]).toContain(runtime.mode)
    expect(runtime.apiUrl).toBe("http://127.0.0.1:6900")
    expect(runtime.remoteOverride).toBe(false)
    expect(runtime.managedApiCommandPath).toContain("openbb-api")
  })

  test("treats an explicit API URL as a remote override", () => {
    process.env.ZEE_OPENBB_API_URL = "https://openbb.example.com/api"

    const runtime = resolveOpenBBRuntime()

    expect(runtime.mode).toBe("remote-url")
    expect(runtime.remoteOverride).toBe(true)
    expect(runtime.command).toBeUndefined()
  })

  test("treats config API URL as a remote override", () => {
    const runtime = resolveOpenBBRuntime({ apiUrl: "https://openbb.example.internal" })

    expect(runtime.apiUrl).toBe("https://openbb.example.internal")
    expect(runtime.mode).toBe("remote-url")
    expect(runtime.remoteOverride).toBe(true)
    expect(runtime.command).toBeUndefined()
  })

  test("uses command override when provided", () => {
    process.env.ZEE_OPENBB_API_CMD = "/usr/local/bin/openbb-api"

    const runtime = resolveOpenBBRuntime()

    expect(runtime.mode).toBe("path-command")
    expect(runtime.command).toEqual(["/usr/local/bin/openbb-api"])
  })

  test("defaults Windows user scope under LocalAppData", () => {
    const runtime = resolveOpenBBRuntime(undefined, { env: windowsEnv, platform: "win32" })
    const installDir = "C:\\Users\\alice\\AppData\\Local\\Zee\\data\\openbb"

    expect(runtime.installDir).toBe(installDir)
    expect(runtime.venvDir).toBe(path.win32.join(installDir, ".venv"))
    expect(runtime.managedApiCommandPath).toBe(path.win32.join(installDir, ".venv", "Scripts", "openbb-api.exe"))
  })

  test("defaults Windows machine scope under ProgramData", () => {
    const runtime = resolveOpenBBRuntime(undefined, {
      env: { ...windowsEnv, ZEE_WINDOWS_SCOPE: "machine" },
      platform: "win32",
    })
    const installDir = "C:\\ProgramData\\Zee\\data\\openbb"

    expect(runtime.installDir).toBe(installDir)
    expect(runtime.venvDir).toBe(path.win32.join(installDir, ".venv"))
    expect(runtime.managedApiCommandPath).toBe(path.win32.join(installDir, ".venv", "Scripts", "openbb-api.exe"))
  })

  test("honors Windows ZEE_OPENBB_HOME override", () => {
    const runtime = resolveOpenBBRuntime(undefined, {
      env: { ...windowsEnv, ZEE_OPENBB_HOME: "D:\\ZeeOpenBB" },
      platform: "win32",
    })

    expect(runtime.installDir).toBe("D:\\ZeeOpenBB")
    expect(runtime.managedApiCommandPath).toBe("D:\\ZeeOpenBB\\.venv\\Scripts\\openbb-api.exe")
  })

  test("accepts forward-slash Windows ZEE_OPENBB_HOME override", () => {
    const runtime = resolveOpenBBRuntime(undefined, {
      env: { ...windowsEnv, ZEE_OPENBB_HOME: "C:/Zee/OpenBB" },
      platform: "win32",
    })

    expect(runtime.installDir).toBe("C:/Zee/OpenBB")
    expect(runtime.managedApiCommandPath).toBe("C:\\Zee\\OpenBB\\.venv\\Scripts\\openbb-api.exe")
  })
})

describe("probeOpenBBAvailability", () => {
  test("accepts 401 responses as reachable remote APIs", async () => {
    const result = await probeOpenBBAvailability(
      { apiUrl: "https://openbb.example.com" },
      {
        fetchImpl: async () =>
          new Response(null, {
            status: 401,
          }),
      },
    )

    expect(result.available).toBe(true)
    expect(result.authRequired).toBe(true)
  })

  test("returns a remediation action when the API is unreachable", async () => {
    const result = await probeOpenBBAvailability(
      undefined,
      {
        fetchImpl: async () => {
          throw new Error("connect ECONNREFUSED")
        },
      },
    )

    expect(result.available).toBe(false)
    expect(result.error).toContain("ECONNREFUSED")
    expect(result.action).toContain("zee setup")
  })
})
