import { describe, expect, it, vi } from "vitest";

vi.mock("./tui-formatters.js", () => ({
  composeThinkingAndContent: ({
    thinkingText,
    contentText,
    showThinking,
  }: {
    thinkingText?: string;
    contentText?: string;
    showThinking?: boolean;
  }) => {
    const parts: string[] = [];
    if (showThinking && thinkingText?.trim()) {
      parts.push(`[thinking]\n${thinkingText.trim()}`);
    }
    if (contentText?.trim()) {
      parts.push(contentText.trim());
    }
    return parts.join("\n\n").trim();
  },
  extractThinkingFromMessage: (message: unknown) => {
    if (!message || typeof message !== "object") return "";
    const content = (message as { content?: unknown }).content;
    if (!Array.isArray(content)) return "";
    return content
      .map((block) =>
        block && typeof block === "object" && (block as { type?: unknown }).type === "thinking"
          ? (block as { thinking?: string }).thinking
          : undefined,
      )
      .filter((v): v is string => typeof v === "string" && v.trim().length > 0)
      .join("\n")
      .trim();
  },
  extractContentFromMessage: (message: unknown) => {
    if (!message || typeof message !== "object") return "";
    const content = (message as { content?: unknown }).content;
    if (typeof content === "string") return content.trim();
    if (!Array.isArray(content)) return "";
    return content
      .map((block) =>
        block && typeof block === "object" && (block as { type?: unknown }).type === "text"
          ? (block as { text?: string }).text
          : undefined,
      )
      .filter((v): v is string => typeof v === "string" && v.trim().length > 0)
      .join("\n")
      .trim();
  },
  resolveFinalAssistantText: ({
    finalText,
    streamedText,
  }: {
    finalText?: string | null;
    streamedText?: string | null;
  }) => {
    if (finalText?.trim()) return finalText;
    if (streamedText?.trim()) return streamedText;
    return "(no output)";
  },
}));

import { TuiStreamAssembler } from "./tui-stream-assembler.js";

describe("TuiStreamAssembler", () => {
  it("keeps thinking before content even when thinking arrives later", () => {
    const assembler = new TuiStreamAssembler();
    const first = assembler.ingestDelta(
      "run-1",
      {
        role: "assistant",
        content: [{ type: "text", text: "Hello" }],
      },
      true,
    );
    expect(first).toBe("Hello");

    const second = assembler.ingestDelta(
      "run-1",
      {
        role: "assistant",
        content: [{ type: "thinking", thinking: "Brain" }],
      },
      true,
    );
    expect(second).toBe("[thinking]\nBrain\n\nHello");
  });

  it("omits thinking when showThinking is false", () => {
    const assembler = new TuiStreamAssembler();
    const text = assembler.ingestDelta(
      "run-2",
      {
        role: "assistant",
        content: [
          { type: "thinking", thinking: "Hidden" },
          { type: "text", text: "Visible" },
        ],
      },
      false,
    );

    expect(text).toBe("Visible");
  });

  it("falls back to streamed text on empty final payload", () => {
    const assembler = new TuiStreamAssembler();
    assembler.ingestDelta(
      "run-3",
      {
        role: "assistant",
        content: [{ type: "text", text: "Streamed" }],
      },
      false,
    );

    const finalText = assembler.finalize(
      "run-3",
      {
        role: "assistant",
        content: [],
      },
      false,
    );

    expect(finalText).toBe("Streamed");
  });

  it("returns null when delta text is unchanged", () => {
    const assembler = new TuiStreamAssembler();
    const first = assembler.ingestDelta(
      "run-4",
      {
        role: "assistant",
        content: [{ type: "text", text: "Repeat" }],
      },
      false,
    );

    expect(first).toBe("Repeat");

    const second = assembler.ingestDelta(
      "run-4",
      {
        role: "assistant",
        content: [{ type: "text", text: "Repeat" }],
      },
      false,
    );

    expect(second).toBeNull();
  });

  it("keeps richer streamed text when final payload drops earlier blocks", () => {
    const assembler = new TuiStreamAssembler();
    assembler.ingestDelta(
      "run-5",
      {
        role: "assistant",
        content: [
          { type: "text", text: "Before tool call" },
          { type: "tool_use", name: "search" },
          { type: "text", text: "After tool call" },
        ],
      },
      false,
    );

    const finalText = assembler.finalize(
      "run-5",
      {
        role: "assistant",
        content: [
          { type: "tool_use", name: "search" },
          { type: "text", text: "After tool call" },
        ],
      },
      false,
    );

    expect(finalText).toBe("Before tool call\nAfter tool call");
  });

  it("keeps non-empty final text for plain text prefix/suffix updates", () => {
    const assembler = new TuiStreamAssembler();
    assembler.ingestDelta(
      "run-5b",
      {
        role: "assistant",
        content: [
          { type: "text", text: "Draft line 1" },
          { type: "text", text: "Draft line 2" },
        ],
      },
      false,
    );

    const finalText = assembler.finalize(
      "run-5b",
      {
        role: "assistant",
        content: [{ type: "text", text: "Draft line 1" }],
      },
      false,
    );

    expect(finalText).toBe("Draft line 1");
  });

  it("accepts richer final payload when it extends streamed text", () => {
    const assembler = new TuiStreamAssembler();
    assembler.ingestDelta(
      "run-6",
      {
        role: "assistant",
        content: [{ type: "text", text: "Before tool call" }],
      },
      false,
    );

    const finalText = assembler.finalize(
      "run-6",
      {
        role: "assistant",
        content: [
          { type: "text", text: "Before tool call" },
          { type: "text", text: "After tool call" },
        ],
      },
      false,
    );

    expect(finalText).toBe("Before tool call\nAfter tool call");
  });

  it("prefers non-empty final payload when it is not a dropped block regression", () => {
    const assembler = new TuiStreamAssembler();
    assembler.ingestDelta(
      "run-7",
      {
        role: "assistant",
        content: [{ type: "text", text: "NOT OK" }],
      },
      false,
    );

    const finalText = assembler.finalize(
      "run-7",
      {
        role: "assistant",
        content: [{ type: "text", text: "OK" }],
      },
      false,
    );

    expect(finalText).toBe("OK");
  });
});
