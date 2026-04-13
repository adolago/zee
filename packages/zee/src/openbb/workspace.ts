const DEFAULT_DAEMON_PORT = 3210
const DEFAULT_TIMEOUT_MS = 3_000

type ProbeFetch = typeof fetch

export interface OpenBBWorkspaceConfigLike {
  server?: {
    hostname?: string
    port?: number
  }
}

export interface OpenBBWorkspaceResolveOptions {
  env?: NodeJS.ProcessEnv
}

export interface OpenBBWorkspaceResolution {
  baseUrl: string
  descriptorUrl: string
  queryUrl: string
  hostname: string
  port: number
  source: "env-url" | "config" | "env-port" | "default"
}

export interface OpenBBWorkspaceAvailability extends OpenBBWorkspaceResolution {
  available: boolean
  daemonReachable: boolean
  descriptorReachable: boolean
  statusCode?: number
  error?: string
  action?: string
}

function trimOrUndefined(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
}

function parsePositiveInt(value: string | undefined): number | undefined {
  if (!value) return undefined
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined
}

function isWildcardHostname(hostname: string): boolean {
  const normalized = hostname.trim().toLowerCase()
  return normalized === "0.0.0.0" || normalized === "::" || normalized === "[::]"
}

function normalizeDaemonHost(hostname?: string): string {
  const trimmed = trimOrUndefined(hostname)
  if (!trimmed || isWildcardHostname(trimmed)) return "127.0.0.1"
  return trimmed
}

function normalizePathname(pathname: string): string {
  if (!pathname || pathname === "/") return "/"
  return pathname.endsWith("/") ? pathname : pathname + "/"
}

function joinBaseUrl(baseUrl: string, relativePath: string): string {
  const url = new URL(baseUrl)
  const basePath = normalizePathname(url.pathname)
  const normalizedRelative = relativePath.replace(/^\/+/, "")
  url.pathname = `${basePath}${normalizedRelative}`.replace(/\/{2,}/g, "/")
  return url.toString()
}

function normalizeBaseUrl(raw: string): string {
  const url = new URL(raw)
  if (isWildcardHostname(url.hostname)) {
    url.hostname = "127.0.0.1"
  }
  if (!url.pathname) {
    url.pathname = "/"
  }
  return url.toString()
}

function resolveDescriptor(payload: unknown): { query: string } | undefined {
  if (!payload || typeof payload !== "object") return
  const zee = (payload as { zee?: unknown }).zee
  if (!zee || typeof zee !== "object") return
  const name = (zee as { name?: unknown }).name
  const endpoints = (zee as { endpoints?: unknown }).endpoints
  const query = endpoints && typeof endpoints === "object" ? (endpoints as { query?: unknown }).query : undefined
  if (typeof name !== "string" || !name.trim()) return
  if (typeof query !== "string" || !query.trim()) return
  return { query: query.trim() }
}

function resolveDescriptorAction(descriptorUrl: string, statusCode?: number): string {
  if (statusCode === 401 || statusCode === 403) {
    return `Allow OpenBB Workspace to read ${descriptorUrl}, or adjust Zee server auth for loopback access.`
  }
  return `Ensure Zee daemon exposes a valid OpenBB Workspace descriptor at ${descriptorUrl}.`
}

export function resolveOpenBBWorkspace(
  config?: OpenBBWorkspaceConfigLike,
  options: OpenBBWorkspaceResolveOptions = {},
): OpenBBWorkspaceResolution {
  const env = options.env ?? process.env
  const directUrl = trimOrUndefined(env.ZEE_URL)
  if (directUrl) {
    const baseUrl = normalizeBaseUrl(directUrl)
    const url = new URL(baseUrl)
    return {
      baseUrl,
      descriptorUrl: joinBaseUrl(baseUrl, "/openbb/agents.json"),
      queryUrl: joinBaseUrl(baseUrl, "/openbb/query"),
      hostname: normalizeDaemonHost(url.hostname),
      port: Number.parseInt(url.port, 10) || (url.protocol === "https:" ? 443 : 80),
      source: "env-url",
    }
  }

  const configuredPort = config?.server?.port
  const portFromEnv = parsePositiveInt(env.ZEE_PORT)
  const port = configuredPort ?? portFromEnv ?? DEFAULT_DAEMON_PORT
  const source = configuredPort ? "config" : portFromEnv ? "env-port" : "default"
  const hostname = normalizeDaemonHost(config?.server?.hostname ?? env.ZEE_HOSTNAME ?? "127.0.0.1")
  const baseUrl = `http://${hostname}:${port}`

  return {
    baseUrl,
    descriptorUrl: joinBaseUrl(baseUrl, "/openbb/agents.json"),
    queryUrl: joinBaseUrl(baseUrl, "/openbb/query"),
    hostname,
    port,
    source,
  }
}

export async function probeOpenBBWorkspaceAvailability(
  config?: OpenBBWorkspaceConfigLike,
  options?: {
    env?: NodeJS.ProcessEnv
    fetchImpl?: ProbeFetch
    timeoutMs?: number
  },
): Promise<OpenBBWorkspaceAvailability> {
  const resolution = resolveOpenBBWorkspace(config, options)
  const fetchImpl = options?.fetchImpl ?? fetch

  let response: Response
  try {
    response = await fetchImpl(resolution.descriptorUrl, {
      method: "GET",
      signal: AbortSignal.timeout(options?.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    })
  } catch (error) {
    return {
      ...resolution,
      available: false,
      daemonReachable: false,
      descriptorReachable: false,
      error: error instanceof Error ? error.message : String(error),
      action: `Start Zee daemon so OpenBB Workspace can reach ${resolution.descriptorUrl}.`,
    }
  }

  if (!response.ok) {
    return {
      ...resolution,
      available: false,
      daemonReachable: true,
      descriptorReachable: false,
      statusCode: response.status,
      error: `HTTP ${response.status} from ${resolution.descriptorUrl}`,
      action: resolveDescriptorAction(resolution.descriptorUrl, response.status),
    }
  }

  let payload: unknown
  try {
    payload = await response.json()
  } catch (error) {
    return {
      ...resolution,
      available: false,
      daemonReachable: true,
      descriptorReachable: false,
      statusCode: response.status,
      error: error instanceof Error ? error.message : String(error),
      action: `Return valid JSON from ${resolution.descriptorUrl}.`,
    }
  }

  const descriptor = resolveDescriptor(payload)
  if (!descriptor) {
    return {
      ...resolution,
      available: false,
      daemonReachable: true,
      descriptorReachable: false,
      statusCode: response.status,
      error: `Invalid OpenBB Workspace descriptor from ${resolution.descriptorUrl}`,
      action: resolveDescriptorAction(resolution.descriptorUrl),
    }
  }

  let queryUrl = resolution.queryUrl
  try {
    queryUrl = new URL(descriptor.query, resolution.baseUrl).toString()
  } catch {
    queryUrl = resolution.queryUrl
  }

  return {
    ...resolution,
    queryUrl,
    available: true,
    daemonReachable: true,
    descriptorReachable: true,
    statusCode: response.status,
  }
}
