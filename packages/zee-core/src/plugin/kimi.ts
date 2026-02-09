import type { Hooks, PluginInput } from "@zee/plugin"
import { Installation } from "@/installation"
import { Auth } from "@/auth"
import { Global } from "@/global"
import { KimiLog, installKimiStderrRedirect } from "./kimi-log"
import os from "os"
import path from "path"
import fs from "fs/promises"
import { randomUUID } from "crypto"

const KIMI_CODE_CLIENT_ID = "17e5f671-d194-4dfb-9706-5516cb48c098"
const DEFAULT_OAUTH_HOST = "https://auth.kimi.com"
const DEFAULT_API_BASE_URL = "https://api.kimi.com/coding/v1"

const OAUTH_POLLING_SAFETY_MARGIN_MS = 3000
const REFRESH_INTERVAL_MS = 60 * 1000
const REFRESH_THRESHOLD_MS = 5 * 60 * 1000
const MODEL_REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000

const KIMI_SHARE_DIR_NAME = ".kimi"
const KIMI_DEVICE_ID_FILE = "device_id"
const KIMI_CREDENTIALS_FILE = "kimi-code.json"
const KIMI_FALLBACK_DEVICE_ID_FILE = "kimi-device-id"

let deviceIdPath: string | null = null
let refreshLoopStarted = false
let refreshInFlight: Promise<Auth.Info | null> | null = null
let lastModelRefreshAt = 0

type KimiCliToken = {
  access_token?: string
  refresh_token?: string
  expires_at?: number
  scope?: string
  token_type?: string
}

type KimiModelInfo = {
  id: string
  context_length?: number
  supports_reasoning?: boolean
  supports_image_in?: boolean
  supports_video_in?: boolean
}

function resolveOauthHost() {
  return (
    process.env.KIMI_CODE_OAUTH_HOST?.trim() ||
    process.env.KIMI_OAUTH_HOST?.trim() ||
    DEFAULT_OAUTH_HOST
  )
}

function resolveApiBaseUrl() {
  return process.env.KIMI_CODE_BASE_URL?.trim() || DEFAULT_API_BASE_URL
}

function resolveKimiShareDir() {
  return path.join(Global.Path.home, KIMI_SHARE_DIR_NAME)
}

function resolveKimiDeviceIdPath() {
  return path.join(resolveKimiShareDir(), KIMI_DEVICE_ID_FILE)
}

function resolveFallbackDeviceIdPath() {
  return path.join(Global.Path.state, KIMI_FALLBACK_DEVICE_ID_FILE)
}

function resolveKimiCredentialsPath() {
  return path.join(resolveKimiShareDir(), "credentials", KIMI_CREDENTIALS_FILE)
}

async function ensurePrivateFile(filePath: string) {
  await fs.chmod(filePath, 0o600).catch(() => {})
}

async function readTextFile(filePath: string) {
  try {
    return await fs.readFile(filePath, "utf8")
  } catch {
    return null
  }
}

async function getDeviceId(): Promise<string> {
  if (deviceIdPath) {
    const cached = await readTextFile(deviceIdPath)
    if (cached && cached.trim()) return cached.trim()
  }

  const primary = resolveKimiDeviceIdPath()
  const fallback = resolveFallbackDeviceIdPath()

  const existingPrimary = await readTextFile(primary)
  if (existingPrimary && existingPrimary.trim()) {
    deviceIdPath = primary
    return existingPrimary.trim()
  }

  const existingFallback = await readTextFile(fallback)
  if (existingFallback && existingFallback.trim()) {
    deviceIdPath = fallback
    return existingFallback.trim()
  }

  const deviceId = randomUUID().replace(/-/g, "")
  const targets = [primary, fallback]
  for (const target of targets) {
    try {
      await fs.mkdir(path.dirname(target), { recursive: true })
      await fs.writeFile(target, deviceId, "utf8")
      await ensurePrivateFile(target)
      deviceIdPath = target
      return deviceId
    } catch {
      // try next target
    }
  }

  return deviceId
}

