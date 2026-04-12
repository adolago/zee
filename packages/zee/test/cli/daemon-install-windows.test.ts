import { describe, expect, test } from "bun:test"
import {
  parseWindowsServiceStatus,
  resolveWindowsServiceEnvironment,
} from "../../src/cli/cmd/daemon-install"

const windowsEnv = {
  ZEE_TEST_HOME: "C:\\Users\\alice",
  APPDATA: "C:\\Users\\alice\\AppData\\Roaming",
  LOCALAPPDATA: "C:\\Users\\alice\\AppData\\Local",
  ProgramData: "C:\\ProgramData",
  ProgramW6432: "C:\\Program Files",
} as NodeJS.ProcessEnv

describe("Windows daemon install helpers", () => {
  test("uses ProgramData roots for machine-scope service environment", () => {
    const env = resolveWindowsServiceEnvironment({ scope: "machine", port: 3210, hostname: "127.0.0.1" }, windowsEnv)

    expect(env.ZEE_WINDOWS_SCOPE).toBe("machine")
    expect(env.ZEE_STATE_DIR).toBeUndefined()
    expect(env.ZEE_CONFIG_DIR).toBe("C:\\ProgramData\\Zee\\config")
    expect(env.ZEE_LOG_DIR).toBe("C:\\ProgramData\\Zee\\logs")
    expect(env.ZEE_WORKSPACE_DIR).toBe("C:\\ProgramData\\Zee\\workspace")
    expect(env.ZEE_POLICY_FILE).toBe("C:\\ProgramData\\Zee\\policy.jsonc")
    expect(env.ZEE_PORT).toBe("3210")
    expect(env.ZEE_HOSTNAME).toBe("127.0.0.1")
  })

  test("preserves explicit ZEE_STATE_DIR co-location for service overrides", () => {
    const env = resolveWindowsServiceEnvironment(
      { scope: "machine" },
      { ...windowsEnv, ZEE_STATE_DIR: "D:\\ZeeState" },
    )

    expect(env.ZEE_STATE_DIR).toBe("D:\\ZeeState")
    expect(env.ZEE_CONFIG_DIR).toBe("D:\\ZeeState\\config")
    expect(env.ZEE_LOG_DIR).toBe("D:\\ZeeState\\logs")
    expect(env.ZEE_WORKSPACE_DIR).toBe("D:\\ZeeState\\workspace")
  })

  test("parses Windows service status metadata used by --json", () => {
    const status = parseWindowsServiceStatus(
      {
        status: 0,
        stdout: [
          "SERVICE_NAME: Zee",
          "        TYPE               : 10  WIN32_OWN_PROCESS",
          "        STATE              : 4  RUNNING",
          "        PID                : 4321",
        ].join("\r\n"),
      },
      {
        stdout: [
          "SERVICE_NAME: Zee",
          "        START_TYPE         : 2   AUTO_START",
          "        BINARY_PATH_NAME   : \"C:\\Program Files\\Zee\\bin\\zee.exe\" daemon",
          "        SERVICE_START_NAME : NT SERVICE\\Zee",
        ].join("\r\n"),
      },
    )

    expect(status).toEqual({
      name: "Zee",
      path: "HKLM\\SYSTEM\\CurrentControlSet\\Services\\Zee",
      installed: true,
      running: true,
      enabled: true,
      pid: 4321,
      startType: "2   AUTO_START",
      account: "NT SERVICE\\Zee",
      binaryPath: "\"C:\\Program Files\\Zee\\bin\\zee.exe\" daemon",
    })
  })
})
