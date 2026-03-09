import { describe, expect, test } from "bun:test"
import {
  cliColors,
  generateDesktopAssistantTheme,
  generateTuiAssistantTheme,
  getTheme,
  assistantCliColors,
  assistantPalettes,
} from "../../../../src/theme/rosetta"
import { modelString, assistantModels, standardModel } from "../../../../src/agent/model-rosetta"

describe("single-Zee rosetta", () => {
  test("assistant palette and CLI colors are Zee-owned", () => {
    expect(Object.keys(assistantPalettes)).toEqual(["zee"])
    expect(Object.keys(assistantCliColors)).toEqual(["zee"])
    expect(typeof cliColors.zee).toBe("string")
    expect(typeof cliColors.zeeBright).toBe("string")
  })

  test("theme generators emit Zee output", () => {
    expect(getTheme("zee").assistant).toEqual(assistantPalettes.zee)
    expect(generateTuiAssistantTheme("zee").defs.zeePrimary).toBe(assistantPalettes.zee.primary.hex)

    const desktopTheme = generateDesktopAssistantTheme("zee")
    expect(desktopTheme.id).toBe("zee")
    expect(desktopTheme.name).toBe("Zee")
  })

  test("assistant model rosetta resolves to the Zee standard model", () => {
    expect(Object.keys(assistantModels)).toEqual(["zee"])
    expect(assistantModels.zee).toEqual(standardModel)
    expect(modelString(assistantModels.zee)).toBe(modelString(standardModel))
  })
})
