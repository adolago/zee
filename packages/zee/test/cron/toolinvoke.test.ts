import { afterEach, describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import z from "zod"

import { Config } from "../../src/config/config"
import { createCronServiceState } from "../../src/cron/service/state"
import { executeJob } from "../../src/cron/service/timer"
import type { CronJob, CronStoreFile } from "../../src/cron/types"
import { Instance } from "../../src/project/instance"
import { Tool } from "../../src/tool/tool"
import { ToolRegistry } from "../../src/tool/registry"

async function makeTmpDir() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "zee-cron-toolinvoke-"))
  return {
    dir,
    cleanup: async () => {
      await fs.rm(dir, { recursive: true, force: true })
    },
  }
}

function makeJob(overrides?: Partial<CronJob>): CronJob {
  return {
    id: "job-1",
    name: "toolinvoke",
    enabled: true,
    createdAtMs: 1000,
    updatedAtMs: 1000,
    schedule: { kind: "every", everyMs: 60_000 },
    sessionTarget: "isolated",
    wakeMode: "next-heartbeat",
    payload: { kind: "toolInvoke", tool: "test-tool", args: {} },
    state: { nextRunAtMs: 500 },
    ...overrides,
  }
}

describe("cron toolInvoke", () => {
  afterEach(async () => {
    // Ensure instance state is cleaned between tests
    await Instance.disposeAll()
  })

  test("runs a toolInvoke job and does not post to main by default", async () => {
    const prevAllowlist = process.env["ZEE_CRON_TOOL_INVOKE_ALLOWLIST"]
    process.env["ZEE_CRON_TOOL_INVOKE_ALLOWLIST"] = "test-tool"

    const prevConfigDir = process.env["ZEE_CONFIG_DIR"]
    const tmp = await makeTmpDir()
    const events: string[] = []
    let ran = false

    try {
      process.env["ZEE_CONFIG_DIR"] = tmp.dir
      Config.global.reset()

      await Instance.provide({
        directory: tmp.dir,
        fn: async () => {
          await ToolRegistry.register(
            Tool.define("test-tool", async () => ({
              description: "test tool",
              parameters: z.object({}),
              execute: async () => {
                ran = true
                return { title: "Test Tool", metadata: {}, output: "ok" }
              },
            })),
          )
        },
      })

      const state = createCronServiceState({
        directory: tmp.dir,
        log: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
        storePath: "/tmp/test-cron.json",
        cronEnabled: true,
        enqueueSystemEvent: (text) => events.push(text),
        requestHeartbeatNow: () => {},
        runIsolatedAgentJob: async () => ({ status: "ok" }),
      })

      const job = makeJob()
      state.store = { version: 1, jobs: [job] } as CronStoreFile

      await executeJob(state, job, 1000, { forced: false })

      expect(ran).toBe(true)
      expect(job.state.lastStatus).toBe("ok")
      expect(events).toHaveLength(0)
    } finally {
      if (prevAllowlist === undefined) {
        delete process.env["ZEE_CRON_TOOL_INVOKE_ALLOWLIST"]
      } else {
        process.env["ZEE_CRON_TOOL_INVOKE_ALLOWLIST"] = prevAllowlist
      }
      if (prevConfigDir === undefined) {
        delete process.env["ZEE_CONFIG_DIR"]
      } else {
        process.env["ZEE_CONFIG_DIR"] = prevConfigDir
      }
      Config.global.reset()
      await tmp.cleanup()
    }
  })

  test("rejects toolInvoke when tool is not in the allowlist", async () => {
    const prevAllowlist = process.env["ZEE_CRON_TOOL_INVOKE_ALLOWLIST"]
    delete process.env["ZEE_CRON_TOOL_INVOKE_ALLOWLIST"]

    const prevConfigDir = process.env["ZEE_CONFIG_DIR"]
    const tmp = await makeTmpDir()
    let ran = false

    try {
      process.env["ZEE_CONFIG_DIR"] = tmp.dir
      Config.global.reset()

      await Instance.provide({
        directory: tmp.dir,
        fn: async () => {
          await ToolRegistry.register(
            Tool.define("test-tool", async () => ({
              description: "test tool",
              parameters: z.object({}),
              execute: async () => {
                ran = true
                return { title: "Test Tool", metadata: {}, output: "ok" }
              },
            })),
          )
        },
      })

      const state = createCronServiceState({
        directory: tmp.dir,
        log: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
        storePath: "/tmp/test-cron.json",
        cronEnabled: true,
        enqueueSystemEvent: () => {},
        requestHeartbeatNow: () => {},
        runIsolatedAgentJob: async () => ({ status: "ok" }),
      })

      const job = makeJob()
      state.store = { version: 1, jobs: [job] } as CronStoreFile

      await executeJob(state, job, 1000, { forced: false })

      expect(ran).toBe(false)
      expect(job.state.lastStatus).toBe("error")
      expect(job.state.lastError).toContain('cron toolInvoke is not allowed for tool "test-tool"')
    } finally {
      if (prevAllowlist === undefined) {
        delete process.env["ZEE_CRON_TOOL_INVOKE_ALLOWLIST"]
      } else {
        process.env["ZEE_CRON_TOOL_INVOKE_ALLOWLIST"] = prevAllowlist
      }
      if (prevConfigDir === undefined) {
        delete process.env["ZEE_CONFIG_DIR"]
      } else {
        process.env["ZEE_CONFIG_DIR"] = prevConfigDir
      }
      Config.global.reset()
      await tmp.cleanup()
    }
  })
})
