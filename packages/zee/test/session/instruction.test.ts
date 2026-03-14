import { describe, expect, test } from "bun:test"
import path from "path"
import fs from "fs/promises"
import { Instance } from "../../src/project/instance"
import { InstructionPrompt } from "../../src/session/instruction"
import { tmpdir } from "../fixture/fixture"

describe("InstructionPrompt.resolve", () => {
  test("returns .claude/CLAUDE.md from subdirectory", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await fs.mkdir(path.join(dir, "subdir", ".claude"), { recursive: true })
        await fs.mkdir(path.join(dir, "subdir", "nested"), { recursive: true })
        await Bun.write(path.join(dir, "subdir", ".claude", "CLAUDE.md"), "# Subdir Claude Instructions")
        await Bun.write(path.join(dir, "subdir", "nested", "file.ts"), "const x = 1")
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const results = await InstructionPrompt.resolve(
          [],
          path.join(tmp.path, "subdir", "nested", "file.ts"),
          "test-message-dotclaude",
        )
        expect(results).toHaveLength(1)
        expect(results[0]?.filepath).toBe(path.join(tmp.path, "subdir", ".claude", "CLAUDE.md"))
      },
    })
  })

  test("CLAUDE.md takes priority over .claude/CLAUDE.md in subdirectory", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await fs.mkdir(path.join(dir, "subdir", ".claude"), { recursive: true })
        await fs.mkdir(path.join(dir, "subdir", "nested"), { recursive: true })
        await Bun.write(path.join(dir, "subdir", "CLAUDE.md"), "# Subdir Instructions")
        await Bun.write(path.join(dir, "subdir", ".claude", "CLAUDE.md"), "# Subdir Claude Instructions")
        await Bun.write(path.join(dir, "subdir", "nested", "file.ts"), "const x = 1")
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const results = await InstructionPrompt.resolve(
          [],
          path.join(tmp.path, "subdir", "nested", "file.ts"),
          "test-message-both",
        )
        expect(results).toHaveLength(1)
        expect(results[0]?.filepath).toBe(path.join(tmp.path, "subdir", "CLAUDE.md"))
      },
    })
  })
})

describe("InstructionPrompt.systemPaths", () => {
  test("finds .claude/CLAUDE.md at project root", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await fs.mkdir(path.join(dir, ".claude"), { recursive: true })
        await Bun.write(path.join(dir, ".claude", "CLAUDE.md"), "# Claude Instructions")
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const paths = await InstructionPrompt.systemPaths()
        expect(paths.has(path.join(tmp.path, ".claude", "CLAUDE.md"))).toBe(true)
      },
    })
  })

  test("CLAUDE.md takes priority over .claude/CLAUDE.md at project root", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await fs.mkdir(path.join(dir, ".claude"), { recursive: true })
        await Bun.write(path.join(dir, "CLAUDE.md"), "# Root Instructions")
        await Bun.write(path.join(dir, ".claude", "CLAUDE.md"), "# Claude Instructions")
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const paths = await InstructionPrompt.systemPaths()
        expect(paths.has(path.join(tmp.path, "CLAUDE.md"))).toBe(true)
        expect(paths.has(path.join(tmp.path, ".claude", "CLAUDE.md"))).toBe(false)
      },
    })
  })

  test("AGENTS.md takes priority over .claude/CLAUDE.md", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await fs.mkdir(path.join(dir, ".claude"), { recursive: true })
        await Bun.write(path.join(dir, "AGENTS.md"), "# Agent Instructions")
        await Bun.write(path.join(dir, ".claude", "CLAUDE.md"), "# Claude Instructions")
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const paths = await InstructionPrompt.systemPaths()
        expect(paths.has(path.join(tmp.path, "AGENTS.md"))).toBe(true)
        expect(paths.has(path.join(tmp.path, ".claude", "CLAUDE.md"))).toBe(false)
      },
    })
  })
})
