import { beforeEach, describe, expect, test, afterEach, spyOn } from "bun:test"
import * as AgentModule from "../../src/agent/agent"
import { resolveAgentType } from "../../src/tool/task"

const agents = {
  finder: {},
  librarian: {},
  explore: {},
  plan: {},
  general: {},
  zee: {},
}

const asMockAgent = (name: string) => ((agents as Record<string, {}>)[name] ? ({ name } as any) : undefined)

let getSpy: ReturnType<typeof spyOn> | undefined

beforeEach(() => {
  getSpy = spyOn(AgentModule.Agent, "get").mockImplementation(async (name: string) => asMockAgent(name))
})

afterEach(() => {
  getSpy?.mockRestore()
  getSpy = undefined
})

describe("resolveAgentType", () => {
  test("maps alias finder paths to finder subagent", async () => {
    expect(await resolveAgentType("scout")).toBe("finder")
    expect(await resolveAgentType("searcher", "zee")).toBe("finder")
    expect(await resolveAgentType("SEARCHER", "zee")).toBe("finder")
  })

  test("maps librarian aliases to librarian subagent", async () => {
    expect(await resolveAgentType("archive")).toBe("librarian")
    expect(await resolveAgentType("archive", "zee")).toBe("librarian")
  })

  test("maps known subagents without caller forcing", async () => {
    expect(await resolveAgentType("finder")).toBe("finder")
    expect(await resolveAgentType("FINDER")).toBe("finder")
    expect(await resolveAgentType("librarian")).toBe("librarian")
    expect(await resolveAgentType("developer")).toBe("zee")
  })

  test("routes specialty aliases to zee", async () => {
    expect(await resolveAgentType("investing")).toBe("zee")
    expect(await resolveAgentType("learning")).toBe("zee")
    expect(await resolveAgentType("researcher")).toBe("zee")
    expect(await resolveAgentType("mentor")).toBe("zee")
  })
})
