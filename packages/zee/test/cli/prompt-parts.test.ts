import { describe, expect, test } from "bun:test"
import {
  expandPromptTextParts,
  expandPromptTextPartsFromSanitized,
  sanitizePromptPartsAgainstInput,
} from "../../src/cli/cmd/tui/component/prompt/parts"
import type { PromptInfo } from "../../src/cli/cmd/tui/component/prompt/types"

function textPart(
  placeholder: string,
  start: number,
  end: number,
  text: string,
): Extract<PromptInfo["parts"][number], { type: "text" }> {
  return {
    type: "text",
    text,
    source: {
      text: {
        value: placeholder,
        start,
        end,
      },
    },
  }
}

function filePart(
  placeholder: string,
  start: number,
  end: number,
): Extract<PromptInfo["parts"][number], { type: "file" }> {
  return {
    type: "file",
    mime: "image/png",
    filename: "clipboard.png",
    url: "data:image/png;base64,AAA",
    source: {
      type: "file",
      path: "clipboard.png",
      text: {
        value: placeholder,
        start,
        end,
      },
    },
  }
}

function agentPart(
  placeholder: string,
  start: number,
  end: number,
): Extract<PromptInfo["parts"][number], { type: "agent" }> {
  return {
    type: "agent",
    name: "zee",
    source: {
      value: placeholder,
      start,
      end,
    },
  }
}

describe("prompt parts sanitization", () => {
  test("drops stale pasted text parts that no longer have matching placeholders", () => {
    const placeholderA = "[Pasted ~22 lines]"
    const placeholderB = "[Pasted ~45 lines]"
    const input = "Answer A: [Pasted ~22 lines]\nAnswer B: [Pasted ~45 lines]"
    const result = sanitizePromptPartsAgainstInput(input, [
      textPart("[Pasted ~91 lines]", 0, 18, "old RaaS block"),
      textPart(placeholderA, input.indexOf(placeholderA), input.indexOf(placeholderA) + placeholderA.length, "A"),
      textPart(placeholderB, input.indexOf(placeholderB), input.indexOf(placeholderB) + placeholderB.length, "B"),
    ])

    expect(result.parts).toHaveLength(2)
    expect(result.dropped).toHaveLength(1)
    expect(result.dropped[0]?.reason).toBe("placeholder_not_found")
  })

  test("drops stale file and agent parts when placeholders are absent", () => {
    const input = "only plain text, no placeholders"
    const result = sanitizePromptPartsAgainstInput(input, [filePart("[Image 1]", 0, 9), agentPart("@zee", 0, 4)])

    expect(result.parts).toHaveLength(0)
    expect(result.dropped).toHaveLength(2)
    expect(result.dropped.map((x) => x.reason).every((r) => r === "placeholder_not_found")).toBe(true)
  })

  test("remaps duplicate placeholders deterministically by order", () => {
    const placeholder = "[Pasted ~9 lines]"
    const input = `A ${placeholder} B ${placeholder}`
    const first = input.indexOf(placeholder)
    const second = input.indexOf(placeholder, first + 1)
    const result = sanitizePromptPartsAgainstInput(input, [
      textPart(placeholder, 0, placeholder.length, "first"),
      textPart(placeholder, 0, placeholder.length, "second"),
    ])

    expect(result.parts).toHaveLength(2)
    const firstPart = result.parts[0] as Extract<PromptInfo["parts"][number], { type: "text" }>
    const secondPart = result.parts[1] as Extract<PromptInfo["parts"][number], { type: "text" }>
    expect(firstPart.source?.text.start).toBe(first)
    expect(secondPart.source?.text.start).toBe(second)
    expect(result.remapped).toHaveLength(2)
  })

  test("remaps collision on same range to the next matching occurrence", () => {
    const placeholder = "[Pasted ~3 lines]"
    const input = `${placeholder} ${placeholder}`
    const first = input.indexOf(placeholder)
    const second = input.indexOf(placeholder, first + 1)
    const result = sanitizePromptPartsAgainstInput(input, [
      textPart(placeholder, first, first + placeholder.length, "first"),
      textPart(placeholder, first, first + placeholder.length, "second"),
    ])

    const firstPart = result.parts[0] as Extract<PromptInfo["parts"][number], { type: "text" }>
    const secondPart = result.parts[1] as Extract<PromptInfo["parts"][number], { type: "text" }>
    expect(firstPart.source?.text.start).toBe(first)
    expect(secondPart.source?.text.start).toBe(second)
    expect(result.remapped).toHaveLength(1)
    expect(result.remapped[0]?.reason).toBe("placeholder_collision")
  })
})

describe("prompt text expansion", () => {
  test("expands summarized placeholders using exact ranges instead of naive first match", () => {
    const placeholder = "[Pasted ~3 lines]"
    const input = `${placeholder} ${placeholder}`
    const first = 0
    const second = placeholder.length + 1
    const parts: PromptInfo["parts"] = [
      textPart(placeholder, first, first + placeholder.length, "A"),
      textPart(placeholder, second, second + placeholder.length, "B"),
    ]

    const expanded = expandPromptTextPartsFromSanitized(input, parts)
    expect(expanded).toBe("A B")
  })

  test("sanitizes and expands in one step", () => {
    const placeholder = "[Pasted ~4 lines]"
    const input = `X ${placeholder} Y`
    const expanded = expandPromptTextParts(input, [textPart(placeholder, 0, placeholder.length, "payload")])

    expect(expanded.text).toBe("X payload Y")
    expect(expanded.remapped).toHaveLength(1)
    expect(expanded.dropped).toHaveLength(0)
  })
})
