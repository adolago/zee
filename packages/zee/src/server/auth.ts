import { Flag } from "@/flag/flag"
import { extractBasicCredentials, extractBearerToken, timingSafeEqual } from "@/security"
import { Config } from "../config/config"
import { Instance } from "../project/instance"
import { AuthScope, resolveRequiredScope, resolveRequiredScopeInfo, type AuthScopeValue } from "./control-plane-scope"

const DEFAULT_USERNAME = "zee"
const DEFAULT_CONTROL_UI_AUTH_MODE = "token"

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

export type ServerAuthScheme = "none" | "basic" | "bearer" | "x-zee-token" | "unsupported"
export type ServerAuthReason =
  | "missing_credentials"
  | "missing_server_password"
  | "invalid_credentials"
  | "password_required"
  | "token_required"
  | "unsupported_scheme"

export type ServerAuthDecision = {
  authorized: boolean
  challenge: string
  scheme: ServerAuthScheme
  reason?: ServerAuthReason
  policy: ControlUiPolicy
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

export async function getServerRuntimeConfig(directory = process.cwd()): Promise<Config.Info | undefined> {
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
  return getAuthorizationHeaderFor()
}

function buildBasicAuthorizationHeader(username: string, password: string): string {
  const token = Buffer.from(`${username}:${password}`, "utf-8").toString("base64")
  return `Basic ${token}`
}

function buildBearerAuthorizationHeader(password: string): string {
  return `Bearer ${password}`
}

function resolvePreferredAuthScheme(policy: ControlUiPolicy): Exclude<ServerAuthScheme, "none" | "x-zee-token" | "unsupported"> {
  return policy.mode === "password" ? "basic" : "bearer"
}

function resolveAuthChallenge(policy: ControlUiPolicy): string {
  return resolvePreferredAuthScheme(policy) === "basic" ? 'Basic realm="zee"' : 'Bearer realm="zee"'
}

function resolveTokenHeader(tokenHeader: string | undefined): string | undefined {
  const value = tokenHeader?.trim()
  return value ? value : undefined
}

function resolveServerAuthInput(
  authorizationHeader: string | undefined,
  tokenHeader: string | undefined,
): {
  scheme: ServerAuthScheme
  username?: string
  secret?: string
} {
  const explicitToken = resolveTokenHeader(tokenHeader)
  if (explicitToken) {
    return {
      scheme: "x-zee-token",
      secret: explicitToken,
    }
  }

  const bearer = extractBearerToken(authorizationHeader)
  if (bearer) {
    return {
      scheme: "bearer",
      secret: bearer,
    }
  }

  const basic = extractBasicCredentials(authorizationHeader)
  if (basic) {
    return {
      scheme: "basic",
      username: basic.username,
      secret: basic.password,
    }
  }

  if (!authorizationHeader) {
    return {
      scheme: "none",
    }
  }

  return {
    scheme: "unsupported",
  }
}

function isBrowserOrigin(origin: string | undefined): boolean {
  return typeof origin === "string" && origin.trim().length > 0
}

function requiresTokenScheme(policy: ControlUiPolicy, origin: string | undefined): boolean {
  return isBrowserOrigin(origin) && policy.required && policy.mode === "token" && !policy.allowPasswordOnly
}

function requiresPasswordScheme(policy: ControlUiPolicy, origin: string | undefined): boolean {
  return isBrowserOrigin(origin) && policy.required && policy.mode === "password"
}

export function getAuthorizationHeaderFor(runtimeConfig?: unknown): string | undefined {
  const { disabled, password, username } = getAuthConfig(runtimeConfig)
  if (disabled || !password) return undefined

  const policy = resolveControlUiPolicy(runtimeConfig)
  return resolvePreferredAuthScheme(policy) === "basic"
    ? buildBasicAuthorizationHeader(username, password)
    : buildBearerAuthorizationHeader(password)
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
  return resolveServerAuthDecision({
    authorizationHeader,
    runtimeConfig,
  }).authorized
}

export function resolveServerAuthDecision(input: {
  authorizationHeader?: string
  tokenHeader?: string
  origin?: string
  runtimeConfig?: unknown
}): ServerAuthDecision {
  const { disabled, password, username: expectedUsername } = getAuthConfig(input.runtimeConfig)
  const policy = resolveControlUiPolicy(input.runtimeConfig)
  const challenge = resolveAuthChallenge(policy)

  if (disabled) {
    return {
      authorized: true,
      challenge,
      scheme: "none",
      policy,
    }
  }

  if (!password) {
    return {
      authorized: false,
      challenge,
      scheme: "none",
      reason: "missing_server_password",
      policy,
    }
  }

  const candidate = resolveServerAuthInput(input.authorizationHeader, input.tokenHeader)

  if (candidate.scheme === "none") {
    return {
      authorized: false,
      challenge,
      scheme: candidate.scheme,
      reason: "missing_credentials",
      policy,
    }
  }

  if (requiresTokenScheme(policy, input.origin) && candidate.scheme === "basic") {
    return {
      authorized: false,
      challenge,
      scheme: candidate.scheme,
      reason: "token_required",
      policy,
    }
  }

  if (
    requiresPasswordScheme(policy, input.origin) &&
    (candidate.scheme === "bearer" || candidate.scheme === "x-zee-token")
  ) {
    return {
      authorized: false,
      challenge,
      scheme: candidate.scheme,
      reason: "password_required",
      policy,
    }
  }

  if (candidate.scheme === "unsupported") {
    return {
      authorized: false,
      challenge,
      scheme: candidate.scheme,
      reason: "unsupported_scheme",
      policy,
    }
  }

  if (candidate.scheme === "basic") {
    const authorized =
      timingSafeEqual(candidate.username ?? "", expectedUsername) && timingSafeEqual(candidate.secret ?? "", password)
    return {
      authorized,
      challenge,
      scheme: candidate.scheme,
      ...(authorized ? {} : { reason: "invalid_credentials" as const }),
      policy,
    }
  }

  const authorized = timingSafeEqual(candidate.secret ?? "", password)
  return {
    authorized,
    challenge,
    scheme: candidate.scheme,
    ...(authorized ? {} : { reason: "invalid_credentials" as const }),
    policy,
  }
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
  if (!resolveServerAuthDecision({ authorizationHeader: authHeader, runtimeConfig }).authorized) {
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

export { AuthScope, resolveRequiredScope, resolveRequiredScopeInfo }
export type { AuthScopeValue }

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
