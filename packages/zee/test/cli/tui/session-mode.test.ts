import { describe, expect, test } from "bun:test"
import {
  nextSessionMode,
  normalizeSessionMode,
  resolveEffectiveSessionMode,
} from "../../../src/cli/cmd/tui/util/session-mode"

describe("TUI session mode helpers", () => {
  test("normalizes case and surrounding whitespace", () => {
    expect(normalizeSessionMode(" Plan ")).toBe("plan")
    expect(normalizeSessionMode("ACCEPT")).toBe("accept")
    expect(normalizeSessionMode(" bypass\t")).toBe("bypass")
  })

  test("does not normalize legacy aliases", () => {
    expect(normalizeSessionMode("hold")).toBeUndefined()
    expect(normalizeSessionMode("release")).toBeUndefined()
  })

  test("prefers persisted session mode over local default", () => {
    const mode = resolveEffectiveSessionMode({
      sessionMode: "bypass",
      localDefault: "plan",
    })
    expect(mode).toBe("bypass")
  })

  test("falls back to local default when session mode is missing", () => {
    const mode = resolveEffectiveSessionMode({
      sessionMode: undefined,
      localDefault: "accept",
    })
    expect(mode).toBe("accept")
  })

  test("cycles through plan -> accept -> bypass -> plan", () => {
    expect(nextSessionMode("plan")).toBe("accept")
    expect(nextSessionMode("accept")).toBe("bypass")
    expect(nextSessionMode("bypass")).toBe("plan")
  })
})
