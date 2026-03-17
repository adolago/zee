import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import type { Tool } from "../../src/tool/tool"
import { Instance } from "../../src/project/instance"
import { assertExternalDirectory } from "../../src/tool/external-directory"
import type { PermissionNext } from "../../src/permission/next"
import { tmpdir } from "../fixture/fixture"

const baseCtx: Omit<Tool.Context, "ask"> = {
  sessionID: "test",
  messageID: "",
  callID: "",
  agent: "build",
  abort: AbortSignal.any([]),
  directory: "/tmp/project", // Default, overridden per-test as needed
  worktree: "/tmp/project",
  messages: [],
  metadata: () => {},
}

describe("tool.assertExternalDirectory", () => {
  test("no-ops for empty target", async () => {
    const requests: Array<Omit<PermissionNext.Request, "id" | "sessionID" | "tool">> = []
    const ctx: Tool.Context = {
      ...baseCtx,
      ask: async (req) => {
        requests.push(req)
      },
    }

    await Instance.provide({
      directory: "/tmp",
      fn: async () => {
        await assertExternalDirectory(ctx)
      },
    })

    expect(requests.length).toBe(0)
  })

  test("no-ops for paths inside Instance.directory", async () => {
    const requests: Array<Omit<PermissionNext.Request, "id" | "sessionID" | "tool">> = []
    const ctx: Tool.Context = {
      ...baseCtx,
      ask: async (req) => {
        requests.push(req)
      },
    }

    await Instance.provide({
      directory: "/tmp/project",
      fn: async () => {
        await assertExternalDirectory(ctx, path.join("/tmp/project", "file.txt"))
      },
    })

    expect(requests.length).toBe(0)
  })

  test("asks with a single canonical glob", async () => {
    const requests: Array<Omit<PermissionNext.Request, "id" | "sessionID" | "tool">> = []
    const ctx: Tool.Context = {
      ...baseCtx,
      ask: async (req) => {
        requests.push(req)
      },
    }

    const directory = "/tmp/project"
    const target = "/tmp/outside/file.txt"
    const expected = path.join(path.dirname(target), "*")

    await Instance.provide({
      directory,
      fn: async () => {
        await assertExternalDirectory(ctx, target)
      },
    })

    const req = requests.find((r) => r.permission === "external_directory")
    expect(req).toBeDefined()
    expect(req!.patterns).toEqual([expected])
    expect(req!.always).toEqual([expected])
  })

  test("rejects hardlinked files by default", async () => {
    const requests: Array<Omit<PermissionNext.Request, "id" | "sessionID" | "tool">> = []
    const ctx: Tool.Context = {
      ...baseCtx,
      ask: async (req) => {
        requests.push(req)
      },
    }

    await using outer = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "secret.txt"), "secret data")
      },
    })
    await using tmp = await tmpdir({
      git: true,
      init: async (dir) => {
        await fs.link(path.join(outer.path, "secret.txt"), path.join(dir, "hardlink-secret.txt"))
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await expect(assertExternalDirectory(ctx, path.join(tmp.path, "hardlink-secret.txt"))).rejects.toThrow(
          "Refusing hardlinked file path outside workspace trust boundary",
        )
      },
    })

    expect(requests).toHaveLength(0)
  })

  test("allows hardlinked files when hardlink allowance is enabled", async () => {
    const requests: Array<Omit<PermissionNext.Request, "id" | "sessionID" | "tool">> = []
    const ctx: Tool.Context = {
      ...baseCtx,
      ask: async (req) => {
        requests.push(req)
      },
    }

    await using outer = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "secret.txt"), "secret data")
      },
    })
    await using tmp = await tmpdir({
      git: true,
      init: async (dir) => {
        await fs.link(path.join(outer.path, "secret.txt"), path.join(dir, "hardlink-secret.txt"))
      },
    })
    const linkedPath = path.join(tmp.path, "hardlink-secret.txt")
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await assertExternalDirectory(ctx, linkedPath, {
          allowHardlinkedTargets: true,
        })
      },
    })

    const req = requests.find((r) => r.permission === "external_directory")
    expect(req).toBeDefined()
    expect(req!.patterns[0]).toContain(tmp.path)
  })

  test("uses target directory when kind=directory", async () => {
    const requests: Array<Omit<PermissionNext.Request, "id" | "sessionID" | "tool">> = []
    const ctx: Tool.Context = {
      ...baseCtx,
      ask: async (req) => {
        requests.push(req)
      },
    }

    const directory = "/tmp/project"
    const target = "/tmp/outside"
    const expected = path.join(target, "*")

    await Instance.provide({
      directory,
      fn: async () => {
        await assertExternalDirectory(ctx, target, { kind: "directory" })
      },
    })

    const req = requests.find((r) => r.permission === "external_directory")
    expect(req).toBeDefined()
    expect(req!.patterns).toEqual([expected])
    expect(req!.always).toEqual([expected])
  })

  test("skips prompting when bypass=true", async () => {
    const requests: Array<Omit<PermissionNext.Request, "id" | "sessionID" | "tool">> = []
    const ctx: Tool.Context = {
      ...baseCtx,
      ask: async (req) => {
        requests.push(req)
      },
    }

    await Instance.provide({
      directory: "/tmp/project",
      fn: async () => {
        await assertExternalDirectory(ctx, "/tmp/outside/file.txt", { bypass: true })
      },
    })

    expect(requests.length).toBe(0)
  })
})
