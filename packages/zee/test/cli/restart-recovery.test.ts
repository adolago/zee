import { describe, expect, test } from "bun:test"
import { createRestartIterationHook } from "../../src/cli/cmd/restart-recovery"

describe("createRestartIterationHook", () => {
  test("skips first iteration and runs recovery on subsequent iterations", async () => {
    let calls = 0
    const onIteration = createRestartIterationHook(async () => {
      calls += 1
    })

    expect(await onIteration()).toBe(false)
    expect(calls).toBe(0)

    expect(await onIteration()).toBe(true)
    expect(calls).toBe(1)

    expect(await onIteration()).toBe(true)
    expect(calls).toBe(2)
  })
})
