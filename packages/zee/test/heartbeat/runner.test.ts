import { afterEach, describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { HeartbeatRunner } from "../../src/heartbeat/runner"

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
})

describe("HeartbeatRunner", () => {
  test("skips when HEARTBEAT.md is missing and does not call API", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "zee-heartbeat-runner-"))
    const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = []

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ input, init })
      return new Response("{}", {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    }) as typeof fetch

    try {
      const runner = new HeartbeatRunner({
        serverUrl: "http://127.0.0.1:3210",
        directory,
        config: { enabled: true },
      })

      const result = await runner.runOnce({ reason: "manual" })
      expect(result).toEqual({ status: "skipped", reason: "missing-file" })
      expect(calls).toHaveLength(0)
    } finally {
      await fs.rm(directory, { recursive: true, force: true })
    }
  })
})
