import { describe, expect, test } from "bun:test"
import { SessionPrompt } from "../../src/session/prompt"

describe("SessionPrompt MCP execute wrapper", () => {
  test("re-wrapping preserves the original base execute handler", async () => {
    let calls = 0

    const original = async () => {
      calls += 1
      return "ok"
    }

    const wrap = (current: typeof original) => {
      const base = SessionPrompt.getMcpExecuteBase(current)
      const wrapped = (async () => base()) as typeof original
      return SessionPrompt.tagMcpExecuteBase(wrapped, base)
    }

    let execute = original
    execute = wrap(execute)
    execute = wrap(execute)
    execute = wrap(execute)

    await execute()

    expect(calls).toBe(1)
    expect(SessionPrompt.getMcpExecuteBase(execute)).toBe(original)
  })
})
