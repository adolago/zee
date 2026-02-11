import { describe, expect, test } from "bun:test"
import path from "path"
import { readTextLinesBounded } from "../../src/util/read-lines-bounded"
import { tmpdir } from "../fixture/fixture"

describe("util.readTextLinesBounded", () => {
  test("stops reading after limit when more lines exist (bounded bytesRead)", async () => {
    await using tmp = await tmpdir()
    const filepath = path.join(tmp.path, "huge.txt")
    const head = Array.from({ length: 10 }, (_, i) => `line${i}`).join("\n") + "\n"
    const tail = "x".repeat(10 * 1024 * 1024)
    await Bun.write(filepath, head + tail)

    const result = await readTextLinesBounded({
      filepath,
      offset: 0,
      limit: 10,
      maxBytes: 50 * 1024,
      maxLineLength: 2000,
    })

    expect(result.truncatedByBytes).toBe(false)
    expect(result.hasMoreLines).toBe(true)
    expect(result.lines.length).toBe(10)
    expect(result.bytesRead).toBeLessThan(128 * 1024)
  })

  test("truncates by maxBytes without reading the full file", async () => {
    await using tmp = await tmpdir()
    const filepath = path.join(tmp.path, "many-lines.txt")
    const lines = Array.from({ length: 5000 }, (_, i) => `line${i}: ${"y".repeat(80)}`).join("\n")
    await Bun.write(filepath, lines)

    const result = await readTextLinesBounded({
      filepath,
      offset: 0,
      limit: 2000,
      maxBytes: 256,
      maxLineLength: 2000,
    })

    expect(result.truncatedByBytes).toBe(true)
    expect(result.lines.length).toBeGreaterThan(0)
    expect(result.bytesRead).toBeLessThan(128 * 1024)
  })
})

