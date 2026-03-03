import { afterEach, describe, expect, test } from "bun:test"
import path from "node:path"
import { tmpdir } from "../fixture/fixture"
import { Auth } from "../../src/auth"
import { handleBotCommand, importLegacyTelegramBridgeSessions, resolveTelegramBotToken } from "../../src/bootstrap/surface"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { Storage } from "../../src/storage/storage"

const TELEGRAM_AUTH_PROVIDER_ID = "telegram-bot"
const originalTelegramToken = process.env.TELEGRAM_BOT_TOKEN
const originalLegacyStatePath = process.env.ZEE_TELEGRAM_STATE

afterEach(async () => {
  await Auth.remove(TELEGRAM_AUTH_PROVIDER_ID).catch(() => {})

  if (originalTelegramToken === undefined) delete process.env.TELEGRAM_BOT_TOKEN
  else process.env.TELEGRAM_BOT_TOKEN = originalTelegramToken

  if (originalLegacyStatePath === undefined) delete process.env.ZEE_TELEGRAM_STATE
  else process.env.ZEE_TELEGRAM_STATE = originalLegacyStatePath
})

function parseCurrentSessionID(text: string): string | undefined {
  const match = text.match(/Current Zee session:\s*(\S+)/)
  return match?.[1]
}

async function readStoredSessionId(key: string[]): Promise<string | undefined> {
  const stored = await Storage.read<{ sessionId?: string }>(key).catch(() => undefined)
  return stored?.sessionId?.trim() || undefined
}

describe("telegram bootstrap helpers", () => {
  test("resolveTelegramBotToken prefers config, then env, then auth store", async () => {
    await Auth.set(TELEGRAM_AUTH_PROVIDER_ID, {
      type: "api",
      key: "auth-token",
    })

    process.env.TELEGRAM_BOT_TOKEN = "env-token"

    await expect(resolveTelegramBotToken(" config-token ")).resolves.toBe("config-token")
    await expect(resolveTelegramBotToken()).resolves.toBe("env-token")

    delete process.env.TELEGRAM_BOT_TOKEN
    await expect(resolveTelegramBotToken()).resolves.toBe("auth-token")
  })

  test("imports legacy telegram bridge mappings once and skips stale entries", async () => {
    await using tmp = await tmpdir()
    const statePath = path.join(tmp.path, "telegram-bridge.json")
    process.env.ZEE_TELEGRAM_STATE = statePath

    await Instance.provide({
      directory: tmp.path,
      async fn() {
        const valid = await Session.create({
          title: "Legacy Telegram Session",
          surface: "telegram",
        })

        await Bun.write(
          statePath,
          JSON.stringify({
            offset: 0,
            sessions: {
              "8556876490": valid.id,
              "-100500": "ses_legacy_missing",
              bad_entry: 123,
            },
          }),
        )

        const imported = await importLegacyTelegramBridgeSessions()
        expect(imported.reason).toBeUndefined()
        expect(imported.imported).toBe(1)
        expect(imported.skipped).toBe(2)

        const dmMapping = await Storage.read<{ sessionId: string }>(["surface_sessions", "telegram", "dm_8556876490"])
        expect(dmMapping.sessionId).toBe(valid.id)

        const secondRun = await importLegacyTelegramBridgeSessions()
        expect(secondRun.reason).toBe("already_imported")
      },
    })
  })

  test("/new includes previous session reference after first reset", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      async fn() {
        const first = await handleBotCommand({
          surface: "telegram",
          command: { name: "/new", args: "" },
          senderId: "8556876490",
          isGroup: false,
        })

        expect(first?.text).toContain("Started a new Zee session for this chat.")
        const firstSession = parseCurrentSessionID(first?.text ?? "")
        expect(firstSession).toBeDefined()

        const second = await handleBotCommand({
          surface: "telegram",
          command: { name: "/new", args: "" },
          senderId: "8556876490",
          isGroup: false,
        })

        expect(second?.text).toContain("Started a new Zee session for this chat.")
        expect(second?.text).toContain(`Previous session: ${firstSession}`)
      },
    })
  })

  test("stores DM topics in separate persistent sessions", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      async fn() {
        const dm = await handleBotCommand({
          surface: "telegram",
          command: { name: "/session", args: "" },
          senderId: "8556876490",
          isGroup: false,
        })
        const dmSession = parseCurrentSessionID(dm?.text ?? "")
        expect(dmSession).toBeDefined()

        const dmTopic = await handleBotCommand({
          surface: "telegram",
          command: { name: "/session", args: "" },
          senderId: "8556876490",
          isGroup: false,
          threadId: "8556876490:topic:42",
        })
        const dmTopicSession = parseCurrentSessionID(dmTopic?.text ?? "")
        expect(dmTopicSession).toBeDefined()
        expect(dmTopicSession).not.toBe(dmSession)

        const dmTopicAgain = await handleBotCommand({
          surface: "telegram",
          command: { name: "/session", args: "" },
          senderId: "8556876490",
          isGroup: false,
          threadId: "8556876490:topic:42",
        })
        expect(parseCurrentSessionID(dmTopicAgain?.text ?? "")).toBe(dmTopicSession)

        expect(await readStoredSessionId(["surface_sessions", "telegram", "dm_8556876490"])).toBe(dmSession)
        expect(await readStoredSessionId(["surface_sessions", "telegram", "dm_topic_8556876490:topic:42"])).toBe(dmTopicSession)
      },
    })
  })

  test("hard-migrates legacy non-forum group topic mapping into canonical group mapping", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      async fn() {
        const legacySession = await Session.create({
          title: "Legacy Topic Session",
          surface: "telegram",
        })
        await Storage.write(["surface_sessions", "telegram", "group_-100777:topic:12"], {
          sessionId: legacySession.id,
        })

        const response = await handleBotCommand({
          surface: "telegram",
          command: { name: "/session", args: "" },
          senderId: "8556876490",
          isGroup: true,
          threadId: "-100777",
        })

        const currentSession = parseCurrentSessionID(response?.text ?? "")
        expect(currentSession).toBe(legacySession.id)
        expect(await readStoredSessionId(["surface_sessions", "telegram", "group_-100777"])).toBe(legacySession.id)
        expect(await readStoredSessionId(["surface_sessions", "telegram", "group_-100777:topic:12"])).toBeUndefined()
      },
    })
  })

  test("migration conflict keeps canonical group mapping and removes legacy topic mapping", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      async fn() {
        const canonicalSession = await Session.create({
          title: "Canonical Group Session",
          surface: "telegram",
        })
        const legacySession = await Session.create({
          title: "Legacy Topic Session",
          surface: "telegram",
        })

        await Storage.write(["surface_sessions", "telegram", "group_-100888"], {
          sessionId: canonicalSession.id,
        })
        await Storage.write(["surface_sessions", "telegram", "group_-100888:topic:21"], {
          sessionId: legacySession.id,
        })

        const response = await handleBotCommand({
          surface: "telegram",
          command: { name: "/session", args: "" },
          senderId: "8556876490",
          isGroup: true,
          threadId: "-100888",
        })

        expect(parseCurrentSessionID(response?.text ?? "")).toBe(canonicalSession.id)
        expect(await readStoredSessionId(["surface_sessions", "telegram", "group_-100888"])).toBe(canonicalSession.id)
        expect(await readStoredSessionId(["surface_sessions", "telegram", "group_-100888:topic:21"])).toBeUndefined()
      },
    })
  })
})
