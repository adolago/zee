import { describe, expect, test } from "bun:test"
import { Filesystem } from "../../src/util/filesystem"

describe("Filesystem.sanitizePath", () => {
  test("removes null bytes from string", () => {
    const input = "/some/path/with\0/null/bytes"
    const expected = "/some/path/with/null/bytes"
    expect(Filesystem.sanitizePath(input)).toBe(expected)
  })

  test("returns original string if no null bytes", () => {
    const input = "/some/normal/path"
    expect(Filesystem.sanitizePath(input)).toBe(input)
  })

  test("handles empty string", () => {
    expect(Filesystem.sanitizePath("")).toBe("")
  })

  test("handles string with only null bytes", () => {
    expect(Filesystem.sanitizePath("\0\0\0")).toBe("")
  })
})
