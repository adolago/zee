import { describe, expect, it } from "bun:test"

import { Filesystem } from "../../src/util/filesystem"

describe("Filesystem", () => {
  it("contains treats '..' as a path segment, not a prefix", () => {
    expect(Filesystem.contains("parent", "parent/..foo/file.txt")).toBe(true)
  })

  it("contains returns false for different drive roots on Windows", () => {
    if (process.platform !== "win32") return
    expect(Filesystem.contains("C:\\parent", "D:\\child")).toBe(false)
  })
})
