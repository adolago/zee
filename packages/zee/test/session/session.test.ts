import { afterEach, describe, expect, test } from "bun:test"
import path from "path"
import { Session } from "../../src/session"
import { Bus } from "../../src/bus"
import { Log } from "../../src/util/log"
import { Instance } from "../../src/project/instance"

const projectRoot = path.join(__dirname, "../..")
Log.init({ print: false })

afterEach(async () => {
  await Instance.disposeDirectory(projectRoot)
})

describe("session.started event", () => {
  test("should emit session.started event when session is created", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        let eventReceived = false
        let receivedInfo: Session.Info | undefined

        const unsub = Bus.subscribe(Session.Event.Created, (event) => {
          eventReceived = true
          receivedInfo = event.properties.info as Session.Info
        })

        const session = await Session.create({})

        await new Promise((resolve) => setTimeout(resolve, 100))

        unsub()

        expect(eventReceived).toBe(true)
        expect(receivedInfo).toBeDefined()
        expect(receivedInfo?.id).toBe(session.id)
        expect(receivedInfo?.projectID).toBe(session.projectID)
        expect(receivedInfo?.directory).toBe(session.directory)
        expect(receivedInfo?.title).toBe(session.title)

        await Session.remove(session.id)
      },
    })
  })

  test("session.started event should be emitted before session.updated", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const events: string[] = []

        const unsubStarted = Bus.subscribe(Session.Event.Created, () => {
          events.push("started")
        })

        const unsubUpdated = Bus.subscribe(Session.Event.Updated, () => {
          events.push("updated")
        })

        const session = await Session.create({})

        await new Promise((resolve) => setTimeout(resolve, 100))

        unsubStarted()
        unsubUpdated()

        expect(events).toContain("started")
        expect(events).toContain("updated")
        expect(events.indexOf("started")).toBeLessThan(events.indexOf("updated"))

        await Session.remove(session.id)
      },
    })
  })
})

describe("Session.touch", () => {
  test("clears archived time so archived sessions reopen on interaction", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const session = await Session.create({})
        await Session.update(
          session.id,
          (draft) => {
            draft.time.archived = Date.now()
          },
          { touch: false },
        )

        const archived = await Session.get(session.id)
        expect(archived.time.archived).toBeDefined()

        let updatedInfo: Session.Info | undefined
        const unsub = Bus.subscribe(Session.Event.Updated, (event) => {
          updatedInfo = event.properties.info as Session.Info
        })

        await Session.touch(session.id)
        await new Promise((resolve) => setTimeout(resolve, 100))

        unsub()

        const touched = await Session.get(session.id)
        expect(touched.time.archived).toBeUndefined()
        expect(updatedInfo?.time.archived).toBeUndefined()

        await Session.remove(session.id)
      },
    })
  })
})
