import { Flag } from "@/flag/flag"
import { extractBasicCredentials, extractBearerToken, timingSafeEqual } from "@/security"

const DEFAULT_USERNAME = "zee"

// ---------------------------------------------------------------------------
// Scoped Permissions
// ---------------------------------------------------------------------------

/**
 * Permission scopes matching OpenClaw's operator permission model.
 * These control access to different API surface areas.
 */
export const AuthScope = {
  /** Full administrative access */
  ADMIN: "operator.admin",
  /** Read-only access (list sessions, view models, read config) */
  READ: "operator.read",
  /** Observability access (flux events, traces, diagnostics) */
  OBSERVE: "operator.observe",
  /** Write access (create sessions, send messages, modify config) */
  WRITE: "operator.write",
  /** Approve execution requests and permissions */
  APPROVALS: "operator.approvals",
  /** Device pairing and gateway pairing */
  PAIRING: "operator.pairing",
} as const

export type AuthScopeValue = (typeof AuthScope)[keyof typeof AuthScope]

/**
 * Maps route prefixes to required scopes.
 * Admin scope grants access to everything.
 * Routes not listed here default to READ.
 */
const ROUTE_SCOPE_MAP: Record<string, AuthScopeValue> = {
  // Write operations
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
  // High-risk: process execution surface
  "POST /pty": AuthScope.ADMIN,
  "DELETE /pty": AuthScope.ADMIN,
  // High-risk: MCP can execute arbitrary tool logic via external servers
  "POST /mcp": AuthScope.ADMIN,
  "DELETE /mcp": AuthScope.ADMIN,
  // High-risk: UI control plane
  "POST /tui": AuthScope.ADMIN,

  // Approval operations
  "POST /session/*/permissions": AuthScope.APPROVALS,
  "POST /permission": AuthScope.APPROVALS,
  "POST /question": AuthScope.APPROVALS,

  // Observability operations
  "GET /v1/flux": AuthScope.OBSERVE,

  // Admin operations
  "GET /global/instances": AuthScope.ADMIN,
  "POST /global/dispose": AuthScope.ADMIN,
  "POST /instance/dispose": AuthScope.ADMIN,
}

/**
 * Resolve the required scope for a given HTTP method + path combination.
 */
export function resolveRequiredScope(method: string, path: string): AuthScopeValue {
  const upperMethod = method.toUpperCase()

  // Check exact and prefix matches
  for (const [pattern, scope] of Object.entries(ROUTE_SCOPE_MAP)) {
    const [patternMethod, patternPath] = pattern.split(" ", 2)
    if (upperMethod !== patternMethod) continue

    // Wildcard matching
    if (patternPath.includes("*")) {
      const regex = new RegExp("^" + patternPath.replace(/\*/g, "[^/]+") + "(/|$)")
      if (regex.test(path)) return scope
    } else if (path.startsWith(patternPath)) {
      return scope
    }
  }

  // Default: GET = read, everything else = write
  return upperMethod === "GET" || upperMethod === "HEAD" ? AuthScope.READ : AuthScope.WRITE
}

/**
 * Check if a set of granted scopes satisfies the required scope.
 * Admin scope implicitly includes all other scopes.
 */
export function hasScope(grantedScopes: AuthScopeValue[], required: AuthScopeValue): boolean {
  if (grantedScopes.includes(AuthScope.ADMIN)) return true
  return grantedScopes.includes(required)
}

// ---------------------------------------------------------------------------
// Auth Config
// ---------------------------------------------------------------------------

type AuthConfig = {
  disabled: boolean
  username: string
  password?: string
  /** Scopes granted to the authenticated user. Defaults to all scopes. */
  scopes?: AuthScopeValue[]
}

export function getAuthConfig(): AuthConfig {
  // Auth is disabled by default for personal use. Set ZEE_ENABLE_SERVER_AUTH=1 to enable.
  const disabled = !Flag.ZEE_ENABLE_SERVER_AUTH || Flag.ZEE_DISABLE_SERVER_AUTH
  const password = Flag.ZEE_SERVER_PASSWORD
  const username = Flag.ZEE_SERVER_USERNAME ?? DEFAULT_USERNAME

  // Parse scopes from ZEE_SERVER_SCOPES (comma-separated).
  // If not set, default to admin (full access) for backward compatibility.
  const scopeValues = Object.values(AuthScope)
  const rawScopes = process.env.ZEE_SERVER_SCOPES?.trim()
  let scopes: AuthScopeValue[]
  if (rawScopes) {
    scopes = rawScopes
      .split(",")
      .map((s) => s.trim())
      .filter((s): s is AuthScopeValue => scopeValues.includes(s as AuthScopeValue))
  } else {
    scopes = [AuthScope.ADMIN] // default: full access
  }

  return { disabled, password, username, scopes }
}

