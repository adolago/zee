import { describe, expect, test } from "bun:test"
import { jsonSchema, tool, type Tool } from "ai"
import { LLM } from "../../src/session/llm"
import type { ModelMessage } from "ai"

describe("session.llm.hasToolCalls", () => {
  test("returns false for empty messages array", () => {
    expect(LLM.hasToolCalls([])).toBe(false)
  })

  test("returns false for messages with only text content", () => {
    const messages: ModelMessage[] = [
      {
        role: "user",
        content: [{ type: "text", text: "Hello" }],
      },
      {
        role: "assistant",
        content: [{ type: "text", text: "Hi there" }],
      },
    ]
    expect(LLM.hasToolCalls(messages)).toBe(false)
  })

  test("returns true when messages contain tool-call", () => {
    const messages = [
      {
        role: "user",
        content: [{ type: "text", text: "Run a command" }],
      },
      {
        role: "assistant",
        content: [
          {
            type: "tool-call",
            toolCallId: "call-123",
            toolName: "bash",
          },
        ],
      },
    ] as ModelMessage[]
    expect(LLM.hasToolCalls(messages)).toBe(true)
  })

  test("returns true when messages contain tool-result", () => {
    const messages = [
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "call-123",
            toolName: "bash",
          },
        ],
      },
    ] as ModelMessage[]
    expect(LLM.hasToolCalls(messages)).toBe(true)
  })

  test("returns false for messages with string content", () => {
    const messages: ModelMessage[] = [
      {
        role: "user",
        content: "Hello world",
      },
      {
        role: "assistant",
        content: "Hi there",
      },
    ]
    expect(LLM.hasToolCalls(messages)).toBe(false)
  })

  test("returns true when tool-call is mixed with text content", () => {
    const messages = [
      {
        role: "assistant",
        content: [
          { type: "text", text: "Let me run that command" },
          {
            type: "tool-call",
            toolCallId: "call-456",
            toolName: "read",
          },
        ],
      },
    ] as ModelMessage[]
    expect(LLM.hasToolCalls(messages)).toBe(true)
  })
})

describe("session.llm.prepareTools", () => {
  const xaiModel = {
    id: "grok-4",
    providerID: "xai",
    api: {
      id: "grok-4",
      url: "https://api.x.ai/v1",
      npm: "@ai-sdk/openai-compatible",
    },
    name: "Grok 4",
    capabilities: {
      temperature: true,
      reasoning: true,
      attachment: true,
      toolcall: true,
      input: { text: true, audio: false, image: true, video: false, pdf: false },
      output: { text: true, audio: false, image: false, video: false, pdf: false },
      interleaved: false,
    },
    cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
    limit: { context: 128000, input: 128000, output: 8192 },
    status: "active",
    options: {},
    headers: {},
    release_date: "2026-01-01",
  } as any

  test("caps xai tools by count and schema budget", () => {
    const tools: Record<string, Tool> = {}
    for (let i = 0; i < 120; i++) {
      const properties: Record<string, { type: "string"; description: string }> = {}
      for (let j = 0; j < 25; j++) {
        properties[`f_${i}_${j}`] = { type: "string", description: "x".repeat(120) }
      }
      tools[`tool_${i}`] = tool({
        description: `tool ${i}`,
        inputSchema: jsonSchema({ type: "object", properties }),
        execute: async () => ({ ok: true }),
      })
    }

    const prepared = LLM.prepareTools({ model: xaiModel, tools })
    expect(prepared.active.length).toBeLessThanOrEqual(40)
    const bytes = new TextEncoder().encode(
      JSON.stringify(
        prepared.active.map((id) => {
          const entry = prepared.tools[id] as Tool & { inputSchema?: { jsonSchema?: unknown } }
          return {
            type: "function",
            function: {
              name: id,
              description: entry.description,
              parameters: entry.inputSchema?.jsonSchema ?? {},
            },
          }
        }),
      ),
    ).length
    expect(bytes).toBeLessThanOrEqual(20000)
  })

  test("drops an oversized single xai tool when tool choice is auto", () => {
    const properties: Record<string, { type: "string"; description: string }> = {}
    for (let i = 0; i < 400; i++) {
      properties[`f_${i}`] = { type: "string", description: "x".repeat(220) }
    }
    const giant = tool({
      description: "giant",
      inputSchema: jsonSchema({ type: "object", properties }),
      execute: async () => ({ ok: true }),
    })

    const prepared = LLM.prepareTools({
      model: xaiModel,
      tools: { giant },
      toolChoice: "auto",
    })

    expect(prepared.active).toEqual([])
    expect(Object.keys(prepared.tools)).toEqual([])
  })
})
