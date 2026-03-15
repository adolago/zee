import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { reloadFlags } from "../../src/flag/flag"
import { getAuthorizationHeaderFor, isAuthorized, resolveServerAuthDecision } from "../../src/server/auth"

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

describe("resolveServerAuthDecision", () => {
  test("requires token-style auth for trusted browser origins in token mode", () => {
    const token = Buffer.from("zee:test-password", "utf-8").toString("base64")
    const decision = resolveServerAuthDecision({
      authorizationHeader: `Basic ${token}`,
      origin: "https://control.example.com",
      runtimeConfig: {
        gateway: {
          controlUi: {
            auth: {
              required: true,
              mode: "token",
              allowPasswordOnly: false,
            },
          },
        },
      },
    })

    expect(decision.authorized).toBe(false)
    expect(decision.reason).toBe("token_required")
    expect(decision.challenge).toBe('Bearer realm="zee"')
  })

  test("accepts bearer and X-Zee-Token for trusted browser origins in token mode", () => {
    const runtimeConfig = {
      gateway: {
        controlUi: {
          auth: {
            required: true,
            mode: "token",
            allowPasswordOnly: false,
          },
        },
      },
    }

    expect(
      resolveServerAuthDecision({
        authorizationHeader: "Bearer test-password",
        origin: "https://control.example.com",
        runtimeConfig,
      }),
    ).toMatchObject({
      authorized: true,
      scheme: "bearer",
    })

    expect(
      resolveServerAuthDecision({
        tokenHeader: "test-password",
        origin: "https://control.example.com",
        runtimeConfig,
      }),
    ).toMatchObject({
      authorized: true,
      scheme: "x-zee-token",
    })
  })

  test("allows password downgrade for browser requests only when explicitly configured", () => {
    const token = Buffer.from("zee:test-password", "utf-8").toString("base64")
    const decision = resolveServerAuthDecision({
      authorizationHeader: `Basic ${token}`,
      origin: "https://control.example.com",
      runtimeConfig: {
        gateway: {
          controlUi: {
            auth: {
              required: true,
              mode: "token",
              allowPasswordOnly: true,
            },
          },
        },
      },
    })

    expect(decision.authorized).toBe(true)
    expect(decision.scheme).toBe("basic")
  })

  test("requires basic auth for trusted browser origins in password mode", () => {
    const denied = resolveServerAuthDecision({
      authorizationHeader: "Bearer test-password",
      origin: "https://control.example.com",
      runtimeConfig: {
        gateway: {
          controlUi: {
            auth: {
              required: true,
              mode: "password",
            },
          },
        },
      },
    })

    expect(denied.authorized).toBe(false)
    expect(denied.reason).toBe("password_required")
    expect(denied.challenge).toBe('Basic realm="zee"')

    const token = Buffer.from("zee:test-password", "utf-8").toString("base64")
    expect(
      resolveServerAuthDecision({
        authorizationHeader: `Basic ${token}`,
        origin: "https://control.example.com",
        runtimeConfig: {
          gateway: {
            controlUi: {
              auth: {
                required: true,
                mode: "password",
              },
            },
          },
        },
      }),
    ).toMatchObject({
      authorized: true,
      scheme: "basic",
    })
  })
})

describe("getAuthorizationHeaderFor", () => {
  test("defaults to bearer auth for token-mode clients", () => {
    expect(getAuthorizationHeaderFor()).toBe("Bearer test-password")
  })

  test("uses basic auth when password mode is requested explicitly", () => {
    const token = Buffer.from("zee:test-password", "utf-8").toString("base64")
    expect(
      getAuthorizationHeaderFor({
        gateway: {
          controlUi: {
            auth: {
              mode: "password",
            },
          },
        },
      }),
    ).toBe(`Basic ${token}`)
  })
})
