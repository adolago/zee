import { describe, expect, test } from "bun:test"
import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import { reloadFlags } from "../../src/flag/flag"
import { ToolRegistry } from "../../src/tool/registry"

describe("tool.registry client gating", () => {
  test("does not include question tool when AGENT_CORE_CLIENT=acp", async () => {
    process.env["AGENT_CORE_CLIENT"] = "acp"
    reloadFlags()

    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const ids = await ToolRegistry.ids()
        expect(ids).not.toContain("question")
      },
    })
  })

  test("includes question tool when AGENT_CORE_CLIENT=cli", async () => {
    process.env["AGENT_CORE_CLIENT"] = "cli"
    reloadFlags()

    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const ids = await ToolRegistry.ids()
        expect(ids).toContain("question")
      },
    })
  })
})

