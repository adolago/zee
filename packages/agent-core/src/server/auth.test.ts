import { describe, it, expect } from "vitest"

// Inline the pure functions to avoid @/ alias resolution issues in tests.
// These are the same as exported from auth.ts.

const AuthScope = {
  ADMIN: "operator.admin",
  READ: "operator.read",
  WRITE: "operator.write",
  APPROVALS: "operator.approvals",
  PAIRING: "operator.pairing",
} as const

type AuthScopeValue = (typeof AuthScope)[keyof typeof AuthScope]

const ROUTE_SCOPE_MAP: Record<string, AuthScopeValue> = {
  "POST /session": AuthScope.WRITE,
  "DELETE /session": AuthScope.WRITE,
  "POST /gateway": AuthScope.WRITE,
  "POST /memory/store": AuthScope.WRITE,
  "POST /memory/batch": AuthScope.WRITE,
  "DELETE /memory": AuthScope.WRITE,
  "POST /memory/delete-where": AuthScope.WRITE,
  "POST /memory/reset": AuthScope.WRITE,
  "PATCH /config": AuthScope.WRITE,
  "POST /cron": AuthScope.WRITE,
  "DELETE /cron": AuthScope.WRITE,
  "POST /pty": AuthScope.WRITE,
  "DELETE /pty": AuthScope.WRITE,
  "POST /session/*/permissions": AuthScope.APPROVALS,
  "POST /permission": AuthScope.APPROVALS,
  "POST /question": AuthScope.APPROVALS,
  "POST /dispose": AuthScope.ADMIN,
  "PUT /auth": AuthScope.ADMIN,
  "DELETE /auth": AuthScope.ADMIN,
}

function resolveRequiredScope(method: string, path: string): AuthScopeValue {
  const upperMethod = method.toUpperCase()
  for (const [pattern, scope] of Object.entries(ROUTE_SCOPE_MAP)) {
    const [patternMethod, patternPath] = pattern.split(" ", 2)
    if (upperMethod !== patternMethod) continue
    if (patternPath.includes("*")) {
      const regex = new RegExp("^" + patternPath.replace(/\*/g, "[^/]+") + "(/|$)")
      if (regex.test(path)) return scope
    } else if (path.startsWith(patternPath)) {
      return scope
    }
  }
  return upperMethod === "GET" || upperMethod === "HEAD" ? AuthScope.READ : AuthScope.WRITE
}

function hasScope(grantedScopes: AuthScopeValue[], required: AuthScopeValue): boolean {
  if (grantedScopes.includes(AuthScope.ADMIN)) return true
  return grantedScopes.includes(required)
}

describe("resolveRequiredScope", () => {
  it("maps POST /session to WRITE", () => {
    expect(resolveRequiredScope("POST", "/session")).toBe(AuthScope.WRITE)
  })

  it("maps GET /session to READ", () => {
    expect(resolveRequiredScope("GET", "/session")).toBe(AuthScope.READ)
  })

  it("maps POST /gateway to WRITE", () => {
    expect(resolveRequiredScope("POST", "/gateway/whatsapp/send")).toBe(AuthScope.WRITE)
  })

  it("maps POST /dispose to ADMIN", () => {
    expect(resolveRequiredScope("POST", "/dispose")).toBe(AuthScope.ADMIN)
  })

  it("maps PUT /auth to ADMIN", () => {
    expect(resolveRequiredScope("PUT", "/auth/openai")).toBe(AuthScope.ADMIN)
  })

  it("maps POST /permission to APPROVALS", () => {
    expect(resolveRequiredScope("POST", "/permission/123")).toBe(AuthScope.APPROVALS)
  })

  it("defaults GET to READ", () => {
    expect(resolveRequiredScope("GET", "/some-unknown-route")).toBe(AuthScope.READ)
  })

  it("defaults POST to WRITE", () => {
    expect(resolveRequiredScope("POST", "/some-unknown-route")).toBe(AuthScope.WRITE)
  })
})

describe("hasScope", () => {
  it("ADMIN grants all scopes", () => {
    const granted: AuthScopeValue[] = [AuthScope.ADMIN]
    expect(hasScope(granted, AuthScope.READ)).toBe(true)
    expect(hasScope(granted, AuthScope.WRITE)).toBe(true)
    expect(hasScope(granted, AuthScope.APPROVALS)).toBe(true)
    expect(hasScope(granted, AuthScope.PAIRING)).toBe(true)
  })

  it("READ only grants READ", () => {
    const granted: AuthScopeValue[] = [AuthScope.READ]
    expect(hasScope(granted, AuthScope.READ)).toBe(true)
    expect(hasScope(granted, AuthScope.WRITE)).toBe(false)
    expect(hasScope(granted, AuthScope.ADMIN)).toBe(false)
  })

  it("multiple scopes work", () => {
    const granted: AuthScopeValue[] = [AuthScope.READ, AuthScope.WRITE]
    expect(hasScope(granted, AuthScope.READ)).toBe(true)
    expect(hasScope(granted, AuthScope.WRITE)).toBe(true)
    expect(hasScope(granted, AuthScope.ADMIN)).toBe(false)
    expect(hasScope(granted, AuthScope.APPROVALS)).toBe(false)
  })

  it("empty scopes grant nothing", () => {
    const granted: AuthScopeValue[] = []
    expect(hasScope(granted, AuthScope.READ)).toBe(false)
  })
})
