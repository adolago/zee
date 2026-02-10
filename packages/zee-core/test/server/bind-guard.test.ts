import { afterEach, describe, expect, test } from "bun:test"
import { reloadFlags } from "../../src/flag/flag"
import { assertSafeServerBind } from "../../src/server/auth"
import { Server } from "../../src/server/server"

const ORIGINAL_ENV = {
  ZEE_ENABLE_SERVER_AUTH: process.env.ZEE_ENABLE_SERVER_AUTH,
  ZEE_DISABLE_SERVER_AUTH: process.env.ZEE_DISABLE_SERVER_AUTH,
  ZEE_SERVER_PASSWORD: process.env.ZEE_SERVER_PASSWORD,
  ZEE_ALLOW_INSECURE_SERVER_NO_AUTH: process.env.ZEE_ALLOW_INSECURE_SERVER_NO_AUTH,
  // Legacy fallbacks.
  AGENT_CORE_ENABLE_SERVER_AUTH: process.env.AGENT_CORE_ENABLE_SERVER_AUTH,
  AGENT_CORE_DISABLE_SERVER_AUTH: process.env.AGENT_CORE_DISABLE_SERVER_AUTH,
  AGENT_CORE_SERVER_PASSWORD: process.env.AGENT_CORE_SERVER_PASSWORD,
  AGENT_CORE_ALLOW_INSECURE_SERVER_NO_AUTH: process.env.AGENT_CORE_ALLOW_INSECURE_SERVER_NO_AUTH,
}

afterEach(() => {
  for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  reloadFlags()
})

describe("server bind guard", () => {
  test("refuses non-loopback bind when auth is disabled (Server.listen backstop)", () => {
    delete process.env.ZEE_ENABLE_SERVER_AUTH
    delete process.env.ZEE_DISABLE_SERVER_AUTH
    delete process.env.ZEE_SERVER_PASSWORD
    delete process.env.ZEE_ALLOW_INSECURE_SERVER_NO_AUTH

    delete process.env.AGENT_CORE_ENABLE_SERVER_AUTH
    delete process.env.AGENT_CORE_DISABLE_SERVER_AUTH
    delete process.env.AGENT_CORE_SERVER_PASSWORD
    delete process.env.AGENT_CORE_ALLOW_INSECURE_SERVER_NO_AUTH
    reloadFlags()

    expect(() => Server.listen({ hostname: "0.0.0.0", port: 0 })).toThrow(/Refusing to bind zee server/)
  })

  test("refuses non-loopback bind when auth is enabled but password is missing", () => {
    process.env.ZEE_ENABLE_SERVER_AUTH = "1"
    delete process.env.ZEE_DISABLE_SERVER_AUTH
    delete process.env.ZEE_SERVER_PASSWORD
    delete process.env.ZEE_ALLOW_INSECURE_SERVER_NO_AUTH

    delete process.env.AGENT_CORE_ENABLE_SERVER_AUTH
    delete process.env.AGENT_CORE_DISABLE_SERVER_AUTH
    delete process.env.AGENT_CORE_SERVER_PASSWORD
    delete process.env.AGENT_CORE_ALLOW_INSECURE_SERVER_NO_AUTH
    reloadFlags()

    expect(() => assertSafeServerBind({ hostname: "0.0.0.0" })).toThrow(/ZEE_SERVER_PASSWORD/)
  })

  test("allows non-loopback bind when auth is enabled and password is set", () => {
    process.env.ZEE_ENABLE_SERVER_AUTH = "1"
    delete process.env.ZEE_DISABLE_SERVER_AUTH
    process.env.ZEE_SERVER_PASSWORD = "test-password"
    delete process.env.ZEE_ALLOW_INSECURE_SERVER_NO_AUTH

    delete process.env.AGENT_CORE_ENABLE_SERVER_AUTH
    delete process.env.AGENT_CORE_DISABLE_SERVER_AUTH
    delete process.env.AGENT_CORE_SERVER_PASSWORD
    delete process.env.AGENT_CORE_ALLOW_INSECURE_SERVER_NO_AUTH
    reloadFlags()

    expect(() => assertSafeServerBind({ hostname: "0.0.0.0" })).not.toThrow()
  })

  test("allows non-loopback bind with explicit insecure override flags", () => {
    delete process.env.ZEE_ENABLE_SERVER_AUTH
    process.env.ZEE_DISABLE_SERVER_AUTH = "1"
    delete process.env.ZEE_SERVER_PASSWORD
    process.env.ZEE_ALLOW_INSECURE_SERVER_NO_AUTH = "1"

    delete process.env.AGENT_CORE_ENABLE_SERVER_AUTH
    delete process.env.AGENT_CORE_DISABLE_SERVER_AUTH
    delete process.env.AGENT_CORE_SERVER_PASSWORD
    delete process.env.AGENT_CORE_ALLOW_INSECURE_SERVER_NO_AUTH
    reloadFlags()

    expect(() => assertSafeServerBind({ hostname: "0.0.0.0" })).not.toThrow()
  })
})
