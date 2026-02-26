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

describe("session /plan, /accept, /bypass commands", () => {
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
          parts: [{ type: "text", text: "/accept" }],
        })

        const parts = await MessageV2.parts(msg.info.id)
        expect(parts[0]?.type).toBe("text")
        expect((parts[0] as any).text).toContain("ACCEPT mode is not available.")

        const updated = await Session.get(session.id)
        expect(updated.mode).toBeUndefined()
      },
    })
  })

  test("allows /accept on messaging surfaces with valid operator and PIN", async () => {
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
                releaseTimeoutMs: 900000,
              },
            },
          },
        })

        const session = await Session.createNext({ directory: tmp.path, surface: "whatsapp" })
        const msg = await SessionPrompt.prompt({
          sessionID: session.id,
          agent: "zee",
          parts: [{ type: "text", text: "/accept 1234" }],
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
          parts: [{ type: "text", text: "/accept" }],
        })

        const parts = await MessageV2.parts(msg.info.id)
        expect(parts[0]?.type).toBe("text")
        expect((parts[0] as any).text).toContain('requires scope "operator.admin"')

        const updated = await Session.get(session.id)
        expect(updated.mode).toBeUndefined()
      },
    })
  })

  test("/plan sets session to plan mode", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        delete process.env.ZEE_ENABLE_SERVER_AUTH
        delete process.env.ZEE_SERVER_PASSWORD
        delete process.env.ZEE_SERVER_SCOPES
        reloadFlags()

        const session = await Session.createNext({ directory: tmp.path, surface: "cli" })
        // First switch to accept so we can verify /plan switches back
        await Session.update(session.id, (draft) => {
          draft.mode = "accept"
        })

        const msg = await SessionPrompt.prompt({
          sessionID: session.id,
          agent: "zee",
          parts: [{ type: "text", text: "/plan" }],
        })

        const parts = await MessageV2.parts(msg.info.id)
        expect(parts[0]?.type).toBe("text")
        expect((parts[0] as any).text).toContain("Switched to PLAN mode")

        const updated = await Session.get(session.id)
        expect(updated.mode).toBe("plan")
      },
    })
  })

  test("/accept sets session to accept mode on CLI", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        delete process.env.ZEE_ENABLE_SERVER_AUTH
        delete process.env.ZEE_SERVER_PASSWORD
        delete process.env.ZEE_SERVER_SCOPES
        reloadFlags()

        const session = await Session.createNext({ directory: tmp.path, surface: "cli" })
        const msg = await SessionPrompt.prompt({
          sessionID: session.id,
          agent: "zee",
          parts: [{ type: "text", text: "/accept" }],
        })

        const parts = await MessageV2.parts(msg.info.id)
        expect(parts[0]?.type).toBe("text")
        expect((parts[0] as any).text).toContain("Switched to ACCEPT mode")

        const updated = await Session.get(session.id)
        expect(updated.mode).toBe("accept")
      },
    })
  })

  test("/bypass sets session to bypass mode on CLI", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        delete process.env.ZEE_ENABLE_SERVER_AUTH
        delete process.env.ZEE_SERVER_PASSWORD
        delete process.env.ZEE_SERVER_SCOPES
        reloadFlags()

        const session = await Session.createNext({ directory: tmp.path, surface: "cli" })
        const msg = await SessionPrompt.prompt({
          sessionID: session.id,
          agent: "zee",
          parts: [{ type: "text", text: "/bypass" }],
        })

        const parts = await MessageV2.parts(msg.info.id)
        expect(parts[0]?.type).toBe("text")
        expect((parts[0] as any).text).toContain("Switched to BYPASS mode")

        const updated = await Session.get(session.id)
        expect(updated.mode).toBe("bypass")
      },
    })
  })

})

describe("session mode cycling", () => {
  test("cycles through plan -> accept -> bypass -> plan via Session.update", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.createNext({ directory: tmp.path, surface: "cli" })

        // Default mode is undefined (resolves to plan)
        let updated = await Session.get(session.id)
        expect(updated.mode).toBeUndefined()

        // Set to accept
        await Session.update(session.id, (draft) => {
          draft.mode = "accept"
        })
        updated = await Session.get(session.id)
        expect(updated.mode).toBe("accept")

        // Set to bypass
        await Session.update(session.id, (draft) => {
          draft.mode = "bypass"
        })
        updated = await Session.get(session.id)
        expect(updated.mode).toBe("bypass")

        // Set back to plan
        await Session.update(session.id, (draft) => {
          draft.mode = "plan"
        })
        updated = await Session.get(session.id)
        expect(updated.mode).toBe("plan")

        await Session.remove(session.id)
      },
    })
  })

  test("canonicalizes stored case/whitespace mode values", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.createNext({ directory: tmp.path, surface: "cli" })

        await Session.update(session.id, (draft) => {
          ;(draft as any).mode = " BYPASS "
        })

        const updated = await Session.get(session.id)
        expect(updated.mode).toBe("bypass")

        await Session.remove(session.id)
      },
    })
  })
})

