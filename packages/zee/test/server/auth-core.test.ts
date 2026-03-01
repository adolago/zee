import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { reloadFlags } from "../../src/flag/flag"
import { isAuthorized } from "../../src/server/auth"

const ORIGINAL_ENV = {
  ZEE_ENABLE_SERVER_AUTH: process.env.ZEE_ENABLE_SERVER_AUTH,
  ZEE_DISABLE_SERVER_AUTH: process.env.ZEE_DISABLE_SERVER_AUTH,
  ZEE_SERVER_USERNAME: process.env.ZEE_SERVER_USERNAME,
  ZEE_SERVER_PASSWORD: process.env.ZEE_SERVER_PASSWORD,
}

beforeAll(() => {
  process.env.ZEE_ENABLE_SERVER_AUTH = "1"
  delete process.env.ZEE_DISABLE_SERVER_AUTH
  delete process.env.ZEE_SERVER_USERNAME
  process.env.ZEE_SERVER_PASSWORD = "test-password"
  reloadFlags()
})

afterAll(() => {
  for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  reloadFlags()
})

describe("isAuthorized", () => {
  test("accepts correct basic credentials", () => {
    const token = Buffer.from("zee:test-password", "utf-8").toString("base64")
    expect(isAuthorized(`Basic ${token}`)).toBe(true)
  })

  test("accepts bearer token equal to configured password", () => {
    expect(isAuthorized("Bearer test-password")).toBe(true)
  })

  test("rejects wrong bearer token", () => {
    expect(isAuthorized("Bearer wrong-password")).toBe(false)
  })

  test("rejects malformed basic auth", () => {
    expect(isAuthorized("Basic !!!not-base64!!!")).toBe(false)
  })
})

