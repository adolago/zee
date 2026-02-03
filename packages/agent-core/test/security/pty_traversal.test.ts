
import { describe, test, expect } from "bun:test"
import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import { Pty } from "../../src/pty"
import * as path from "path"

describe("Pty Security Vulnerability", () => {
  test("should prevent spawning shell outside project directory", async () => {
    await using tmp = await tmpdir()

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const outsideDir = path.resolve(tmp.path, "..")

        try {
            await Pty.create({
              cwd: outsideDir,
              command: "pwd"
            })
            throw new Error("Vulnerability confirmed: Spawned shell in " + outsideDir)
        } catch (e: any) {
            expect(e.message).toBe("Access denied: path escapes project directory")
        }
      }
    })
  })
})
