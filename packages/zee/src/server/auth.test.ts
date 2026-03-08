import { describe, expect, test } from "bun:test"
import { AuthScope, hasScope, resolveRequiredScope, resolveControlUiPolicy, isTrustedControlOrigin } from "./auth"

describe("resolveRequiredScope", () => {
  test("maps gateway node pairing routes to pairing scope", () => {
    expect(resolveRequiredScope("POST", "/gateway/node/pair")).toBe(AuthScope.PAIRING)
    expect(resolveRequiredScope("POST", "/gateway/node/reconnect")).toBe(AuthScope.PAIRING)
    expect(resolveRequiredScope("POST", "/gateway/node/revoke")).toBe(AuthScope.PAIRING)
    expect(resolveRequiredScope("POST", "/gateway/node/tool/authorize")).toBe(AuthScope.PAIRING)
  })

  test("maps privileged execution surfaces to admin scope", () => {
    expect(resolveRequiredScope("POST", "/pty")).toBe(AuthScope.ADMIN)
    expect(resolveRequiredScope("DELETE", "/pty/123")).toBe(AuthScope.ADMIN)
    expect(resolveRequiredScope("POST", "/mcp")).toBe(AuthScope.ADMIN)
    expect(resolveRequiredScope("POST", "/tui")).toBe(AuthScope.ADMIN)
  })

  test("defaults GET to read and POST to write", () => {
    expect(resolveRequiredScope("GET", "/some-unknown-route")).toBe(AuthScope.READ)
    expect(resolveRequiredScope("POST", "/some-unknown-route")).toBe(AuthScope.WRITE)
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