function getDeviceModel(): string {
  const platform = os.platform()
  const arch = os.arch()
  const release = os.release()

  if (platform === "win32") {
    let winRelease = release
    const parts = release.split(".")
    const build = Number(parts[2] ?? "0")
    if (parts[0] === "10" && build >= 22000) {
      winRelease = "11"
    }
    return `Windows ${winRelease} ${arch}`.trim()
  }
  if (platform === "linux") {
    return `Linux ${release} ${arch}`.trim()
  }
  if (platform) {
    return `Unix ${release} ${arch}`.trim()
  }
  return `Unknown ${arch}`.trim()
}

async function getKimiHeaders(): Promise<Record<string, string>> {
  const deviceId = await getDeviceId()
  const version = Installation.VERSION
  const osVersion = typeof os.version === "function" ? os.version() : os.release()

  return {
    "User-Agent": `KimiCLI/${version}`,
    "X-Msh-Platform": "kimi_cli",
    "X-Msh-Version": version,
    "X-Msh-Device-Name": os.hostname(),
    "X-Msh-Device-Model": getDeviceModel(),
    "X-Msh-Os-Version": osVersion,
    "X-Msh-Device-Id": deviceId,
  }
}

async function loadKimiCliToken(): Promise<Auth.Info | null> {
  const credentialsPath = resolveKimiCredentialsPath()
  const raw = await readTextFile(credentialsPath)
  if (!raw) return null

  let payload: KimiCliToken | null = null
  try {
    payload = JSON.parse(raw) as KimiCliToken
  } catch {
    return null
  }

  const access = typeof payload?.access_token === "string" ? payload.access_token.trim() : ""
  if (!access) return null

  const refresh = typeof payload?.refresh_token === "string" ? payload.refresh_token.trim() : ""
  const expiresRaw = payload?.expires_at
  const expiresAtSec =
    typeof expiresRaw === "number"
      ? expiresRaw
      : typeof expiresRaw === "string"
        ? Number(expiresRaw)
        : 0
  const expiresAt = Number.isFinite(expiresAtSec) ? expiresAtSec * 1000 : 0

  const info = {
    type: "oauth" as const,
    access,
    refresh: refresh || access,
    expires: expiresAt,
    ...(payload?.scope ? { scope: String(payload.scope) } : {}),
    ...(payload?.token_type ? { tokenType: String(payload.token_type) } : {}),
  }

  return info as Auth.Info
}

async function saveKimiCliToken(info: Auth.Info) {
  if (info.type !== "oauth") return
  const credentialsPath = resolveKimiCredentialsPath()
  const dir = path.dirname(credentialsPath)
  await fs.mkdir(dir, { recursive: true }).catch(() => {})

  const payload: KimiCliToken = {
    access_token: info.access,
    refresh_token: info.refresh,
    expires_at: Math.floor(info.expires / 1000),
  }
  const extended = info as Auth.Info & { scope?: string; tokenType?: string; token_type?: string }
  if (extended.scope) payload.scope = extended.scope
  if (extended.tokenType) payload.token_type = extended.tokenType
  if (extended.token_type) payload.token_type = extended.token_type

  await fs.writeFile(credentialsPath, JSON.stringify(payload), "utf8").catch(() => {})
  await ensurePrivateFile(credentialsPath)
}

async function deleteKimiCliToken() {
  const credentialsPath = resolveKimiCredentialsPath()
  await fs.unlink(credentialsPath).catch(() => {})
}

async function persistKimiAuth(info: Auth.Info) {
  await Auth.set("kimi-for-coding", info)
  await saveKimiCliToken(info)
}

async function clearKimiAuth() {
  await Auth.remove("kimi-for-coding")
  await deleteKimiCliToken()
}

async function resolveKimiAuth(
  getAuth?: () => Promise<Auth.Info | undefined>,
): Promise<Auth.Info | undefined> {
  const current = getAuth ? await getAuth() : await Auth.get("kimi-for-coding")
  if (current?.type === "oauth" || current?.type === "api") return current

  const fallback = await loadKimiCliToken()
  if (fallback) {
    await Auth.set("kimi-for-coding", fallback)
    return fallback
  }

  return current
}

