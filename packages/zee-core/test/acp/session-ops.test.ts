import { describe, expect, test } from "bun:test"
import type { AgentSideConnection } from "@agentclientprotocol/sdk"
import { ACP } from "../../src/acp/agent"
import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"

type SessionUpdateParams = Parameters<AgentSideConnection["sessionUpdate"]>[0]
type RequestPermissionParams = Parameters<AgentSideConnection["requestPermission"]>[0]
type RequestPermissionResult = Awaited<ReturnType<AgentSideConnection["requestPermission"]>>

function createBlockingEventStream(signal?: AbortSignal) {
  return (async function* () {
    if (!signal) {
      await new Promise(() => {})
      return
    }
    if (signal.aborted) return
    await new Promise<void>((resolve) => {
      signal.addEventListener("abort", () => resolve(), { once: true })
    })
  })()
}

function createFakeConnection() {
  const updates: SessionUpdateParams[] = []
  const connection = {
    async sessionUpdate(params: SessionUpdateParams) {
      updates.push(params)
    },
    async requestPermission(_params: RequestPermissionParams): Promise<RequestPermissionResult> {
      return { outcome: { outcome: "selected", optionId: "once" } } as RequestPermissionResult
    },
  } as unknown as AgentSideConnection

  return { connection, updates }
}

describe("acp.agent session ops", () => {
  test("unstable_listSessions maps sdk.session.list results", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const { connection } = createFakeConnection()

        const calls: any[] = []
        const sessions = [
          {
            id: "ses_1",
            directory: "/tmp/one",
            title: "One",
            time: { updated: 1700000000 },
          },
          {
            id: "ses_2",
            directory: "/tmp/two",
            title: "",
            time: { updated: 1700000100 },
          },
        ]

        const sdk = {
          global: {
            event: async (opts?: { signal?: AbortSignal }) => ({ stream: createBlockingEventStream(opts?.signal) }),
          },
          session: {
            list: async (params: any, opts?: any) => {
              calls.push({ params, opts })
              return { data: sessions }
            },
          },
        } as any

        const agent = new ACP.Agent(connection, {
          sdk,
          defaultModel: { providerID: "zai-coding-plan", modelID: "glm-4.7" },
        } as any)

        const cwd = "/tmp/zee-acp-test"
        const result = await agent.unstable_listSessions({ cwd } as any)

        expect(calls).toHaveLength(1)
        expect(calls[0]?.params).toEqual({ start: 0, limit: 100, directory: cwd })
        expect(result.nextCursor).toBeUndefined()
        expect(result.sessions).toEqual([
          {
            sessionId: "ses_1",
            cwd: "/tmp/one",
            title: "One",
            updatedAt: new Date(1700000000 * 1000).toISOString(),
          },
          {
            sessionId: "ses_2",
            cwd: "/tmp/two",
            title: undefined,
            updatedAt: new Date(1700000100 * 1000).toISOString(),
          },
        ])

        agent.dispose()
      },
    })
  })

  test("unstable_listSessions paginates with cursor and page size", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const { connection } = createFakeConnection()

        const calls: any[] = []
        const makeSession = (i: number) => ({
          id: `ses_${i}`,
          directory: `/tmp/s${i}`,
          title: `S${i}`,
          time: { updated: 1700000000 + i },
        })

        const sdk = {
          global: {
            event: async (opts?: { signal?: AbortSignal }) => ({ stream: createBlockingEventStream(opts?.signal) }),
          },
          session: {
            list: async (params: any) => {
              calls.push(params)
              if (params.start === 0) {
                return { data: Array.from({ length: 100 }, (_, i) => makeSession(i)) }
              }
              if (params.start === 100) {
                return { data: [makeSession(100)] }
              }
              return { data: [] }
            },
          },
        } as any

        const agent = new ACP.Agent(connection, {
          sdk,
          defaultModel: { providerID: "zai-coding-plan", modelID: "glm-4.7" },
        } as any)

        const cwd = "/tmp/zee-acp-test"
        const page1 = await agent.unstable_listSessions({ cwd } as any)
        expect(page1.nextCursor).toBe("100")

        const page2 = await agent.unstable_listSessions({ cwd, cursor: page1.nextCursor } as any)
        expect(page2.nextCursor).toBeUndefined()

        expect(calls).toEqual([
          { start: 0, limit: 100, directory: cwd },
          { start: 100, limit: 100, directory: cwd },
        ])

        agent.dispose()
      },
    })
  })

  test("unstable_forkSession returns a new sessionId with models and modes", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const { connection } = createFakeConnection()

        const calls = { fork: [] as any[], get: [] as any[] }
        const sdk = {
          global: {
            event: async (opts?: { signal?: AbortSignal }) => ({ stream: createBlockingEventStream(opts?.signal) }),
          },
          session: {
            fork: async (params: any, opts?: any) => {
              calls.fork.push({ params, opts })
              return { data: { id: "ses_forked" } }
            },
            get: async (params: any, opts?: any) => {
              calls.get.push({ params, opts })
              return { data: { id: "ses_forked", time: { created: new Date().toISOString() } } }
            },
          },
          config: {
            providers: async () => ({
              data: {
                providers: [
                  {
                    id: "zai-coding-plan",
                    name: "Z.AI Coding Plan",
                    models: {
                      "glm-4.7": { id: "glm-4.7", name: "GLM-4.7" },
                    },
                  },
                ],
              },
            }),
          },
          app: {
            agents: async () => ({
              data: [
                {
                  name: "build",
                  description: "build",
                  mode: "agent",
                },
              ],
            }),
          },
          command: {
            list: async () => ({ data: [] }),
          },
          mcp: {
            add: async () => ({ data: true }),
          },
        } as any

        const agent = new ACP.Agent(connection, {
          sdk,
          defaultModel: { providerID: "zai-coding-plan", modelID: "glm-4.7" },
        } as any)

        const cwd = "/tmp/zee-acp-test"
        const result = await agent.unstable_forkSession({ sessionId: "ses_src", cwd, mcpServers: [] } as any)

        expect(calls.fork).toHaveLength(1)
        expect(calls.get).toHaveLength(1)
        expect(result.sessionId).toBe("ses_forked")
        expect(result.models?.currentModelId).toBe("zai-coding-plan/glm-4.7")
        expect(result.modes?.availableModes?.map((m: any) => m.id)).toEqual(["build"])

        agent.dispose()
      },
    })
  })
})
