import { describe, expect, test } from "bun:test"
import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import { Server } from "../../src/server/server"
import { Log } from "../../src/util/log"

type SessionInfo = {
  id: string
  parentID?: string
  title: string
  surface?: string
  mode?: string
  time: {
    updated: number
  }
}

type MessageWithRole = {
  info: {
    role: string
  }
}

async function readJson<T>(response: Response): Promise<T> {
  return (await response.json()) as T
}

describe("P05 session parity harness", () => {
  // P05-SES-001: session continuity run/detach/resume.
  test("P05-SES-001 preserves history and metadata across run -> detach -> resume", async () => {
    await Log.init({ print: false })
    const sandbox = await tmpdir({ git: true })
    try {
      Server.App.reset()

      await Instance.provide({
        directory: sandbox.path,
        fn: async () => {
          const app = Server.App()

          const createSession = await app.request("/session", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              title: "P05 continuity smoke",
              surface: "cli",
            }),
          })
          expect(createSession.status).toBe(200)
          const session = await readJson<SessionInfo>(createSession)
          const sessionID = session.id

          const runStep = await app.request(`/session/${sessionID}/message`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              parts: [{ type: "text", text: "/plan" }],
            }),
          })
          expect(runStep.status).toBe(200)

          const beforeDetachResponse = await app.request(`/session/${sessionID}/message`)
          expect(beforeDetachResponse.status).toBe(200)
          const beforeDetachMessages = await readJson<MessageWithRole[]>(beforeDetachResponse)
          expect(beforeDetachMessages.length).toBeGreaterThanOrEqual(2)

          // Emulate CLI detach/resume resolution (`zee run --continue` picks first root session).
          const listSessions = await app.request("/session")
          expect(listSessions.status).toBe(200)
          const listed = await readJson<SessionInfo[]>(listSessions)
          const resumedSessionID = listed.find((candidate) => !candidate.parentID)?.id
          expect(resumedSessionID).toBe(sessionID)

          const resumeStep = await app.request(`/session/${resumedSessionID}/message`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              parts: [{ type: "text", text: "/accept" }],
            }),
          })
          expect(resumeStep.status).toBe(200)

          const resumedSessionResponse = await app.request(`/session/${sessionID}`)
          expect(resumedSessionResponse.status).toBe(200)
          const resumedSession = await readJson<SessionInfo>(resumedSessionResponse)
          expect(resumedSession.title).toBe("P05 continuity smoke")
          expect(resumedSession.surface).toBe("cli")
          expect(resumedSession.mode).toBe("accept")
          expect(resumedSession.time.updated).toBeGreaterThanOrEqual(session.time.updated)

          const finalMessagesResponse = await app.request(`/session/${sessionID}/message`)
          expect(finalMessagesResponse.status).toBe(200)
          const finalMessages = await readJson<MessageWithRole[]>(finalMessagesResponse)
          expect(finalMessages.length).toBeGreaterThanOrEqual(beforeDetachMessages.length + 2)

          const userCount = finalMessages.filter((entry) => entry.info.role === "user").length
          const assistantCount = finalMessages.filter((entry) => entry.info.role === "assistant").length
          expect(userCount).toBeGreaterThanOrEqual(2)
          expect(assistantCount).toBeGreaterThanOrEqual(2)
        },
      })
    } finally {
      Server.App.reset()
      await sandbox[Symbol.asyncDispose]()
    }
  })
})
