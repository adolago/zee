import { describe, test, expect } from "bun:test"
import { Pty } from "../../src/pty"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"
import path from "path"

describe("Pty Security", () => {
  test("prevents path traversal in cwd", async () => {
    await using projectDir = await tmpdir({ git: true })

    await Instance.provide({
      directory: projectDir.path,
      fn: async () => {
        const outsideDir = path.resolve(projectDir.path, "..")

        // This SHOULD fail but currently will succeed (so test will fail initially)
        let error: any
        try {
            await Pty.create({
                cwd: outsideDir
            })
        } catch (e) {
            error = e
        }

        expect(error).toBeDefined()
        expect(error.message).toContain("Access denied")
      }
    })
  })
})
