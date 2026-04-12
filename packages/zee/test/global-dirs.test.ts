import { describe, expect, test } from "bun:test"
import {
  resolveCacheDir,
  resolveConfigDir,
  resolveDataDir,
  resolveInstallRoot,
  resolveLogsDir,
  resolvePolicyPath,
  resolveStateDir,
  resolveWorkspaceDir,
} from "../src/global/dirs"

const windowsEnv = {
  ZEE_TEST_HOME: "C:\\Users\\alice",
  APPDATA: "C:\\Users\\alice\\AppData\\Roaming",
  LOCALAPPDATA: "C:\\Users\\alice\\AppData\\Local",
  ProgramData: "C:\\ProgramData",
  ProgramW6432: "C:\\Program Files",
} as NodeJS.ProcessEnv

describe("global dirs", () => {
  test("uses per-user Windows defaults outside machine scope", () => {
    expect(resolveConfigDir(windowsEnv, "win32")).toBe("C:\\Users\\alice\\AppData\\Roaming\\Zee")
    expect(resolveStateDir(windowsEnv, "win32")).toBe("C:\\Users\\alice\\AppData\\Local\\Zee\\state")
    expect(resolveDataDir(windowsEnv, "win32")).toBe("C:\\Users\\alice\\AppData\\Local\\Zee\\data")
    expect(resolveCacheDir(windowsEnv, "win32")).toBe("C:\\Users\\alice\\AppData\\Local\\Zee\\cache")
    expect(resolveLogsDir(windowsEnv, "win32")).toBe("C:\\Users\\alice\\AppData\\Local\\Zee\\logs")
    expect(resolveWorkspaceDir(windowsEnv, "win32")).toBe("C:\\Users\\alice\\AppData\\Local\\Zee\\workspace")
  })

  test("uses ProgramData for Windows machine scope", () => {
    const env = { ...windowsEnv, ZEE_WINDOWS_SCOPE: "machine" } as NodeJS.ProcessEnv

    expect(resolveConfigDir(env, "win32")).toBe("C:\\ProgramData\\Zee\\config")
    expect(resolveStateDir(env, "win32")).toBe("C:\\ProgramData\\Zee\\state")
    expect(resolveDataDir(env, "win32")).toBe("C:\\ProgramData\\Zee\\data")
    expect(resolveLogsDir(env, "win32")).toBe("C:\\ProgramData\\Zee\\logs")
    expect(resolveWorkspaceDir(env, "win32")).toBe("C:\\ProgramData\\Zee\\workspace")
    expect(resolvePolicyPath(env, "win32")).toBe("C:\\ProgramData\\Zee\\policy.jsonc")
    expect(resolveInstallRoot(env, "win32")).toBe("C:\\Program Files\\Zee")
  })

  test("ZEE_STATE_DIR co-locates runtime directories", () => {
    const env = { ...windowsEnv, ZEE_STATE_DIR: "D:\\ZeeState" } as NodeJS.ProcessEnv

    expect(resolveConfigDir(env, "win32")).toBe("D:\\ZeeState\\config")
    expect(resolveDataDir(env, "win32")).toBe("D:\\ZeeState\\data")
    expect(resolveCacheDir(env, "win32")).toBe("D:\\ZeeState\\cache")
    expect(resolveLogsDir(env, "win32")).toBe("D:\\ZeeState\\logs")
    expect(resolveWorkspaceDir(env, "win32")).toBe("D:\\ZeeState\\workspace")
  })
})
