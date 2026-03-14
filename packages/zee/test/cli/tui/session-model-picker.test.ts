import { describe, expect, test } from "bun:test"
import {
  hasVisibleSessionModelProviders,
  isSessionModelProviderVisible,
  listVisibleSessionModelProviders,
} from "../../../src/cli/cmd/tui/util/session-model-picker"
import {
  getDaemonRuntimeMismatchWarning,
  hasDaemonRuntimeMismatch,
} from "../../../src/cli/cmd/tui/util/runtime-mismatch"

describe("session model picker visibility", () => {
  const kimiProvider = {
    id: "kimi-for-coding",
    models: {
      "kimi-k2.5-thinking": {
        status: "active",
      },
    },
  }

  test("hides removed Google chat providers even if sync data still contains them", () => {
    const visible = isSessionModelProviderVisible(
      {
        id: "google",
        models: {
          "gemini-3.1-pro-preview-customtools": {
            status: "active",
          },
        },
      },
      {
        connectedProviderIDs: ["google"],
        authStatus: {
          google: { valid: true, expiringSoon: false, expiresIn: null },
        },
      },
    )

    expect(visible).toBe(false)
  })

  test("hides configured Kimi when Zee auth is not connected", () => {
    const visible = isSessionModelProviderVisible(kimiProvider, {
      connectedProviderIDs: [],
      authStatus: {},
    })

    expect(visible).toBe(false)
  })

  test("hides providers with invalid stored auth status", () => {
    const visible = isSessionModelProviderVisible(kimiProvider, {
      connectedProviderIDs: ["kimi-for-coding"],
      authStatus: {
        "kimi-for-coding": { valid: false, expiringSoon: false, expiresIn: -1 },
      },
    })

    expect(visible).toBe(false)
  })

  test("shows Kimi only when Zee auth is connected and valid", () => {
    const providers = listVisibleSessionModelProviders([kimiProvider], {
      connectedProviderIDs: ["kimi-for-coding"],
      authStatus: {
        "kimi-for-coding": { valid: true, expiringSoon: false, expiresIn: 600 },
      },
    })

    expect(providers.map((provider) => provider.id)).toEqual(["kimi-for-coding"])
    expect(
      hasVisibleSessionModelProviders([kimiProvider], {
        connectedProviderIDs: ["kimi-for-coding"],
        authStatus: {
          "kimi-for-coding": { valid: true, expiringSoon: false, expiresIn: 600 },
        },
      }),
    ).toBe(true)
  })
})

describe("daemon runtime mismatch", () => {
  test("does not warn when TUI and daemon match", () => {
    const runtime = { version: "0.3.43-nightly", execPath: "/tmp/zee" }
    expect(hasDaemonRuntimeMismatch(runtime, runtime)).toBe(false)
    expect(getDaemonRuntimeMismatchWarning(runtime, runtime)).toBeUndefined()
  })

  test("warns when the daemon is on a different build", () => {
    const daemon = { version: "0.3.39-nightly", execPath: "/tmp/zee" }
    const runtime = { version: "0.3.43-nightly", execPath: "/tmp/zee" }

    expect(hasDaemonRuntimeMismatch(daemon, runtime)).toBe(true)
    expect(getDaemonRuntimeMismatchWarning(daemon, runtime)).toContain("Restart Zee daemon")
  })
})
