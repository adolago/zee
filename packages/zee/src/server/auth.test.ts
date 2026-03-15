import { describe, expect, test } from "bun:test"
import { AuthScope, hasScope, resolveRequiredScope, resolveRequiredScopeInfo, resolveControlUiPolicy, isTrustedControlOrigin } from "./auth"
import { CONTROL_PLANE_PUBLIC_EXCEPTIONS, CONTROL_PLANE_SCOPE_MATRIX } from "./control-plane-scope"
import { Server } from "./server"

function materializeOpenapiPath(path: string): string {
  return path.replace(/\{[^/]+\}/g, "sample")
}

describe("resolveRequiredScope", () => {
  test("maps gateway node pairing routes to pairing scope", () => {
    expect(resolveRequiredScope("POST", "/gateway/node/pair")).toBe(AuthScope.PAIRING)
    expect(resolveRequiredScope("POST", "/gateway/node/reconnect")).toBe(AuthScope.PAIRING)
    expect(resolveRequiredScope("POST", "/gateway/node/rotate")).toBe(AuthScope.PAIRING)
    expect(resolveRequiredScope("POST", "/gateway/node/revoke")).toBe(AuthScope.PAIRING)
    expect(resolveRequiredScope("POST", "/gateway/node/tool/authorize")).toBe(AuthScope.PAIRING)
  })

  test("maps privileged execution surfaces to admin scope", () => {
    expect(resolveRequiredScope("POST", "/pty")).toBe(AuthScope.ADMIN)
    expect(resolveRequiredScope("DELETE", "/pty/123")).toBe(AuthScope.ADMIN)
    expect(resolveRequiredScope("POST", "/mcp")).toBe(AuthScope.ADMIN)
    expect(resolveRequiredScope("POST", "/tui")).toBe(AuthScope.ADMIN)
  })

  test("maps explicit control-plane routes beyond the legacy prefix heuristics", () => {
    expect(resolveRequiredScope("PUT", "/auth/openai")).toBe(AuthScope.ADMIN)
    expect(resolveRequiredScope("GET", "/global/event")).toBe(AuthScope.OBSERVE)
    expect(resolveRequiredScope("GET", "/process/events")).toBe(AuthScope.OBSERVE)
    expect(resolveRequiredScope("GET", "/usage/stats")).toBe(AuthScope.OBSERVE)
    expect(resolveRequiredScope("GET", "/gateway/node")).toBe(AuthScope.PAIRING)
    expect(resolveRequiredScope("GET", "/permission")).toBe(AuthScope.APPROVALS)
    expect(resolveRequiredScope("POST", "/memory/search")).toBe(AuthScope.READ)
  })

  test("fails closed for unmapped routes", () => {
    expect(resolveRequiredScopeInfo("GET", "/some-unknown-route")).toEqual({
      required: AuthScope.ADMIN,
      fallback: true,
      controlPlane: false,
    })
    expect(resolveRequiredScopeInfo("POST", "/some-unknown-route")).toEqual({
      required: AuthScope.ADMIN,
      fallback: true,
      controlPlane: false,
    })
  })

  test("covers every OpenAPI route with an explicit scope binding", async () => {
    const spec = await Server.openapi()
    const uncovered: string[] = []

    for (const [path, methods] of Object.entries(spec.paths)) {
      for (const method of Object.keys(methods)) {
        const concretePath = materializeOpenapiPath(path)
        const resolution = resolveRequiredScopeInfo(method, concretePath)
        if (!resolution.fallback) continue
        uncovered.push(`${method.toUpperCase()} ${path}`)
      }
    }

    expect(uncovered).toEqual([])
  })

  test("covers non-OpenAPI control-plane routes with explicit bindings", () => {
    const hiddenRoutes = [
      ["GET", "/usage/events"],
      ["GET", "/usage/summary"],
      ["GET", "/usage/summary/provider/openai"],
      ["GET", "/usage/summary/model/gpt-4o"],
      ["GET", "/usage/summary/session/session-1"],
      ["GET", "/usage/stats"],
      ["GET", "/usage/cost"],
      ["DELETE", "/usage/events"],
      ["GET", "/cron/status"],
      ["GET", "/cron/jobs"],
      ["POST", "/cron/jobs"],
      ["PATCH", "/cron/jobs/job-1"],
      ["DELETE", "/cron/jobs/job-1"],
      ["POST", "/cron/jobs/job-1/run"],
      ["POST", "/cron/wake"],
      ["POST", "/heartbeat/run"],
      ["POST", "/heartbeat/wake"],
    ] as const

    for (const [method, path] of hiddenRoutes) {
      expect(resolveRequiredScopeInfo(method, path).fallback).toBe(false)
    }
  })
})

describe("control-plane scope matrix", () => {
  test("documents a non-empty explicit matrix and the only public bypass", () => {
    expect(CONTROL_PLANE_SCOPE_MATRIX.length).toBeGreaterThan(100)
    expect(CONTROL_PLANE_PUBLIC_EXCEPTIONS).toEqual(["OPTIONS * (CORS preflight bypasses auth middleware)"])
  })
})

describe("hasScope", () => {
  test("admin grants all scopes", () => {
    const granted = [AuthScope.ADMIN]
    expect(hasScope(granted, AuthScope.READ)).toBe(true)
    expect(hasScope(granted, AuthScope.WRITE)).toBe(true)
    expect(hasScope(granted, AuthScope.APPROVALS)).toBe(true)
    expect(hasScope(granted, AuthScope.PAIRING)).toBe(true)
  })

  test("non-admin scopes remain narrow", () => {
    const granted = [AuthScope.READ, AuthScope.WRITE]
    expect(hasScope(granted, AuthScope.READ)).toBe(true)
    expect(hasScope(granted, AuthScope.WRITE)).toBe(true)
    expect(hasScope(granted, AuthScope.ADMIN)).toBe(false)
    expect(hasScope(granted, AuthScope.PAIRING)).toBe(false)
  })
})

describe("control UI policy", () => {
  test("defaults to token auth with no trusted origins", () => {
    expect(resolveControlUiPolicy({})).toEqual({
      required: true,
      mode: "token",
      allowPasswordOnly: false,
      allowInsecureHttp: false,
      trustedOrigins: [],
    })
  })

  test("allows loopback browser origins and enforces explicit trusted origins", () => {
    const config = {
      gateway: {
        controlUi: {
          trustedOrigins: ["https://control.example.com"],
        },
      },
    }

    expect(isTrustedControlOrigin("http://localhost:5173", config)).toBe(true)
    expect(isTrustedControlOrigin("https://control.example.com", config)).toBe(true)
    expect(isTrustedControlOrigin("https://evil.example.com", config)).toBe(false)
  })
})
