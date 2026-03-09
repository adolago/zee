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
          const stateDir = path.join(process.env.XDG_STATE_HOME!, "zee", "persistence")
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
          const stateDir = path.join(process.env.XDG_STATE_HOME!, "zee", "persistence")
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

    test("should return null when no last active session exists", async () => {
      await Instance.provide({
        directory: testDir.path,
        fn: async () => {
          await Persistence.init()

          // Ensure a clean slate (last-active persists in global state dir across tests)
          const lastActivePath = path.join(process.env.XDG_STATE_HOME!, "zee", "persistence", "last-active.json")
          await fs.rm(lastActivePath, { force: true }).catch(() => {})

          const lastActive = await Persistence.getLastActive("zee")
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

          const all = await Persistence.getAllLastActive()
          expect(all.zee?.sessionId).toBe("session-1")

          await Persistence.shutdown()
        },
      })
    })

    test("ignores removed legacy last-active entries on read", async () => {
      await Instance.provide({
        directory: testDir.path,
        fn: async () => {
          await Persistence.init()

          const stateDir = path.join(process.env.XDG_STATE_HOME!, "zee", "persistence")
          await fs.mkdir(stateDir, { recursive: true })
          await fs.writeFile(
            path.join(stateDir, "last-active.json"),
            JSON.stringify({
              stanley: { sessionId: "session-stanley", updatedAt: 10 },
              johny: { sessionId: "session-johny", updatedAt: 20 },
            }),
          )

          const lastActive = await Persistence.getLastActive("zee")
          expect(lastActive).toBeNull()

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

  describe("session context persistence", () => {
    test("serializes concurrent context writes without dropping entries", async () => {
      await Instance.provide({
        directory: testDir.path,
        fn: async () => {
          const contextPath = path.join(process.env.XDG_STATE_HOME!, "zee", "persistence", "session-contexts.json")
          await fs.rm(contextPath, { force: true }).catch(() => {})

          await Promise.all([
            Persistence.setSessionContext("session-a", { timestamp: 1, memories: ["a"] }),
            Persistence.setSessionContext("session-b", { timestamp: 2, memories: ["b"] }),
            Persistence.setSessionContext("session-c", { timestamp: 3, memories: ["c"] }),
            Persistence.setSessionContext("session-d", { timestamp: 4, memories: ["d"] }),
          ])

          const [a, b, c, d] = await Promise.all([
            Persistence.getSessionContext("session-a"),
            Persistence.getSessionContext("session-b"),
            Persistence.getSessionContext("session-c"),
            Persistence.getSessionContext("session-d"),
          ])

          expect(a?.memories).toEqual(["a"])
          expect(b?.memories).toEqual(["b"])
          expect(c?.memories).toEqual(["c"])
          expect(d?.memories).toEqual(["d"])
        },
      })
    })

    test("clear removes only the target context key", async () => {
      await Instance.provide({
        directory: testDir.path,
        fn: async () => {
          const contextPath = path.join(process.env.XDG_STATE_HOME!, "zee", "persistence", "session-contexts.json")
          await fs.rm(contextPath, { force: true }).catch(() => {})

          await Persistence.setSessionContext("session-a", { timestamp: 1, memories: ["a"] })
          await Persistence.setSessionContext("session-b", { timestamp: 2, memories: ["b"] })
          await Persistence.setSessionContext("session-c", { timestamp: 3, memories: ["c"] })

          await Persistence.clearSessionContext("session-b")

          expect(await Persistence.getSessionContext("session-a")).not.toBeNull()
          expect(await Persistence.getSessionContext("session-b")).toBeNull()
          expect(await Persistence.getSessionContext("session-c")).not.toBeNull()
        },
      })
    })
  })
})
