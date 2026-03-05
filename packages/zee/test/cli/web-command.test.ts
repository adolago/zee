import { describe, expect, test } from "bun:test"
import path from "node:path"
import {
  resolveWebAppDirectory,
  resolveWebBackendTarget,
  resolveWebBackendUrl,
} from "../../src/cli/cmd/web"

describe("zee web command helpers", () => {
  test("resolveWebBackendUrl prefers explicit --server-url", () => {
    const value = resolveWebBackendUrl({
      serverUrl: "http://explicit:7777",
      env: { ZEE_URL: "http://env:3210" } as unknown as NodeJS.ProcessEnv,
    })
    expect(value).toBe("http://explicit:7777")
  })

  test("resolveWebBackendUrl falls back to ZEE_URL", () => {
    const value = resolveWebBackendUrl({
      env: { ZEE_URL: "http://env:3210" } as unknown as NodeJS.ProcessEnv,
    })
    expect(value).toBe("http://env:3210")
  })

  test("resolveWebBackendUrl falls back to local daemon URL", () => {
    const value = resolveWebBackendUrl({
      env: { ZEE_DAEMON_PORT: "4321" } as unknown as NodeJS.ProcessEnv,
    })
    expect(value).toBe("http://127.0.0.1:4321")
  })

  test("resolveWebBackendTarget extracts host+port from URL", () => {
    const target = resolveWebBackendTarget("http://localhost:3210/api")
    expect(target).toEqual({
      origin: "http://localhost:3210",
      hostForEnv: "localhost",
      port: 3210,
      basePath: "/api",
    })
  })

  test("resolveWebBackendTarget normalizes IPv6 hostname for env wiring", () => {
    const target = resolveWebBackendTarget("http://[::1]:3210")
    expect(target.hostForEnv).toBe("[::1]")
    expect(target.port).toBe(3210)
    expect(target.basePath).toBe("")
  })

  test("resolveWebBackendTarget rejects https backend URLs", () => {
    expect(() => resolveWebBackendTarget("https://localhost:3210")).toThrow(/http:\/\//)
  })

  test("resolveWebAppDirectory resolves existing packages/app root", () => {
    const repoRoot = path.resolve(process.cwd(), "..", "..")
    const result = resolveWebAppDirectory(repoRoot)
    expect(result?.endsWith("packages/app")).toBe(true)
  })
})