export function getAuthorizationHeader(): string | undefined {
  const { disabled, password, username } = getAuthConfig()
  if (disabled || !password) return undefined
  const token = Buffer.from(`${username}:${password}`, "utf-8").toString("base64")
  return `Basic ${token}`
}

export function authorizeRequest(request: Request): Request {
  const auth = getAuthorizationHeader()
  if (auth && !request.headers.has("Authorization")) {
    request.headers.set("Authorization", auth)
  }
  return request
}

export function createAuthorizedFetch(fetchFn: typeof fetch): typeof fetch {
  const wrapped = (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request && !init ? input : new Request(input, init)
    return fetchFn(authorizeRequest(request))
  }
  wrapped.preconnect = fetchFn.preconnect?.bind(fetchFn)
  return wrapped as typeof fetch
}

export function isAuthorized(authorizationHeader?: string): boolean {
  const { disabled, password, username: expectedUsername } = getAuthConfig()
  if (disabled) return true
  if (!password) return false
  if (!authorizationHeader) return false

  // Allow bearer-token style auth (common for non-browser clients).
  // Token must match the configured server password.
  const bearer = extractBearerToken(authorizationHeader)
  if (bearer) return timingSafeEqual(bearer, password)

  const basic = extractBasicCredentials(authorizationHeader)
  if (!basic) return false
  return timingSafeEqual(basic.username, expectedUsername) && timingSafeEqual(basic.password, password)
}

/**
 * Check both authentication and scope authorization for a request.
 * Returns { authorized: true } if allowed, or { authorized: false, reason } if denied.
 */
export function authorizeRequestScoped(
  authHeader: string | undefined,
  method: string,
  path: string,
): { authorized: true } | { authorized: false; reason: string } {
  const config = getAuthConfig()

  // Auth disabled = everything allowed
  if (config.disabled) return { authorized: true }

  // Check authentication
  if (!isAuthorized(authHeader)) {
    return { authorized: false, reason: "Authentication required" }
  }

  // Check scope
  const required = resolveRequiredScope(method, path)
  const granted = config.scopes ?? [AuthScope.ADMIN]
  if (!hasScope(granted, required)) {
    return { authorized: false, reason: `Insufficient scope: requires ${required}` }
  }

  return { authorized: true }
}

export function isLoopbackHostname(hostname: string): boolean {
  const value = hostname.trim().toLowerCase()
  if (!value) return true
  if (value === "localhost") return true
  if (value === "127.0.0.1") return true
  if (value === "::1") return true
  return false
}

/**
 * Guardrail: Refuse non-loopback binds unless server auth is enabled and configured.
 * This prevents accidental LAN exposure of privileged endpoints.
 */
export function assertSafeServerBind(opts: { hostname: string }) {
  const hostname = opts.hostname
  if (isLoopbackHostname(hostname)) return

  const config = getAuthConfig()
  if (!config.disabled && config.password) return

  const insecureOverrideOk = Flag.ZEE_DISABLE_SERVER_AUTH && Flag.ZEE_ALLOW_INSECURE_SERVER_NO_AUTH

  if (insecureOverrideOk) return

  const authDisabledHelp = config.disabled
    ? "Server auth is disabled. Set ZEE_ENABLE_SERVER_AUTH=1 and ZEE_SERVER_PASSWORD to enable."
    : "Server auth is enabled but ZEE_SERVER_PASSWORD is missing."

  throw new Error(
    `Refusing to bind zee server to non-loopback hostname "${hostname}" without HTTP auth. ${authDisabledHelp} ` +
      "To override (dangerous), set ZEE_DISABLE_SERVER_AUTH=1 and ZEE_ALLOW_INSECURE_SERVER_NO_AUTH=1.",
  )
}
