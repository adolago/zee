import { describe, expect, test } from "bun:test"
import { sanitizeAssistantText } from "../../src/util/assistant-sanitize"

describe("assistant text sanitizer", () => {
  test("drops thought blocks", () => {
    const input = `![thought\ninternal\n]`
    expect(sanitizeAssistantText(input)).toBe("")
  })

  test("drops dangling thought prefixes during streaming", () => {
    expect(sanitizeAssistantText("![thought")).toBe("")
  })

  test("drops dangling think tags during streaming", () => {
    expect(sanitizeAssistantText("Hello<think>internal")).toBe("Hello")
  })

  test("drops tool-call json payloads", () => {
    const input = `json\n{\"command\":\"systemctl --user status zee\",\"description\":\"Check status\"}`
    expect(sanitizeAssistantText(input)).toBe("")
  })

  test("drops leaked critical-instruction thought transcripts", () => {
    const input = `烂thought
CRITICAL INSTRUCTION 1:
I am asked to reply HEARTBEAT_OK.
No more tool calls are needed.`
    expect(sanitizeAssistantText(input)).toBe("")
  })

  test("drops mixed critical-instruction artifacts with thought markers", () => {
    const input = `CRITICAL INSTRUCTION 1:
Use bash to inspect daemon logs.
💭thought
I will call the tool now.`
    expect(sanitizeAssistantText(input)).toBe("")
  })

  test("drops effectively empty json transcript artifacts", () => {
    const input = `json
{
  "content": ""
}`
    expect(sanitizeAssistantText(input)).toBe("")
  })

  test("keeps non-leak critical instructions without thought markers", () => {
    const input = "Critical instructions: restart daemon and rerun checks."
    expect(sanitizeAssistantText(input)).toBe(input)
  })

  test("keeps normal responses", () => {
    const input = "Good morning. Calendar for today is empty."
    expect(sanitizeAssistantText(input)).toBe(input)
  })
})