describe("resolveMode", () => {
  test("returns plan by default", () => {
    const session = { mode: undefined } as any
    expect(SessionPrompt.resolveMode(session)).toBe("plan")
  })

  test("returns session mode when set", () => {
    expect(SessionPrompt.resolveMode({ mode: "plan" } as any)).toBe("plan")
    expect(SessionPrompt.resolveMode({ mode: "accept" } as any)).toBe("accept")
    expect(SessionPrompt.resolveMode({ mode: "bypass" } as any)).toBe("bypass")
  })

  test("session mode takes precedence over options.mode", () => {
    expect(SessionPrompt.resolveMode({ mode: "plan" } as any, { mode: "bypass" })).toBe("plan")
    expect(SessionPrompt.resolveMode({ mode: "bypass" } as any, { mode: "accept" })).toBe("bypass")
  })

  test("options.mode does not act as fallback when session mode is unset", () => {
    expect(SessionPrompt.resolveMode({ mode: undefined } as any, { mode: "bypass" })).toBe("plan")
    expect(SessionPrompt.resolveMode({ mode: undefined } as any, { mode: "accept" })).toBe("plan")
  })

  test("explicit message mode overrides options/session", () => {
    expect(SessionPrompt.resolveMode({ mode: "plan" } as any, { mode: "bypass" }, "accept")).toBe("accept")
    expect(SessionPrompt.resolveMode({ mode: "bypass" } as any, undefined, "plan")).toBe("plan")
  })

  test("normalizes casing/whitespace for explicit and session modes", () => {
    expect(SessionPrompt.resolveMode({ mode: "plan" } as any, undefined, " ACCEPT ")).toBe("accept")
    expect(SessionPrompt.resolveMode({ mode: " PLAN " } as any)).toBe("plan")
  })

  test("does not treat removed legacy aliases as valid runtime modes", () => {
    expect(SessionPrompt.resolveMode({ mode: "hold" } as any)).toBe("plan")
    expect(SessionPrompt.resolveMode({ mode: "release" } as any)).toBe("plan")
  })
})

describe("resolveSkipPermissions", () => {
  test("resolveSkipPermissions honors explicit override first", () => {
    expect(SessionPrompt.resolveSkipPermissions({ mode: "plan" } as any, { skipPermissions: true })).toBe(
      true,
    )
    expect(SessionPrompt.resolveSkipPermissions({ mode: "accept" } as any, undefined, "bypass")).toBe(
      true,
    )
    expect(SessionPrompt.resolveSkipPermissions({ mode: "bypass" } as any, undefined, "accept")).toBe(
      false,
    )
  })
})

describe("prompt mode ingestion", () => {
  test("top-level prompt mode wins and options.mode is sanitized", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.createNext({ directory: tmp.path, surface: "cli" })
        const message = await SessionPrompt.prompt({
          sessionID: session.id,
          agent: "zee",
          mode: "accept",
          noReply: true,
          options: { mode: "plan", keep: "yes" },
          parts: [{ type: "text", text: "check mode precedence" }],
        })

        expect(message.info.role).toBe("user")
        expect((message.info as any).mode).toBe("accept")
        expect((message.info as any).options).toEqual({ keep: "yes" })
      },
    })
  })

  test("options.mode is ignored when top-level mode is absent", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.createNext({ directory: tmp.path, surface: "cli" })
        const message = await SessionPrompt.prompt({
          sessionID: session.id,
          agent: "zee",
          noReply: true,
          options: { mode: "bypass", keep: "yes" },
          parts: [{ type: "text", text: "check options.mode is ignored" }],
        })

        expect(message.info.role).toBe("user")
        expect((message.info as any).mode).toBeUndefined()
        expect((message.info as any).options).toEqual({ keep: "yes" })
      },
    })
  })

  test("accepts uppercase/whitespace top-level mode and canonicalizes it", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.createNext({ directory: tmp.path, surface: "cli" })
        const message = await SessionPrompt.prompt({
          sessionID: session.id,
          agent: "zee",
          mode: "  ACCEPT " as any,
          noReply: true,
          parts: [{ type: "text", text: "check mode normalization" }],
        })

        expect(message.info.role).toBe("user")
        expect((message.info as any).mode).toBe("accept")
      },
    })
  })

  test("rejects legacy alias mode values in prompt payloads", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.createNext({ directory: tmp.path, surface: "cli" })
        try {
          await SessionPrompt.prompt({
            sessionID: session.id,
            agent: "zee",
            mode: "release" as any,
            noReply: true,
            parts: [{ type: "text", text: "invalid mode" }],
          })
          throw new Error("expected prompt() to reject invalid mode alias")
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          expect(message).toContain("Invalid option")
        }
      },
    })
  })
})
