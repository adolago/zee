import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import { Persistence } from "../../src/session/persistence"
import { Session } from "../../src/session"
import fs from "fs/promises"
import path from "path"

describe("Persistence", () => {
  let testDir: Awaited<ReturnType<typeof tmpdir>>

  beforeEach(async () => {
    testDir = await tmpdir({ git: true })
  })

  afterEach(async () => {
    await testDir[Symbol.asyncDispose]()
  })

  describe("init and shutdown", () => {
    test("should initialize without error", async () => {
      await Instance.provide({
        directory: testDir.path,
        fn: async () => {
          await Persistence.init()
          await Persistence.shutdown()
        },
      })
    })

    test("should create recovery marker on init", async () => {
      await Instance.provide({
        directory: testDir.path,
        fn: async () => {
          await Persistence.init()

          // Check recovery marker exists
          const stateDir = path.join(process.env.XDG_STATE_HOME!, "agent-core", "persistence")
          const markerExists = await fs
            .access(path.join(stateDir, "recovery-needed"))
            .then(() => true)
            .catch(() => false)

          expect(markerExists).toBe(true)

          await Persistence.shutdown()
        },
      })
    })

    test("should remove recovery marker on clean shutdown", async () => {
      await Instance.provide({
        directory: testDir.path,
        fn: async () => {
          await Persistence.init()
          await Persistence.shutdown()

          // Check recovery marker is removed
          const stateDir = path.join(process.env.XDG_STATE_HOME!, "agent-core", "persistence")
          const markerExists = await fs
            .access(path.join(stateDir, "recovery-needed"))
            .then(() => true)
            .catch(() => false)

          expect(markerExists).toBe(false)
        },
      })
    })
  })

  describe("last active tracking", () => {
    test("should set and get last active session", async () => {
      await Instance.provide({
        directory: testDir.path,
        fn: async () => {
          await Persistence.init()

          await Persistence.setLastActive("zee", "session-123", 456)

          const lastActive = await Persistence.getLastActive("zee")
          expect(lastActive).toBeTruthy()
          expect(lastActive!.sessionId).toBe("session-123")
          expect(lastActive!.chatId).toBe(456)

          await Persistence.shutdown()
        },
      })
    })

    test("should return null for unknown persona", async () => {
      await Instance.provide({
        directory: testDir.path,
        fn: async () => {
          await Persistence.init()

          const lastActive = await Persistence.getLastActive("stanley")
          expect(lastActive).toBeNull()

          await Persistence.shutdown()
        },
      })
    })

    test("should get all last active sessions", async () => {
      await Instance.provide({
        directory: testDir.path,
        fn: async () => {
          await Persistence.init()

          await Persistence.setLastActive("zee", "session-1")
          await Persistence.setLastActive("stanley", "session-2")

          const all = await Persistence.getAllLastActive()
          expect(all.zee?.sessionId).toBe("session-1")
          expect(all.stanley?.sessionId).toBe("session-2")

          await Persistence.shutdown()
        },
      })
    })
  })

  describe("checkpoint creation", () => {
    test("should create checkpoint", async () => {
      await Instance.provide({
        directory: testDir.path,
        fn: async () => {
          await Persistence.init()

          const checkpointId = await Persistence.createCheckpoint()
          expect(checkpointId).toMatch(/^checkpoint-\d+$/)

          await Persistence.shutdown()
        },
      })
    })
  })
})
