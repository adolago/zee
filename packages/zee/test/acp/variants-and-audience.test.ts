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

describe("acp.agent variants and audience mapping", () => {
  test("newSession includes variant model ids in availableModels", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const { connection } = createFakeConnection()

        const sdk = {
          global: {
            event: async (opts?: { signal?: AbortSignal }) => ({ stream: createBlockingEventStream(opts?.signal) }),
          },
          session: {
            create: async () => ({ data: { id: "ses_1", time: { created: new Date().toISOString() } } }),
          },
          config: {
            providers: async () => ({
              data: {
                providers: [
                  {
                    id: "zai-coding-plan",
                    name: "Z.AI Coding Plan",
                    models: {
                      "glm-4.7": {
                        id: "glm-4.7",
                        name: "GLM-4.7",
                        variants: { default: {}, thinking: {} },
                      },
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
        const result = await agent.newSession({ cwd, mcpServers: [] } as any)

        const ids = result.models.availableModels.map((m: any) => m.modelId)
        expect(ids).toContain("zai-coding-plan/glm-4.7")
        expect(ids).toContain("zai-coding-plan/glm-4.7#default")
        expect(ids).toContain("zai-coding-plan/glm-4.7#thinking")

        agent.dispose()
      },
    })
  })

  test("prompt maps annotations.audience to synthetic/ignored session parts", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const { connection } = createFakeConnection()

        const prompts: any[] = []
        const sdk = {
          global: {
            event: async (opts?: { signal?: AbortSignal }) => ({ stream: createBlockingEventStream(opts?.signal) }),
          },
          session: {
            create: async () => ({ data: { id: "ses_1", time: { created: new Date().toISOString() } } }),
            prompt: async (params: any) => {
              prompts.push(params)
              return { data: true }
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
        const sessionId = await agent.newSession({ cwd, mcpServers: [] } as any).then((x) => x.sessionId)

        await agent.prompt({
          sessionId,
          prompt: [
            {
              type: "text",
              text: "hello",
              annotations: { audience: ["assistant"] },
            },
          ],
        } as any)

        await agent.prompt({
          sessionId,
          prompt: [
            {
              type: "text",
              text: "world",
              annotations: { audience: ["user"] },
            },
          ],
        } as any)

        expect(prompts).toHaveLength(2)
        expect(prompts[0]?.parts).toEqual([{ type: "text", text: "hello", synthetic: true }])
        expect(prompts[1]?.parts).toEqual([{ type: "text", text: "world", ignored: true }])

        agent.dispose()
      },
    })
  })

  test("processMessage maps synthetic/ignored text parts to ACP annotations.audience", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const { connection, updates } = createFakeConnection()

        const sdk = {
          global: {
            event: async (opts?: { signal?: AbortSignal }) => ({ stream: createBlockingEventStream(opts?.signal) }),
          },
        } as any

        const agent = new ACP.Agent(connection, {
          sdk,
          defaultModel: { providerID: "zai-coding-plan", modelID: "glm-4.7" },
        } as any)

        await (agent as any).processMessage({
          info: { role: "assistant", sessionID: "ses_1" },
          parts: [{ type: "text", text: "a", synthetic: true }],
        })
        await (agent as any).processMessage({
          info: { role: "assistant", sessionID: "ses_1" },
          parts: [{ type: "text", text: "b", ignored: true }],
        })

        const chunks = updates
          .map((u) => u.update)
          .filter((u): u is any => u?.sessionUpdate === "agent_message_chunk")
          .map((u) => u.content)

        expect(chunks).toHaveLength(2)
        expect(chunks[0]?.annotations?.audience).toEqual(["assistant"])
        expect(chunks[1]?.annotations?.audience).toEqual(["user"])

        agent.dispose()
      },
    })
  })

  test("unstable_setSessionModel persists variant and prompt forwards it", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const { connection } = createFakeConnection()

        const prompts: any[] = []
        const sdk = {
          global: {
            event: async (opts?: { signal?: AbortSignal }) => ({ stream: createBlockingEventStream(opts?.signal) }),
          },
          session: {
            create: async () => ({ data: { id: "ses_1", time: { created: new Date().toISOString() } } }),
            prompt: async (params: any) => {
              prompts.push(params)
              return { data: true }
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
                      "glm-4.7": {
                        id: "glm-4.7",
                        name: "GLM-4.7",
                        variants: { default: {}, thinking: {} },
                      },
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
        const sessionId = await agent.newSession({ cwd, mcpServers: [] } as any).then((x) => x.sessionId)

        await agent.unstable_setSessionModel({ sessionId, modelId: "zai-coding-plan/glm-4.7#thinking" } as any)

        await agent.prompt({
          sessionId,
          prompt: [{ type: "text", text: "hi" }],
        } as any)

        expect(prompts).toHaveLength(1)
        expect(prompts[0]?.model).toEqual({ providerID: "zai-coding-plan", modelID: "glm-4.7" })
        expect(prompts[0]?.variant).toBe("thinking")

        agent.dispose()
      },
    })
  })

  test("loadSession restores last user model variant and mode", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const { connection } = createFakeConnection()

        const prompts: any[] = []
        const sdk = {
          global: {
            event: async (opts?: { signal?: AbortSignal }) => ({ stream: createBlockingEventStream(opts?.signal) }),
          },
          session: {
            get: async () => ({ data: { id: "ses_loaded", time: { created: new Date().toISOString() } } }),
            messages: async () => ({
              data: [
                {
                  info: {
                    role: "assistant",
                    sessionID: "ses_loaded",
                    model: { providerID: "default", modelID: "model" },
                    variant: null,
                    agent: "other",
                  },
                  parts: [{ type: "text", text: "previous" }],
                },
                {
                  info: {
                    role: "user",
                    sessionID: "ses_loaded",
                    model: { providerID: "loaded-provider", modelID: "loaded-model" },
                    variant: "thinking",
                    agent: "build",
                  },
                  parts: [{ type: "text", text: "last user" }],
                },
              ],
            }),
            prompt: async (params: any) => {
              prompts.push(params)
              return { data: true }
            },
          },
          config: {
            providers: async () => ({
              data: {
                providers: [
                  {
                    id: "default",
                    name: "Default Provider",
                    models: { model: { id: "model", name: "Model" } },
                  },
                  {
                    id: "loaded-provider",
                    name: "Loaded Provider",
                    models: { "loaded-model": { id: "loaded-model", name: "Loaded Model" } },
                  },
                ],
              },
            }),
          },
          app: {
            agents: async () => ({
              data: [
                {
                  name: "other",
                  description: "other",
                  mode: "agent",
                },
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
          defaultModel: { providerID: "default", modelID: "model" },
        } as any)

        const cwd = "/tmp/zee-acp-test"
        const loaded = await agent.loadSession({ sessionId: "ses_loaded", cwd, mcpServers: [] } as any)

        expect(loaded.models.currentModelId).toBe("loaded-provider/loaded-model#thinking")
        expect(loaded.modes.currentModeId).toBe("build")

        await agent.prompt({ sessionId: "ses_loaded", prompt: [{ type: "text", text: "ping" }] } as any)
        expect(prompts).toHaveLength(1)
        expect(prompts[0]?.model).toEqual({ providerID: "loaded-provider", modelID: "loaded-model" })
        expect(prompts[0]?.variant).toBe("thinking")
        expect(prompts[0]?.agent).toBe("build")

        agent.dispose()
      },
    })
  })
})
