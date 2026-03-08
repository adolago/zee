import { Flag } from "@/flag/flag"
import { extractBasicCredentials, extractBearerToken, timingSafeEqual } from "@/security"
import { Config } from "../config/config"
import { Instance } from "../project/instance"

const DEFAULT_USERNAME = "zee"
const DEFAULT_CONTROL_UI_AUTH_MODE = "token"

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
  // Node-client lifecycle (pair/reconnect/revoke + tool authorization)
  "POST /gateway/node/pair": AuthScope.PAIRING,
  "POST /gateway/node/reconnect": AuthScope.PAIRING,
  "POST /gateway/node/revoke": AuthScope.PAIRING,
  "POST /gateway/node/tool/authorize": AuthScope.PAIRING,
  "GET /gateway/node": AuthScope.READ,
  "POST /gateway/telegram/metadata": AuthScope.READ,
  "POST /gateway/telegram/send": AuthScope.WRITE,
  "POST /gateway/telegram/moderation": AuthScope.ADMIN,
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

export type ControlUiAuthMode = "token" | "password" | "none"

export type ControlUiPolicy = {
  required: boolean
  mode: ControlUiAuthMode
  allowPasswordOnly: boolean
  allowInsecureHttp: boolean
  trustedOrigins: string[]
}

function asObject(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  return value as Record<string, unknown>
}

function resolveBool(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback
}

function resolveControlUiAuthMode(value: unknown): ControlUiAuthMode {
  if (value === "token" || value === "password" || value === "none") return value
  if (Flag.ZEE_CONTROL_UI_DISABLE_AUTH) return "none"
  if (Flag.ZEE_CONTROL_UI_ALLOW_PASSWORD_ONLY) return "password"
  return DEFAULT_CONTROL_UI_AUTH_MODE
}

export function resolveControlUiPolicy(config?: unknown): ControlUiPolicy {
  const root = asObject(config) ?? {}
  const gateway = asObject(root.gateway) ?? {}
  const controlUi = asObject(gateway.controlUi) ?? {}
  const auth = asObject(controlUi.auth) ?? {}

  const mode = resolveControlUiAuthMode(auth.mode)
  const required = resolveBool(auth.required, mode !== "none")
  const trustedOrigins = Array.isArray(controlUi.trustedOrigins)
    ? controlUi.trustedOrigins.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
    : []

  return {
    required,
    mode,
    allowPasswordOnly: resolveBool(auth.allowPasswordOnly, false) || Flag.ZEE_CONTROL_UI_ALLOW_PASSWORD_ONLY,
    allowInsecureHttp: resolveBool(auth.allowInsecureHttp, false) || Flag.ZEE_CONTROL_UI_ALLOW_INSECURE_HTTP,
    trustedOrigins,
  }
}

function isLoopbackOrigin(origin: string): boolean {
  try {
    const url = new URL(origin)
    return isLoopbackHostname(url.hostname)
  } catch {
    return false
  }
}

export function isTrustedControlOrigin(origin: string | undefined, config?: unknown): boolean {
  if (!origin) return true
  if (isLoopbackOrigin(origin)) return true

  const policy = resolveControlUiPolicy(config)
  if (policy.trustedOrigins.length === 0) return true
  return policy.trustedOrigins.includes(origin)
}

export function getAuthConfig(runtimeConfig?: unknown): AuthConfig {
  // Auth is disabled by default for personal use. Set ZEE_ENABLE_SERVER_AUTH=1 to enable.
  const policy = resolveControlUiPolicy(runtimeConfig)
  const runtimeRoot = asObject(runtimeConfig) ?? {}
  const runtimeGateway = asObject(runtimeRoot.gateway) ?? {}
  const controlUiConfigured = Boolean(asObject(runtimeGateway.controlUi))
  const envDisabled = !Flag.ZEE_ENABLE_SERVER_AUTH || Flag.ZEE_DISABLE_SERVER_AUTH
  const controlUiRequiresAuth = controlUiConfigured && policy.required && policy.mode !== "none"
  const disabled = controlUiRequiresAuth ? false : envDisabled
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

export async function getServerRuntimeConfig(directory = process.cwd()): Promise<unknown | undefined> {
  try {
    return await Instance.provide({
      directory,
      fn: () => Config.get(),
    })
  } catch {
    return undefined
  }
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

export function isAuthorized(authorizationHeader?: string, runtimeConfig?: unknown): boolean {
  const { disabled, password, username: expectedUsername } = getAuthConfig(runtimeConfig)
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
  runtimeConfig?: unknown,
): { authorized: true } | { authorized: false; reason: string } {
  const config = getAuthConfig(runtimeConfig)

  // Auth disabled = everything allowed
  if (config.disabled) return { authorized: true }

  // Check authentication
  if (!isAuthorized(authHeader, runtimeConfig)) {
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
export function assertSafeServerBind(opts: { hostname: string; config?: unknown }) {
  const hostname = opts.hostname
  if (isLoopbackHostname(hostname)) return

  const config = getAuthConfig(opts.config)
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
