import { describe, expect, test } from "bun:test"
import { sanitizeLegacyBannerText, truncateToWidth } from "../../../src/cli/cmd/tui/component/banner-format"

describe("banner formatting", () => {
  test("strips legacy todo prefix and session suffix", () => {
    const text = "[TODO] In progress: Audit stack (session: abc-123)"
    expect(sanitizeLegacyBannerText("todo", text)).toBe("In progress: Audit stack")
  })

  test("keeps non-matching label prefixes unchanged", () => {
    const text = "[TODO] Next: Write tests"
    expect(sanitizeLegacyBannerText("message", text)).toBe("[TODO] Next: Write tests")
  })

  test("normalizes legacy todo summary wording", () => {
    expect(sanitizeLegacyBannerText("todo", "Todos: 8 open")).toBe("8 open tasks")
    expect(sanitizeLegacyBannerText("todo", "Todos: 1 open")).toBe("1 open task")
  })

  test("truncates by display width", () => {
    const truncated = truncateToWidth("ＡＢＣＤEFGH", 8)
    expect(Bun.stringWidth(truncated)).toBeLessThanOrEqual(8)
    expect(truncated.endsWith("...")).toBe(true)
  })
})