function isExpiringSoon(info: Auth.Info) {
  if (info.type !== "oauth") return false
  if (!info.expires) return true
  return info.expires < Date.now() + REFRESH_THRESHOLD_MS
}

async function refreshKimiToken(auth: Auth.Info): Promise<Auth.Info | null> {
  if (auth.type !== "oauth" || !auth.refresh) return null

  if (refreshInFlight) return refreshInFlight
  refreshInFlight = (async () => {
    const kimiHeaders = await getKimiHeaders()

    try {
      const response = await fetch(`${resolveOauthHost()}/api/oauth/token`, {
        method: "POST",
        headers: {
          ...kimiHeaders,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          client_id: KIMI_CODE_CLIENT_ID,
          grant_type: "refresh_token",
          refresh_token: auth.refresh,
        }),
      })

      if (response.status === 401 || response.status === 403) {
        KimiLog.warn("Kimi OAuth refresh unauthorized, clearing credentials", {
          status: response.status,
        })
        await clearKimiAuth()
        return null
      }

      if (!response.ok) {
        KimiLog.warn("Kimi OAuth refresh failed", { status: response.status })
        return null
      }

      const data = (await response.json()) as {
        access_token: string
        refresh_token?: string
        expires_in: number
        error?: string
        error_description?: string
      }

      if (!data.access_token) {
        KimiLog.warn("Kimi OAuth refresh missing access token", {
          error: data.error,
          description: data.error_description,
        })
        return null
      }

      const newAuth: Auth.Info = {
        type: "oauth",
        access: data.access_token,
        refresh: data.refresh_token || auth.refresh,
        expires: Date.now() + data.expires_in * 1000,
      }

      await persistKimiAuth(newAuth)
      return newAuth
    } catch (error) {
      KimiLog.warn("Kimi OAuth refresh error", {
        error: error instanceof Error ? error.message : String(error),
      })
      return null
    } finally {
      refreshInFlight = null
    }
  })()

  return refreshInFlight
}

async function ensureFreshKimiAuth(
  getAuth?: () => Promise<Auth.Info | undefined>,
): Promise<Auth.Info | undefined> {
  let info = await resolveKimiAuth(getAuth)
  if (!info || info.type !== "oauth") return info

  if (isExpiringSoon(info)) {
    const refreshed = await refreshKimiToken(info)
    if (refreshed && refreshed.type === "oauth") {
      info = refreshed
    }
  }

  return info
}

function startKimiRefreshLoop() {
  if (refreshLoopStarted) return
  refreshLoopStarted = true

  if (process.env.NODE_ENV === "test" || process.env.VITEST) return

  void ensureFreshKimiAuth().catch((error) => {
    KimiLog.warn("Kimi OAuth refresh loop failed", {
      error: error instanceof Error ? error.message : String(error),
    })
  })

  setInterval(() => {
    void ensureFreshKimiAuth().catch((error) => {
      KimiLog.warn("Kimi OAuth refresh loop failed", {
        error: error instanceof Error ? error.message : String(error),
      })
    })
  }, REFRESH_INTERVAL_MS)
}

function guessFamily(modelId: string) {
  const lower = modelId.toLowerCase()
  if (lower.includes("/")) {
    return lower.split("/").pop()
  }
  if (lower.includes("-thinking")) return modelId.replace(/-thinking$/i, "")
  if (lower.includes("-turbo")) return modelId.replace(/-turbo$/i, "")
  if (lower.includes("-preview")) return modelId.replace(/-preview$/i, "")
  return modelId
}

async function fetchKimiModels(accessToken: string, baseUrl: string): Promise<KimiModelInfo[]> {
  const url = `${baseUrl.replace(/\/$/, "")}/models`
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  })

  if (!response.ok) {
    throw new Error(`Models request failed (${response.status})`)
  }

  const payload = (await response.json()) as { data?: KimiModelInfo[] }
  if (!payload?.data || !Array.isArray(payload.data)) return []

  return payload.data
}

