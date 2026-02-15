import { afterAll, describe, expect, test } from "bun:test"
import { reloadFlags } from "../../src/flag/flag"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { SessionPrompt } from "../../src/session/prompt"
import { MessageV2 } from "../../src/session/message-v2"
import { Config } from "../../src/config/config"
import { tmpdir } from "../fixture/fixture"

const ORIGINAL_ENV = {
  ZEE_ENABLE_SERVER_AUTH: process.env.ZEE_ENABLE_SERVER_AUTH,
  ZEE_DISABLE_SERVER_AUTH: process.env.ZEE_DISABLE_SERVER_AUTH,
  ZEE_SERVER_PASSWORD: process.env.ZEE_SERVER_PASSWORD,
  ZEE_SERVER_SCOPES: process.env.ZEE_SERVER_SCOPES,
}

afterAll(() => {
  for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  reloadFlags()
})

describe("session /hold, /plan, /release, /accept, /bypass commands", () => {
  test("blocks /accept on messaging surfaces by default", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        delete process.env.ZEE_ENABLE_SERVER_AUTH
        delete process.env.ZEE_SERVER_PASSWORD
        delete process.env.ZEE_SERVER_SCOPES
        reloadFlags()

        const session = await Session.createNext({ directory: tmp.path, surface: "whatsapp" })
        const msg = await SessionPrompt.prompt({
          sessionID: session.id,
          agent: "zee",
          parts: [{ type: "text", text: "/release" }],
        })

        const parts = await MessageV2.parts(msg.info.id)
        expect(parts[0]?.type).toBe("text")
        expect((parts[0] as any).text).toContain("ACCEPT mode is not available.")

        const updated = await Session.get(session.id)
        expect(updated.mode).toBeUndefined()
      },
    })
  })

  test("allows /release (mapped to accept) on messaging surfaces with valid operator and PIN", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        delete process.env.ZEE_ENABLE_SERVER_AUTH
        delete process.env.ZEE_SERVER_PASSWORD
        delete process.env.ZEE_SERVER_SCOPES
        reloadFlags()

        await Config.update({
          experimental: {
            surfaces: {
              whatsapp: {
                operators: ["+15551234567"],
                releasePin: "1234",
              },
            },
          },
        })

        const session = await Session.createNext({ directory: tmp.path, surface: "whatsapp" })
        const msg = await SessionPrompt.prompt({
          sessionID: session.id,
          agent: "zee",
          parts: [{ type: "text", text: "/release 1234" }],
          options: { senderId: "+15551234567" },
        })

        const parts = await MessageV2.parts(msg.info.id)
        expect(parts[0]?.type).toBe("text")
        expect((parts[0] as any).text).toContain("Switched to ACCEPT mode")

        const updated = await Session.get(session.id)
        expect(updated.mode).toBe("accept")
      },
    })
  })

  test("requires operator.admin scope when server auth is enabled", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        delete process.env.ZEE_ALLOW_MESSAGING_RELEASE
        process.env.ZEE_ENABLE_SERVER_AUTH = "1"
        delete process.env.ZEE_DISABLE_SERVER_AUTH
        process.env.ZEE_SERVER_PASSWORD = "test-password"
        process.env.ZEE_SERVER_SCOPES = "operator.read"
        reloadFlags()

        const session = await Session.createNext({ directory: tmp.path, surface: "cli" })
        const msg = await SessionPrompt.prompt({
          sessionID: session.id,
          agent: "zee",
          parts: [{ type: "text", text: "/release" }],
        })

        const parts = await MessageV2.parts(msg.info.id)
        expect(parts[0]?.type).toBe("text")
        expect((parts[0] as any).text).toContain('requires scope "operator.admin"')

        const updated = await Session.get(session.id)
        expect(updated.mode).toBeUndefined()
      },
    })
  })
})
