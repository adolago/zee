import { describe, expect, test } from "bun:test"
import { createServer, type Server } from "node:net"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  listDaemonEvents,
  runTaskViaDaemon,
  type ListEventsResult,
  type TaskRunResult,
} from "@/orchestration/daemon-ipc"

async function detectUnixSocketSupport() {
  const socketDir = await mkdtemp(join(tmpdir(), "zee-orch-ipc-probe-"))
  const socketPath = join(socketDir, "daemon.sock")
  const server = createServer()

  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject)
      server.listen(socketPath, () => {
        server.removeListener("error", reject)
        resolve()
      })
    })
    return true
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === "EPERM") return false
    throw error
  } finally {
    await new Promise<void>((resolve) => {
      server.close(() => resolve())
    })
    await rm(socketDir, { recursive: true, force: true })
  }
}

const unixSocketSupported = await detectUnixSocketSupport()

describe.skipIf(!unixSocketSupported)("daemon orchestration IPC client", () => {
  async function withTestServer<T>(fn: (input: { socketPath: string }) => Promise<T>) {
    const socketDir = await mkdtemp(join(tmpdir(), "zee-orch-ipc-"))
    const socketPath = join(socketDir, "daemon.sock")
    const server = createServer((socket) => {
      let buffer = ""
      socket.on("data", (chunk) => {
        buffer += chunk.toString()
        const idx = buffer.indexOf("\n")
        if (idx < 0) return
        const payload = buffer.slice(0, idx)
        const request = JSON.parse(payload) as { id: string; command: string }

        if (request.command === "run_task") {
          const result: TaskRunResult = {
            task: {
              id: "task-1",
              description: "demo",
              agent: "zee",
              status: "completed",
              priority: 0,
              attempt: 1,
              workerId: "worker-1",
              createdAt: new Date().toISOString(),
              enqueuedAt: new Date().toISOString(),
              startedAt: new Date().toISOString(),
              endedAt: new Date().toISOString(),
            },
            output: "<task_result>ok</task_result>",
          }
          socket.write(
            JSON.stringify({
              id: request.id,
              success: true,
              data: result,
              timestamp: Date.now(),
            }) + "\n",
          )
          return
        }

        const events: ListEventsResult = {
          events: [
            {
              id: 1,
              type: "agent_start",
              timestamp: Date.now(),
              taskId: "task-1",
            },
          ],
          nextCursor: 1,
        }
        socket.write(
          JSON.stringify({
            id: request.id,
            success: true,
            data: events,
            timestamp: Date.now(),
          }) + "\n",
        )
      })
    })

    await new Promise<void>((resolve, reject) => {
      server.once("error", reject)
      server.listen(socketPath, () => {
        server.removeListener("error", reject)
        resolve()
      })
    })

    try {
      return await fn({ socketPath })
    } finally {
      await new Promise<void>((resolve) => {
        server.close(() => resolve())
      })
      await rm(socketDir, { recursive: true, force: true })
    }
  }

  test("runTaskViaDaemon sends run_task request and parses response", async () => {
    await withTestServer(async ({ socketPath }) => {
      const result = await runTaskViaDaemon(
        {
          agent: "zee",
          description: "quick check",
          prompt: "say hi",
        },
        { socketPath },
      )

      expect(result.task.id).toBe("task-1")
      expect(result.task.agent).toBe("zee")
      expect(result.task.status).toBe("completed")
      expect(result.output).toContain("task_result")
    })
  })

  test("listDaemonEvents requests list_events and parses response", async () => {
    await withTestServer(async ({ socketPath }) => {
      const result = await listDaemonEvents({ cursor: 0, limit: 10 }, { socketPath })
      expect(result.events).toHaveLength(1)
      expect(result.events[0].type).toBe("agent_start")
      expect(result.nextCursor).toBe(1)
    })
  })
})
