import { afterEach, describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import path from "node:path"
import { HeartbeatRunner } from "../../src/heartbeat/runner"
import { tmpdir } from "../fixture/fixture"

const originalFetch = globalThis.fetch
const originalStateDir = process.env["ZEE_STATE_DIR"]

function setStateDir(baseDir: string): string {
  const stateDir = path.join(baseDir, "state")
  process.env["ZEE_STATE_DIR"] = stateDir
  return stateDir
}

afterEach(() => {
  globalThis.fetch = originalFetch
  if (originalStateDir === undefined) {
    delete process.env["ZEE_STATE_DIR"]
  } else {
    process.env["ZEE_STATE_DIR"] = originalStateDir
  }
})

describe("HeartbeatRunner", () => {
  test("skips when HEARTBEAT.md is missing and does not call API", async () => {
    await using tmp = await tmpdir()
    const directory = tmp.path
    setStateDir(directory)
    const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = []

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ input, init })
      return new Response("{}", {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    }) as typeof fetch

    const runner = new HeartbeatRunner({
      serverUrl: "http://127.0.0.1:3210",
      directory,
      config: { enabled: true },
    })

    const result = await runner.runOnce({ reason: "manual" })
    expect(result).toEqual({ status: "skipped", reason: "missing-file" })
    expect(calls).toHaveLength(0)
  })

  test("defaults to runtime workspace heartbeat file before legacy daemon directory", async () => {
    await using tmp = await tmpdir()
    const directory = tmp.path
    const stateDir = setStateDir(directory)
    const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = []

    await fs.writeFile(path.join(directory, "HEARTBEAT.md"), "check inbox")
    await fs.mkdir(path.join(stateDir, "workspace"), { recursive: true })
    await fs.writeFile(path.join(stateDir, "workspace", "HEARTBEAT.md"), "# comment only\n")

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ input, init })
      return new Response("{}", {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    }) as typeof fetch

    const runner = new HeartbeatRunner({
      serverUrl: "http://127.0.0.1:3210",
      directory,
      config: { enabled: true },
    })

    const result = await runner.runOnce({ reason: "manual" })
    expect(result).toEqual({ status: "skipped", reason: "effectively-empty" })
    expect(calls).toHaveLength(0)
  })

  test("falls back to legacy daemon HEARTBEAT.md when runtime workspace file is missing", async () => {
    await using tmp = await tmpdir()
    const directory = tmp.path
    setStateDir(directory)
    const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = []

    await fs.writeFile(path.join(directory, "HEARTBEAT.md"), "# comment only\n")

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ input, init })
      return new Response("{}", {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    }) as typeof fetch

    const runner = new HeartbeatRunner({
      serverUrl: "http://127.0.0.1:3210",
      directory,
      config: { enabled: true },
    })

    const result = await runner.runOnce({ reason: "manual" })
    expect(result).toEqual({ status: "skipped", reason: "effectively-empty" })
    expect(calls).toHaveLength(0)
  })

  test("uses heartbeat.path override relative to daemon directory", async () => {
    await using tmp = await tmpdir()
    const directory = tmp.path
    setStateDir(directory)
    const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = []

    await fs.writeFile(path.join(directory, "HEARTBEAT.md"), "check inbox")
    await fs.mkdir(path.join(directory, ".runtime"), { recursive: true })
    await fs.writeFile(path.join(directory, ".runtime", "HEARTBEAT.md"), "# comment only\n")

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ input, init })
      return new Response("{}", {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    }) as typeof fetch

    const runner = new HeartbeatRunner({
      serverUrl: "http://127.0.0.1:3210",
      directory,
      config: { enabled: true, path: ".runtime/HEARTBEAT.md" },
    })

    const result = await runner.runOnce({ reason: "manual" })
    expect(result).toEqual({ status: "skipped", reason: "effectively-empty" })
    expect(calls).toHaveLength(0)
  })

  test("does not fall back to default HEARTBEAT.md when heartbeat.path is missing", async () => {
    await using tmp = await tmpdir()
    const directory = tmp.path
    setStateDir(directory)
    const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = []

    await fs.writeFile(path.join(directory, "HEARTBEAT.md"), "check inbox")

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ input, init })
      return new Response("{}", {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    }) as typeof fetch

    const heartbeatPath = path.join(directory, "custom", "HEARTBEAT.md")
    const runner = new HeartbeatRunner({
      serverUrl: "http://127.0.0.1:3210",
      directory,
      config: { enabled: true, path: heartbeatPath },
    })

    const result = await runner.runOnce({ reason: "manual" })
    expect(result).toEqual({ status: "skipped", reason: "missing-file" })
    expect(calls).toHaveLength(0)
  })
})
