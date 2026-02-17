import { describe, expect, test } from "bun:test"
import { summarizeToolHighlights } from "../../../src/cli/cmd/tui/routes/session/tool-highlights-summary"

function tool(toolName: string) {
  return {
    id: `tool-${toolName}`,
    sessionID: "session-1",
    messageID: "message-1",
    type: "tool",
    callID: `call-${toolName}`,
    tool: toolName,
    state: {
      status: "completed",
      input: {},
      output: "",
      title: "done",
      metadata: {},
      time: {
        start: 1,
        end: 2,
      },
    },
  }
}

function reasoning(text: string) {
  return {
    id: `reasoning-${text}`,
    sessionID: "session-1",
    messageID: "message-1",
    type: "reasoning",
    text,
    time: {
      start: 1,
      end: 2,
    },
  }
}

describe("summarizeToolHighlights", () => {
  test("returns undefined when there are no tool or reasoning highlights", () => {
    const parts = [
      {
        id: "text-1",
        sessionID: "session-1",
        messageID: "message-1",
        type: "text",
        text: "hello",
      },
    ]

    expect(summarizeToolHighlights(parts)).toBeUndefined()
  })

  test("formats counts in a stable order", () => {
    const parts = [reasoning("first"), reasoning("second"), tool("read"), tool("grep"), tool("glob"), tool("bash")]

    expect(summarizeToolHighlights(parts)).toBe("2 thoughts · 1 file read · 2 searches · 1 command")
  })

  test("groups write/edit/apply_patch as writes", () => {
    const parts = [tool("write"), tool("edit"), tool("apply_patch")]

    expect(summarizeToolHighlights(parts)).toBe("3 writes")
  })

  test("counts fallback tools as generic tools", () => {
    const parts = [tool("unknown_tool")]

    expect(summarizeToolHighlights(parts)).toBe("1 tool")
  })
})
