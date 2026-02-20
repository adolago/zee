import { describe, expect, test } from "bun:test"
import {
  computePromptHeaderBorderLayout,
  type PromptHeaderBorderLayout,
  type PromptHeaderBorderLayoutInput,
} from "../../../src/cli/cmd/tui/component/prompt/header-border-layout"

function makeInput(overrides: Partial<PromptHeaderBorderLayoutInput> = {}): PromptHeaderBorderLayoutInput {
  return {
    width: 80,
    showContext: true,
    contextText: "55% of 184k",
    skillsText: "10 skills",
    dictationText: "STT",
    vimText: "N",
    modeText: "BYPASS",
    showVim: true,
    ...overrides,
  }
}

function renderRow(layout: PromptHeaderBorderLayout, input: PromptHeaderBorderLayoutInput): string {
  let row = "├"
  if (layout.showContext) row += `${input.contextText}─`
  row += layout.fill
  if (layout.showSkills) row += input.skillsText
  if (layout.showDictation) row += `─${input.dictationText}`
  if (layout.showVim) row += `─${input.vimText}`
  if (layout.showMode) row += `─${input.modeText}`
  row += "─┤"
  return row
}

describe("computePromptHeaderBorderLayout", () => {
  test("keeps context meter on the left and fits exact width", () => {
    const input = makeInput()
    const layout = computePromptHeaderBorderLayout(input)
    const row = renderRow(layout, input)

    expect(layout.showContext).toBe(true)
    expect(row.indexOf(input.contextText)).toBeGreaterThanOrEqual(0)
    expect(row.indexOf(input.contextText)).toBeLessThan(row.indexOf(input.skillsText))
    expect(Bun.stringWidth(row)).toBe(input.width)
  })

  test("drops skills before status badges when width is tight", () => {
    const input = makeInput({ width: 35 })
    const layout = computePromptHeaderBorderLayout(input)

    expect(layout.showSkills).toBe(false)
    expect(layout.showDictation).toBe(true)
    expect(layout.showVim).toBe(true)
    expect(layout.showMode).toBe(true)
    expect(Bun.stringWidth(renderRow(layout, input))).toBe(input.width)
  })

  test("drops mode before vim and dictation when width tightens further", () => {
    const input = makeInput({ width: 26 })
    const layout = computePromptHeaderBorderLayout(input)

    expect(layout.showSkills).toBe(false)
    expect(layout.showMode).toBe(false)
    expect(layout.showVim).toBe(true)
    expect(layout.showDictation).toBe(true)
    expect(Bun.stringWidth(renderRow(layout, input))).toBe(input.width)
  })

  test("hides context if needed to preserve a center fill", () => {
    const input = makeInput({ width: 14, showVim: false, dictationText: "", skillsText: "", modeText: "" })
    const layout = computePromptHeaderBorderLayout(input)

    expect(layout.showContext).toBe(false)
    expect(layout.fill.length).toBe(11)
    expect(renderRow(layout, input)).toBe(`├${"─".repeat(11)}─┤`)
  })

  test("uses display width for fitting when labels include full-width glyphs", () => {
    const input = makeInput({
      width: 36,
      skillsText: "１０ skills",
      modeText: "ＢＹＰＡＳＳ",
    })
    const layout = computePromptHeaderBorderLayout(input)
    const row = renderRow(layout, input)

    expect(Bun.stringWidth(row)).toBe(input.width)
  })
})
