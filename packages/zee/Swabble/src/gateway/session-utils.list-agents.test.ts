import { beforeAll, describe, expect, it, vi } from "vitest"

vi.mock("proper-lockfile", () => {
  const lock = vi.fn(async () => vi.fn())
  const unlock = vi.fn(async () => {})
  const check = vi.fn(async () => false)
  return {
    lock,
    unlock,
    check,
    default: { lock, unlock, check },
  }
})

vi.mock("../config/sessions.js", () => ({
  buildGroupDisplayName: vi.fn(() => "group"),
  canonicalizeMainSessionAlias: vi.fn(({ sessionKey }) => sessionKey),
  loadSessionStore: vi.fn(() => ({})),
  resolveMainSessionKey: vi.fn((key) => key),
  resolveStorePath: vi.fn(() => ""),
}))

let listAgentsForGateway: (typeof import("./session-utils.js"))["listAgentsForGateway"]

beforeAll(async () => {
  ;({ listAgentsForGateway } = await import("./session-utils.js"))
})

describe("listAgentsForGateway", () => {
  it("does not append phantom main when agents.list excludes main", () => {
    const result = listAgentsForGateway({
      agents: {
        list: [{ id: "ops" }],
      },
    })

    expect(result.defaultId).toBe("ops")
    expect(result.mainKey).toBe("main")
    expect(result.agents.map((agent) => agent.id)).toEqual(["ops"])
  })

  it("keeps main in listing when no explicit allowlist exists", () => {
    const result = listAgentsForGateway({})
    expect(result.agents.some((agent) => agent.id === "main")).toBe(true)
  })
})
