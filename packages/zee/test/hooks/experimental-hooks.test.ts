import { describe, expect, test } from "bun:test"
import * as fs from "node:fs/promises"
import path from "node:path"
import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import { ExperimentalHooks } from "../../src/hooks/experimental-hooks"

describe("ExperimentalHooks", () => {
  test("triggerFileEdited runs hooks for matching patterns", async () => {
    await using tmp = await tmpdir({
      git: true,
      config: {
        experimental: {
          hook: {
            file_edited: {
              "**/*.ts": [
                {
                  command: [
                    process.execPath,
                    "-e",
                    `require("fs").writeFileSync("file-hook.txt", process.env.ZEE_FILE_RELATIVE || "")`,
                  ],
                },
              ],
            },
          },
        },
      },
    })

    const fileAbs = path.join(tmp.path, "src", "a.ts")
    await fs.mkdir(path.dirname(fileAbs), { recursive: true })
    await fs.writeFile(fileAbs, "export {}\n")

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await ExperimentalHooks.triggerFileEdited({
          sessionID: "session_test",
          filePathAbs: fileAbs,
          filePathRel: path.relative(Instance.worktree, fileAbs),
        })
      },
    })

    const out = await fs.readFile(path.join(tmp.path, "file-hook.txt"), "utf-8")
    expect(out.trim()).toBe("src/a.ts")
  })

  test("triggerFileEdited does not run hooks when patterns do not match", async () => {
    await using tmp = await tmpdir({
      git: true,
      config: {
        experimental: {
          hook: {
            file_edited: {
              "**/*.md": [
                {
                  command: [process.execPath, "-e", `require("fs").writeFileSync("should-not-exist.txt", "nope")`],
                },
              ],
            },
          },
        },
      },
    })

    const fileAbs = path.join(tmp.path, "src", "a.ts")
    await fs.mkdir(path.dirname(fileAbs), { recursive: true })
    await fs.writeFile(fileAbs, "export {}\n")

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await ExperimentalHooks.triggerFileEdited({
          sessionID: "session_test",
          filePathAbs: fileAbs,
          filePathRel: path.relative(Instance.worktree, fileAbs),
        })
      },
    })

    await expect(fs.stat(path.join(tmp.path, "should-not-exist.txt"))).rejects.toBeDefined()
  })

  test("triggerSessionCompleted runs hooks", async () => {
    await using tmp = await tmpdir({
      git: true,
      config: {
        experimental: {
          hook: {
            session_completed: [
              {
                command: [
                  process.execPath,
                  "-e",
                  `require("fs").writeFileSync("session-hook.txt", process.env.ZEE_HOOK_EVENT || "")`,
                ],
              },
            ],
          },
        },
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await ExperimentalHooks.triggerSessionCompleted({
          sessionID: "session_test",
          todosCompleted: 1,
          todosRemaining: 0,
        })
      },
    })

    const out = await fs.readFile(path.join(tmp.path, "session-hook.txt"), "utf-8")
    expect(out.trim()).toBe("session_completed")
  })

  test("hook command failures do not throw", async () => {
    await using tmp = await tmpdir({
      git: true,
      config: {
        experimental: {
          hook: {
            session_completed: [
              {
                command: [process.execPath, "-e", "process.exit(2)"],
              },
            ],
          },
        },
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await ExperimentalHooks.triggerSessionCompleted({
          sessionID: "session_test",
          todosCompleted: 0,
          todosRemaining: 0,
        })
      },
    })
  })
})
