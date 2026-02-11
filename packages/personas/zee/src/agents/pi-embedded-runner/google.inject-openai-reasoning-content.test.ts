import type { AgentMessage } from "@mariozechner/pi-agent-core";
import { describe, expect, it } from "vitest";
import { injectOpenAIReasoningContent } from "./google.js";

describe("injectOpenAIReasoningContent", () => {
  it("returns messages unchanged when no thinking blocks exist", () => {
    const messages: AgentMessage[] = [
      { role: "user", content: "hello" },
      { role: "assistant", content: [{ type: "text", text: "hi" }] },
    ];
    const result = injectOpenAIReasoningContent(messages);
    expect(result).toBe(messages);
  });

  it("adds reasoning_content to assistant message with thinking block", () => {
    const messages: AgentMessage[] = [
      { role: "user", content: "hello" },
      {
        role: "assistant",
        content: [
          { type: "thinking", thinking: "let me think" },
          { type: "text", text: "hi" },
        ],
      },
    ];
    const result = injectOpenAIReasoningContent(messages);
    const assistant = result[1] as any;
    expect(assistant.providerOptions.openaiCompatible.reasoning_content).toBe("let me think");
  });

  it("adds empty reasoning_content to tool-call-only assistant messages", () => {
    const messages: AgentMessage[] = [
      { role: "user", content: "search for X" },
      {
        role: "assistant",
        content: [
          { type: "thinking", thinking: "I should search" },
          { type: "tool-call", toolCallId: "tc1", toolName: "search", args: { q: "X" } },
        ],
      },
      {
        role: "tool",
        content: [{ type: "tool-result", toolCallId: "tc1", result: "found X" }],
      },
      {
        role: "assistant",
        content: [
          { type: "tool-call", toolCallId: "tc2", toolName: "read", args: { file: "x.txt" } },
        ],
      },
    ];
    const result = injectOpenAIReasoningContent(messages);

    // First assistant: has thinking text
    const first = result[1] as any;
    expect(first.providerOptions.openaiCompatible.reasoning_content).toBe("I should search");

    // Second assistant: no thinking block -> empty string
    const second = result[3] as any;
    expect(second.providerOptions.openaiCompatible.reasoning_content).toBe("");
  });

  it("preserves existing providerOptions", () => {
    const messages: AgentMessage[] = [
      { role: "user", content: "hi" },
      {
        role: "assistant",
        content: [{ type: "thinking", thinking: "hmm" }, { type: "text", text: "ok" }],
        providerOptions: { openaiCompatible: { someField: "value" } },
      },
    ];
    const result = injectOpenAIReasoningContent(messages);
    const assistant = result[1] as any;
    expect(assistant.providerOptions.openaiCompatible.someField).toBe("value");
    expect(assistant.providerOptions.openaiCompatible.reasoning_content).toBe("hmm");
  });

  it("skips assistant messages that already have reasoning_content", () => {
    const messages: AgentMessage[] = [
      { role: "user", content: "hi" },
      {
        role: "assistant",
        content: [{ type: "thinking", thinking: "original" }, { type: "text", text: "ok" }],
        providerOptions: { openaiCompatible: { reasoning_content: "already set" } },
      },
    ];
    const result = injectOpenAIReasoningContent(messages);
    const assistant = result[1] as any;
    expect(assistant.providerOptions.openaiCompatible.reasoning_content).toBe("already set");
  });

  it("does not modify user or tool messages", () => {
    const user: AgentMessage = { role: "user", content: "hello" };
    const tool: AgentMessage = {
      role: "tool",
      content: [{ type: "tool-result", toolCallId: "tc1", result: "done" }],
    };
    const messages: AgentMessage[] = [
      user,
      {
        role: "assistant",
        content: [{ type: "thinking", thinking: "think" }, { type: "text", text: "reply" }],
      },
      tool,
    ];
    const result = injectOpenAIReasoningContent(messages);
    expect(result[0]).toBe(user);
    expect(result[2]).toBe(tool);
  });

  it("concatenates multiple thinking blocks", () => {
    const messages: AgentMessage[] = [
      { role: "user", content: "hi" },
      {
        role: "assistant",
        content: [
          { type: "thinking", thinking: "first thought" },
          { type: "thinking", thinking: " second thought" },
          { type: "text", text: "answer" },
        ],
      },
    ];
    const result = injectOpenAIReasoningContent(messages);
    const assistant = result[1] as any;
    expect(assistant.providerOptions.openaiCompatible.reasoning_content).toBe(
      "first thought second thought",
    );
  });
});
