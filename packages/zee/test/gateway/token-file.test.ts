import { afterEach, describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import path from "node:path"
import { readZeeGatewayTokenFromFile } from "../../src/gateway/token"
import { tmpdir } from "../fixture/fixture"

const ORIGINAL_ENV = {
  ZEE_GATEWAY_TOKEN_FILE: process.env.ZEE_GATEWAY_TOKEN_FILE,
}

afterEach(() => {
  for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
})

describe("Zee gateway token file", () => {
  test("reads token from an explicit token file path", async () => {
    await using tmp = await tmpdir()
    const tokenFile = path.join(tmp.path, "zee_gateway_token")
    await fs.writeFile(tokenFile, "test-token\n", "utf-8")
    if (process.platform !== "win32") {
      await fs.chmod(tokenFile, 0o600)
    }

    process.env.ZEE_GATEWAY_TOKEN_FILE = tokenFile

    const token = await readZeeGatewayTokenFromFile({
      env: process.env,
      log: { warn: () => {} },
    })
    expect(token).toBe("test-token")
  })

  test("rejects token files with unsafe permissions on POSIX", async () => {
    if (process.platform === "win32") return

    await using tmp = await tmpdir()
    const tokenFile = path.join(tmp.path, "zee_gateway_token")
    await fs.writeFile(tokenFile, "test-token\n", "utf-8")
    await fs.chmod(tokenFile, 0o644)

    process.env.ZEE_GATEWAY_TOKEN_FILE = tokenFile

    const token = await readZeeGatewayTokenFromFile({
      env: process.env,
      log: { warn: () => {} },
    })
    expect(token).toBeUndefined()
  })

  test("rejects token files that are symlinks on POSIX", async () => {
    if (process.platform === "win32") return

    await using tmp = await tmpdir()
    const real = path.join(tmp.path, "real-token")
    const link = path.join(tmp.path, "zee_gateway_token")
    await fs.writeFile(real, "test-token\n", "utf-8")
    await fs.chmod(real, 0o600)
    await fs.symlink(real, link)

    process.env.ZEE_GATEWAY_TOKEN_FILE = link

    const token = await readZeeGatewayTokenFromFile({
      env: process.env,
      log: { warn: () => {} },
    })
    expect(token).toBeUndefined()
  })
})

