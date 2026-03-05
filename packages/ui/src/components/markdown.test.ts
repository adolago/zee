import { describe, expect, test } from "bun:test"
import { markdownSanitizeConfig } from "./markdown"

describe("markdown sanitizer policy", () => {
  test("allows img tags so markdown images render", () => {
    expect(markdownSanitizeConfig.ADD_TAGS).toContain("img")
  })
})
