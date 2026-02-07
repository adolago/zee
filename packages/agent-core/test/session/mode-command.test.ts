import { afterAll, describe, expect, test } from "bun:test"
import { reloadFlags } from "../../src/flag/flag"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { SessionPrompt } from "../../src/session/prompt"
import { MessageV2 } from "../../src/session/message-v2"
import { tmpdir } from "../fixture/fixture"

const ORIGINAL_ENV = {
  AGENT_CORE_ALLOW_MESSAGING_RELEASE: process.env.AGENT_CORE_ALLOW_MESSAGING_RELEASE,
  AGENT_CORE_ENABLE_SERVER_AUTH: process.env.AGENT_CORE_ENABLE_SERVER_AUTH,
  AGENT_CORE_DISABLE_SERVER_AUTH: process.env.AGENT_CORE_DISABLE_SERVER_AUTH,
  AGENT_CORE_SERVER_PASSWORD: process.env.AGENT_CORE_SERVER_PASSWORD,
  AGENT_CORE_SERVER_SCOPES: process.env.AGENT_CORE_SERVER_SCOPES,
}

afterAll(() => {
  for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  reloadFlags()
})

describe("session /hold and /release commands", () => {
  test("blocks /release on messaging surfaces by default", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        delete process.env.AGENT_CORE_ALLOW_MESSAGING_RELEASE
        delete process.env.AGENT_CORE_ENABLE_SERVER_AUTH
        delete process.env.AGENT_CORE_DISABLE_SERVER_AUTH
        delete process.env.AGENT_CORE_SERVER_PASSWORD
        delete process.env.AGENT_CORE_SERVER_SCOPES
        reloadFlags()

        const session = await Session.createNext({ directory: tmp.path, surface: "whatsapp" })
        const msg = await SessionPrompt.prompt({
          sessionID: session.id,
          agent: "zee",
          parts: [{ type: "text", text: "/release" }],
        })

        const parts = await MessageV2.parts(msg.info.id)
        expect(parts[0]?.type).toBe("text")
        expect((parts[0] as any).text).toContain("Refusing to switch to RELEASE mode")

        const updated = await Session.get(session.id)
        expect(updated.mode).toBeUndefined()
      },
    })
  })

  test("allows /release on messaging surfaces when explicitly enabled", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        process.env.AGENT_CORE_ALLOW_MESSAGING_RELEASE = "1"
        delete process.env.AGENT_CORE_ENABLE_SERVER_AUTH
        delete process.env.AGENT_CORE_DISABLE_SERVER_AUTH
        delete process.env.AGENT_CORE_SERVER_PASSWORD
        delete process.env.AGENT_CORE_SERVER_SCOPES
        reloadFlags()

        const session = await Session.createNext({ directory: tmp.path, surface: "whatsapp" })
        const msg = await SessionPrompt.prompt({
          sessionID: session.id,
          agent: "zee",
          parts: [{ type: "text", text: "/release" }],
        })

        const parts = await MessageV2.parts(msg.info.id)
        expect(parts[0]?.type).toBe("text")
        expect((parts[0] as any).text).toContain("Switched to RELEASE mode")

        const updated = await Session.get(session.id)
        expect(updated.mode).toBe("release")
      },
    })
  })

  test("requires operator.admin scope when server auth is enabled", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        delete process.env.AGENT_CORE_ALLOW_MESSAGING_RELEASE
        process.env.AGENT_CORE_ENABLE_SERVER_AUTH = "1"
        delete process.env.AGENT_CORE_DISABLE_SERVER_AUTH
        process.env.AGENT_CORE_SERVER_PASSWORD = "test-password"
        process.env.AGENT_CORE_SERVER_SCOPES = "operator.read"
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
