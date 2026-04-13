import { describe, expect, test } from "bun:test"
import { probeOpenBBWorkspaceAvailability, resolveOpenBBWorkspace } from "../../src/openbb/workspace"

const env = {
  ZEE_PORT: undefined,
  ZEE_URL: undefined,
  ZEE_HOSTNAME: undefined,
} as unknown as NodeJS.ProcessEnv

describe("resolveOpenBBWorkspace", () => {
  test("uses configured server port and normalizes wildcard hostnames", () => {
    const result = resolveOpenBBWorkspace({
      server: {
        hostname: "0.0.0.0",
        port: 3211,
      },
    })

    expect(result.baseUrl).toBe("http://127.0.0.1:3211")
    expect(result.descriptorUrl).toBe("http://127.0.0.1:3211/openbb/agents.json")
    expect(result.queryUrl).toBe("http://127.0.0.1:3211/openbb/query")
    expect(result.source).toBe("config")
  })

  test("prefers ZEE_URL when provided", () => {
    const result = resolveOpenBBWorkspace(undefined, {
      env: {
        ...env,
        ZEE_URL: "http://0.0.0.0:7777/root",
      },
    })

    expect(result.baseUrl).toBe("http://127.0.0.1:7777/root")
    expect(result.descriptorUrl).toBe("http://127.0.0.1:7777/root/openbb/agents.json")
    expect(result.source).toBe("env-url")
  })
})

describe("probeOpenBBWorkspaceAvailability", () => {
  test("reports daemon-unreachable when the Zee server is down", async () => {
    const result = await probeOpenBBWorkspaceAvailability(
      {
        server: {
          port: 3211,
        },
      },
      {
        fetchImpl: async () => {
          throw new Error("connect ECONNREFUSED")
        },
      },
    )

    expect(result.available).toBe(false)
    expect(result.daemonReachable).toBe(false)
    expect(result.descriptorReachable).toBe(false)
    expect(result.action).toContain("Start Zee daemon")
  })

  test("reports descriptor-invalid when the Zee server responds without the route", async () => {
    const result = await probeOpenBBWorkspaceAvailability(
      {
        server: {
          port: 3211,
        },
      },
      {
        fetchImpl: async () => new Response("missing", { status: 404 }),
      },
    )

    expect(result.available).toBe(false)
    expect(result.daemonReachable).toBe(true)
    expect(result.descriptorReachable).toBe(false)
    expect(result.error).toContain("HTTP 404")
  })

  test("accepts a valid OpenBB Workspace descriptor", async () => {
    const result = await probeOpenBBWorkspaceAvailability(
      {
        server: {
          hostname: "127.0.0.1",
          port: 3211,
        },
      },
      {
        fetchImpl: async () =>
          Response.json({
            zee: {
              name: "Zee",
              endpoints: {
                query: "/openbb/query",
              },
            },
          }),
      },
    )

    expect(result.available).toBe(true)
    expect(result.daemonReachable).toBe(true)
    expect(result.descriptorReachable).toBe(true)
    expect(result.queryUrl).toBe("http://127.0.0.1:3211/openbb/query")
  })
})
