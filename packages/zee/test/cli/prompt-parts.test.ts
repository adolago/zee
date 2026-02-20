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

  test("remaps repeated placeholders by nearest prior range when part order is reordered", () => {
    const placeholder = "[Pasted ~7 lines]"
    const input = `${placeholder} gap ${placeholder} gap ${placeholder}`
    const first = input.indexOf(placeholder)
    const second = input.indexOf(placeholder, first + 1)
    const third = input.indexOf(placeholder, second + 1)
    const result = sanitizePromptPartsAgainstInput(input, [
      textPart(placeholder, third + 1, third + 1 + placeholder.length, "third"),
      textPart(placeholder, first + 1, first + 1 + placeholder.length, "first"),
      textPart(placeholder, second + 1, second + 1 + placeholder.length, "second"),
    ])

    const startsByText = Object.fromEntries(
      result.parts.map((part) => {
        const textPart = part as Extract<PromptInfo["parts"][number], { type: "text" }>
        return [textPart.text, textPart.source?.text.start]
      }),
    )
    expect(startsByText).toEqual({
      third,
      first,
      second,
    })
    expect(result.dropped).toHaveLength(0)
    expect(result.remapped).toHaveLength(3)
  })

  test("drops part when placeholder text is partially edited", () => {
    const placeholder = "[Pasted ~5 lines]"
    const input = `before [Pasted ~5 line] after`
    const originalStart = "before ".length
    const result = sanitizePromptPartsAgainstInput(input, [
      textPart(placeholder, originalStart, originalStart + placeholder.length, "payload"),
    ])

    expect(result.parts).toHaveLength(0)
    expect(result.dropped).toHaveLength(1)
    expect(result.dropped[0]?.reason).toBe("placeholder_not_found")
  })

  test("remaps part after partial edit around placeholder boundaries", () => {
    const placeholder = "[Pasted ~5 lines]"
    const input = `prefix ${placeholder} suffix`
    const staleStart = input.indexOf(placeholder) - 2
    const result = sanitizePromptPartsAgainstInput(input, [textPart(placeholder, staleStart, staleStart + placeholder.length, "payload")])

    expect(result.parts).toHaveLength(1)
    const part = result.parts[0] as Extract<PromptInfo["parts"][number], { type: "text" }>
    expect(part.source?.text.start).toBe(input.indexOf(placeholder))
    expect(result.remapped).toHaveLength(1)
    expect(result.dropped).toHaveLength(0)
  })

  test("self-heals stale mixed entries like history/stash load by dropping unbound payloads", () => {
    const pastedPlaceholder = "[Pasted ~4 lines]"
    const imagePlaceholder = "[Image 1]"
    const mentionPlaceholder = "@zee"
    const input = `${mentionPlaceholder} ${imagePlaceholder} ${pastedPlaceholder}`
    const imageStart = input.indexOf(imagePlaceholder)
    const mentionStart = input.indexOf(mentionPlaceholder)
    const pasteStart = input.indexOf(pastedPlaceholder)
    const result = sanitizePromptPartsAgainstInput(input, [
      textPart(pastedPlaceholder, pasteStart, pasteStart + pastedPlaceholder.length, "fresh pasted content"),
      textPart(pastedPlaceholder, 0, pastedPlaceholder.length, "stale pasted content"),
      filePart(imagePlaceholder, imageStart, imageStart + imagePlaceholder.length),
      filePart("[Image 9]", 0, "[Image 9]".length),
      agentPart(mentionPlaceholder, mentionStart, mentionStart + mentionPlaceholder.length),
      agentPart("@old", 0, 4),
    ])

    expect(result.parts).toHaveLength(3)
    expect(result.parts.map((part) => part.type).sort()).toEqual(["agent", "file", "text"])
    expect(result.dropped).toHaveLength(3)
    expect(result.dropped.map((item) => item.reason).every((reason) => reason === "placeholder_not_found")).toBe(true)
  })

  test("keeps one-to-one binding across file and agent collisions sharing the same placeholder", () => {
    const mention = "@zee"
    const pastedPlaceholder = "[Pasted ~2 lines]"
    const input = `${mention} ${mention} ${pastedPlaceholder}`
    const firstMention = input.indexOf(mention)
    const secondMention = input.indexOf(mention, firstMention + 1)
    const pastedStart = input.indexOf(pastedPlaceholder)
    const result = sanitizePromptPartsAgainstInput(input, [
      agentPart(mention, secondMention, secondMention + mention.length),
      filePart(mention, secondMention, secondMention + mention.length),
      textPart(pastedPlaceholder, pastedStart, pastedStart + pastedPlaceholder.length, "payload"),
    ])

    const mentionStarts = result.parts
      .filter((part) => part.type === "agent" || part.type === "file")
      .map((part) => {
        if (part.type === "agent") return part.source.start
        return part.source.text.start
      })
      .sort((a, b) => a - b)

    expect(mentionStarts).toEqual([firstMention, secondMention])
    expect(result.parts).toHaveLength(3)
    expect(result.dropped).toHaveLength(0)
    expect(result.remapped.some((item) => item.reason === "placeholder_collision")).toBe(true)
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
