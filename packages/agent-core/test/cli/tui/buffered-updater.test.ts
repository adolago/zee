import { describe, expect, mock, test } from "bun:test"
import { createBufferedUpdater } from "../../../src/cli/cmd/tui/context/buffered-updater"

describe("buffered updater", () => {
  test("coalesces updates by key and flushes once", async () => {
    const apply = mock((_: Array<{ id: string; v: number }>) => {})
    const u = createBufferedUpdater<{ id: string; v: number }>({
      key: (x) => x.id,
      flushMs: 1,
      apply,
    })

    u.push({ id: "a", v: 1 })
    u.push({ id: "a", v: 2 })
    u.push({ id: "b", v: 3 })

    await new Promise((r) => setTimeout(r, 5))

    expect(apply).toHaveBeenCalledTimes(1)
    const items = apply.mock.calls[0]?.[0] ?? []
    // Map order isn't specified; compare as a map.
    const m = new Map(items.map((x: { id: string; v: number }) => [x.id, x.v]))
    expect(m.get("a")).toBe(2)
    expect(m.get("b")).toBe(3)
  })

  test("flushNow applies immediately", () => {
    const apply = mock((_: Array<{ id: string; v: number }>) => {})
    const u = createBufferedUpdater<{ id: string; v: number }>({
      key: (x) => x.id,
      flushMs: 1000,
      apply,
    })

    u.push({ id: "a", v: 1 })
    u.flushNow()

    expect(apply).toHaveBeenCalledTimes(1)
    expect(apply.mock.calls[0]?.[0]).toEqual([{ id: "a", v: 1 }])
  })
})
