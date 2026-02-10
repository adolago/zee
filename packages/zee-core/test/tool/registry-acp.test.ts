import { describe, expect, test } from "bun:test"
import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import { reloadFlags } from "../../src/flag/flag"
import { ToolRegistry } from "../../src/tool/registry"

async function withClientEnv(
  env: { ZEE_CLIENT?: string; AGENT_CORE_CLIENT?: string },
  fn: () => Promise<void>,
): Promise<void> {
  const prevZee = process.env["ZEE_CLIENT"]
  const prevAgentCore = process.env["AGENT_CORE_CLIENT"]

  if (env.ZEE_CLIENT === undefined) delete process.env["ZEE_CLIENT"]
  else process.env["ZEE_CLIENT"] = env.ZEE_CLIENT

  if (env.AGENT_CORE_CLIENT === undefined) delete process.env["AGENT_CORE_CLIENT"]
  else process.env["AGENT_CORE_CLIENT"] = env.AGENT_CORE_CLIENT

  reloadFlags()
  try {
    await fn()
  } finally {
    if (prevZee === undefined) delete process.env["ZEE_CLIENT"]
    else process.env["ZEE_CLIENT"] = prevZee

    if (prevAgentCore === undefined) delete process.env["AGENT_CORE_CLIENT"]
    else process.env["AGENT_CORE_CLIENT"] = prevAgentCore

    reloadFlags()
  }
}

describe("tool.registry client gating", () => {
  test("does not include question tool when ZEE_CLIENT=acp", async () => {
    await withClientEnv({ ZEE_CLIENT: "acp" }, async () => {
      await using tmp = await tmpdir()
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const ids = await ToolRegistry.ids()
          expect(ids).not.toContain("question")
        },
      })
    })
  })

  test("includes question tool when ZEE_CLIENT=cli", async () => {
    await withClientEnv({ ZEE_CLIENT: "cli" }, async () => {
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

  test("supports legacy AGENT_CORE_CLIENT fallback", async () => {
    await withClientEnv({ ZEE_CLIENT: undefined, AGENT_CORE_CLIENT: "acp" }, async () => {
      await using tmp = await tmpdir()
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const ids = await ToolRegistry.ids()
          expect(ids).not.toContain("question")
        },
      })
    })
  })
})