function buildKimiModelDefinition(model: KimiModelInfo, baseUrl: string) {
  const context = model.context_length && model.context_length > 0 ? model.context_length : 100000
  const reasoning = Boolean(model.supports_reasoning || model.id.toLowerCase().includes("thinking"))
  const attachment = Boolean(model.supports_image_in || model.supports_video_in)
  const outputLimit = context >= 200000 ? 32768 : 8192

  return {
    id: model.id,
    providerID: "kimi-for-coding",
    name: model.id,
    family: guessFamily(model.id),
    api: {
      id: model.id,
      url: baseUrl,
      npm: "@ai-sdk/openai-compatible",
    },
    status: "active",
    headers: {},
    options: {},
    cost: {
      input: 0,
      output: 0,
      cache: {
        read: 0,
        write: 0,
      },
    },
    limit: {
      context,
      output: outputLimit,
    },
    capabilities: {
      temperature: true,
      reasoning,
      attachment,
      toolcall: true,
      input: {
        text: true,
        audio: false,
        image: Boolean(model.supports_image_in),
        video: Boolean(model.supports_video_in),
        pdf: false,
      },
      output: {
        text: true,
        audio: false,
        image: false,
        video: false,
        pdf: false,
      },
      interleaved: reasoning ? { field: "reasoning_content" } : false,
    },
    release_date: new Date().toISOString().slice(0, 10),
    variants: {},
  }
}

async function maybeRefreshKimiModels(provider: any, auth: Auth.Info | undefined) {
  if (!provider?.models || !auth || auth.type !== "oauth") return
  if (process.env.NODE_ENV === "test" || process.env.VITEST) return

  const now = Date.now()
  if (now - lastModelRefreshAt < MODEL_REFRESH_INTERVAL_MS) return
  lastModelRefreshAt = now

  const baseUrl = resolveApiBaseUrl()
  let models: KimiModelInfo[] = []

  try {
    models = await fetchKimiModels(auth.access, baseUrl)
  } catch (error) {
    KimiLog.warn("Failed to refresh Kimi models", {
      error: error instanceof Error ? error.message : String(error),
    })
    return
  }

  if (!models.length) return

  let added = 0
  for (const model of models) {
    if (!model?.id) continue
    const existing = provider.models[model.id]
    if (!existing) {
      provider.models[model.id] = buildKimiModelDefinition(model, baseUrl)
      added += 1
      continue
    }

    if (model.context_length && existing.limit?.context) {
      if (existing.limit.context < model.context_length) {
        existing.limit.context = model.context_length
      }
    }

    if (model.supports_reasoning && existing.capabilities) {
      existing.capabilities.reasoning = true
      if (!existing.capabilities.interleaved) {
        existing.capabilities.interleaved = { field: "reasoning_content" }
      }
    }
  }

  if (added > 0) {
    KimiLog.info("Kimi models refreshed", { added, total: models.length })
  }
}

