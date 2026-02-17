import { describe, expect, test } from "bun:test"
import { Pty } from "../../src/pty"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"
import { Log } from "../../src/util/log"

Log.init({ print: false })

describe("Pty Security", () => {
  test("should prevent spawning shell outside project directory", async () => {
    await using project = await tmpdir()
    await using outside = await tmpdir()

    await Instance.provide({
      directory: project.path,
      fn: async () => {
        // Attempt to spawn in outside directory
        let failed = false
        try {
          const pty = await Pty.create({
            cwd: outside.path,
          })
          // If it succeeds, we should kill it
          await Pty.remove(pty.id)
        } catch (err: any) {
          failed = true
          // We expect a specific error message
          expect(err.message).toContain("Access denied")
        }

        // Assert that it SHOULD have failed
        expect(failed).toBe(true)
      },
    })
  })
})
