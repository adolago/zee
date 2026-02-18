import { describe, expect, test } from "bun:test"
import { buildCompactToolTimeline } from "../../../src/cli/cmd/tui/routes/session/tool-call-timeline"

function reasoning(text: string) {
  return {
    id: `reasoning-${text}`,
    sessionID: "session-1",
    messageID: "message-1",
    type: "reasoning" as const,
    text,
    time: { start: 1, end: 2 },
  }
}

function completedTool(tool: string, input: Record<string, unknown> = {}, metadata: Record<string, unknown> = {}) {
  return {
    id: `tool-${tool}`,
    sessionID: "session-1",
    messageID: "message-1",
    type: "tool" as const,
    callID: `call-${tool}`,
    tool,
    state: {
      status: "completed" as const,
      input,
      output: "",
      title: "done",
      metadata,
      time: { start: 1, end: 2 },
    },
  }
}

function failedTool(tool: string, input: Record<string, unknown> = {}, metadata: Record<string, unknown> = {}) {
  return {
    id: `tool-${tool}`,
    sessionID: "session-1",
    messageID: "message-1",
    type: "tool" as const,
    callID: `call-${tool}`,
    tool,
    state: {
      status: "error" as const,
      input,
      error: "failed",
      metadata,
      time: { start: 1, end: 2 },
    },
  }
}

describe("buildCompactToolTimeline", () => {
  test("summarizes lightweight actions and keeps concrete actions in order", () => {
    const parts = [
      reasoning("a"),
      reasoning("b"),
      completedTool("websearch", { query: "npm package name" }),
      completedTool("edit", { filePath: "../zee-bot.com/deploy.sh" }, { diff: "@@\n+one\n+two\n context" }),
      completedTool("read", { filePath: "README.md" }),
      completedTool("bash", { command: "chmod +x /tmp/deploy.sh" }),
      reasoning("c"),
    ]

    expect(buildCompactToolTimeline(parts as any)).toEqual([
      "✓ 2 thoughts, 1 search",
      "✓ Edited ../zee-bot.com/deploy.sh +2",
      "✓ 1 file read",
      "$ chmod +x /tmp/deploy.sh",
      "✓ 1 thought",
    ])
  })

  test("compacts apply_patch with multiple files into generic edited files", () => {
    const parts = [
      completedTool(
        "apply_patch",
        { patchText: "..." },
        { files: [{ relativePath: "a.ts" }, { relativePath: "b.ts" }] },
      ),
    ]

    expect(buildCompactToolTimeline(parts as any)).toEqual(["✓ Edited files"])
  })

  test("uses failure marker for errored concrete tools", () => {
    const parts = [failedTool("edit", { filePath: "broken.ts" })]
    expect(buildCompactToolTimeline(parts as any)).toEqual(["✗ Edited broken.ts"])
  })
})
