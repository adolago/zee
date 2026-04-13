import { expect, test } from "bun:test"
import fs from "node:fs/promises"
import path from "node:path"
import { runIntegrityChecks } from "../../src/diagnostics/checks"
import { tmpdir } from "../fixture/fixture"

test("gateway integrity checks no longer depend on pnpm or source-repo paths", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await fs.mkdir(path.join(dir, "config"), { recursive: true })
      await fs.mkdir(path.join(dir, "state"), { recursive: true })
      await fs.mkdir(path.join(dir, "managed"), { recursive: true })
      await Bun.write(
        path.join(dir, "config", "zee.jsonc"),
        JSON.stringify({
          $schema: "zee",
          gateway: {
            controlUi: {
              auth: {
                required: true,
                mode: "token",
              },
            },
          },
        }),
      )
    },
  })

  const original = {
    ZEE_CONFIG_DIR: process.env.ZEE_CONFIG_DIR,
    ZEE_STATE_DIR: process.env.ZEE_STATE_DIR,
    ZEE_TEST_MANAGED_CONFIG_DIR: process.env.ZEE_TEST_MANAGED_CONFIG_DIR,
    ZEE_TEST_POLICY_PATH: process.env.ZEE_TEST_POLICY_PATH,
  }

  process.env.ZEE_CONFIG_DIR = path.join(tmp.path, "config")
  process.env.ZEE_STATE_DIR = path.join(tmp.path, "state")
  process.env.ZEE_TEST_MANAGED_CONFIG_DIR = path.join(tmp.path, "managed")
  process.env.ZEE_TEST_POLICY_PATH = path.join(tmp.path, "managed", "policy.jsonc")

  try {
    const results = await runIntegrityChecks({
      full: false,
      fix: false,
      verbose: false,
      timeout: 1000,
    })

    const gatewayConfig = results.find((result) => result.id === "integrity.gateway-config")
    expect(gatewayConfig).toBeDefined()
    expect(gatewayConfig?.status).not.toBe("skip")
    expect(String(gatewayConfig?.details ?? "")).not.toContain("pnpm not found")
    expect(String(gatewayConfig?.details ?? "")).not.toContain("repo missing")
  } finally {
    if (original.ZEE_CONFIG_DIR === undefined) delete process.env.ZEE_CONFIG_DIR
    else process.env.ZEE_CONFIG_DIR = original.ZEE_CONFIG_DIR

    if (original.ZEE_STATE_DIR === undefined) delete process.env.ZEE_STATE_DIR
    else process.env.ZEE_STATE_DIR = original.ZEE_STATE_DIR

    if (original.ZEE_TEST_MANAGED_CONFIG_DIR === undefined) delete process.env.ZEE_TEST_MANAGED_CONFIG_DIR
    else process.env.ZEE_TEST_MANAGED_CONFIG_DIR = original.ZEE_TEST_MANAGED_CONFIG_DIR

    if (original.ZEE_TEST_POLICY_PATH === undefined) delete process.env.ZEE_TEST_POLICY_PATH
    else process.env.ZEE_TEST_POLICY_PATH = original.ZEE_TEST_POLICY_PATH
  }
})