export async function KimiAuthPlugin(_input: PluginInput): Promise<Hooks> {
  const redirectDisabled = (process.env.ZEE_KIMI_LOG_STDERR || process.env.AGENT_CORE_KIMI_LOG_STDERR || "")
    .trim()
    .toLowerCase()
  installKimiStderrRedirect({ enabled: !["0", "false", "no"].includes(redirectDisabled) })
  try {
    await resolveKimiAuth()
  } catch (error) {
    KimiLog.warn("Failed to sync Kimi credentials from CLI", {
      error: error instanceof Error ? error.message : String(error),
    })
  }
  startKimiRefreshLoop()

  return {
    auth: {
      provider: "kimi-for-coding",
      async loader(getAuth, provider) {
        const info = await ensureFreshKimiAuth(getAuth)
        if (!info || info.type !== "oauth") return {}

        await maybeRefreshKimiModels(provider, info)

        if (provider && provider.models) {
          for (const model of Object.values(provider.models)) {
            model.cost = {
              input: 0,
              output: 0,
              cache: {
                read: 0,
                write: 0,
              },
            }
          }
        }

        return {
          baseURL: resolveApiBaseUrl(),
          apiKey: "",
          async fetch(request: RequestInfo | URL, init?: RequestInit) {
            let info = await ensureFreshKimiAuth(getAuth)
            if (!info || info.type !== "oauth") return fetch(request, init)

            const kimiHeaders = await getKimiHeaders()

            const initHeaders = (init?.headers as Record<string, string>) || {}
            const headers: Record<string, string> = {}

            for (const [key, value] of Object.entries(initHeaders)) {
              if (key.toLowerCase() !== "user-agent") {
                headers[key] = value
              }
            }

            Object.assign(headers, kimiHeaders)
            headers["Authorization"] = `Bearer ${info.access}`

            delete headers["x-api-key"]
            delete headers["authorization"]

            return fetch(request, {
              ...init,
              headers,
            })
          },
        }
      },
      methods: [
        {
          type: "oauth",
          label: "Login with Kimi For Coding",
          async authorize() {
            const kimiHeaders = await getKimiHeaders()
            const oauthHost = resolveOauthHost()

            const deviceResponse = await fetch(`${oauthHost}/api/oauth/device_authorization`, {
              method: "POST",
              headers: {
                ...kimiHeaders,
                "Content-Type": "application/x-www-form-urlencoded",
              },
              body: new URLSearchParams({
                client_id: KIMI_CODE_CLIENT_ID,
              }),
            })

            if (!deviceResponse.ok) {
              const errorText = await deviceResponse.text()
              throw new Error(`Failed to initiate device authorization: ${errorText}`)
            }

            const deviceData = (await deviceResponse.json()) as {
              user_code: string
              device_code: string
              verification_uri: string
              verification_uri_complete: string
              expires_in: number
              interval: number
            }

            return {
              url: deviceData.verification_uri_complete,
              instructions: `Enter code: ${deviceData.user_code}`,
              method: "auto" as const,
              async callback() {
                const pollInterval = Math.max(deviceData.interval || 5, 1) * 1000

                while (true) {
                  const tokenResponse = await fetch(`${oauthHost}/api/oauth/token`, {
                    method: "POST",
                    headers: {
                      ...kimiHeaders,
                      "Content-Type": "application/x-www-form-urlencoded",
                    },
                    body: new URLSearchParams({
                      client_id: KIMI_CODE_CLIENT_ID,
                      device_code: deviceData.device_code,
                      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
                    }),
                  })

                  const data = (await tokenResponse.json()) as {
                    access_token?: string
                    refresh_token?: string
                    expires_in?: number
                    scope?: string
                    token_type?: string
                    error?: string
                    error_description?: string
                    interval?: number
                  }

                  if (tokenResponse.status === 200 && data.access_token) {
                    const expiresIn = data.expires_in || 3600
                    const result = {
                      type: "success" as const,
                      access: data.access_token,
                      refresh: data.refresh_token || data.access_token,
                      expires: Date.now() + expiresIn * 1000,
                      ...(data.scope ? { scope: data.scope } : {}),
                      ...(data.token_type ? { tokenType: data.token_type } : {}),
                    }
                    await saveKimiCliToken({
                      type: "oauth",
                      access: result.access,
                      refresh: result.refresh,
                      expires: result.expires,
                      ...(result.scope ? { scope: result.scope } : {}),
                      ...(result.tokenType ? { tokenType: result.tokenType } : {}),
                    } as Auth.Info)
                    return result
                  }

                  if (data.error === "authorization_pending") {
                    await Bun.sleep(pollInterval + OAUTH_POLLING_SAFETY_MARGIN_MS)
                    continue
                  }

                  if (data.error === "slow_down") {
                    const newInterval = data.interval
                      ? data.interval * 1000
                      : pollInterval + 5000
                    await Bun.sleep(newInterval + OAUTH_POLLING_SAFETY_MARGIN_MS)
                    continue
                  }

                  if (data.error === "expired_token") {
                    return { type: "failed" as const }
                  }

                  if (data.error) {
                    return { type: "failed" as const }
                  }

                  await Bun.sleep(pollInterval + OAUTH_POLLING_SAFETY_MARGIN_MS)
                }
              },
            }
          },
        },
      ],
    },
  }
}
