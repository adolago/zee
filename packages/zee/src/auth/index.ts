import path from "path"
import { Global } from "../global"
import fs from "fs/promises"
import z from "zod"
import { Log } from "../util/log"

export const OAUTH_DUMMY_KEY = "zee-oauth-dummy-key"

// Buffer time before expiry to trigger refresh (10 minutes)
const REFRESH_BUFFER_MS = 10 * 60 * 1000

// OAuth refresh configurations for known providers
const OAUTH_REFRESH_CONFIG: Record<string, { url: string; clientId: string; clientSecret?: string }> = {
  anthropic: {
    url: "https://console.anthropic.com/v1/oauth/token",
    clientId: "9d1c250a-e61b-44d9-88ed-5944d1962f5e",
  },
  openai: {
    url: "https://auth.openai.com/oauth/token",
    clientId: "pdlLIX2Y72MgDktxw22rHpPdJKmlMVBi", // ChatGPT client ID
  },
  "gemini-cli": {
    url: "https://oauth2.googleapis.com/token",
    clientId: "1071006060591-tmhssin2h21lcre235vtolojh4g403ep.apps.googleusercontent.com",
    clientSecret: "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",
  },
  // Note: kimi-for-coding uses custom refresh in plugin (requires X-Msh-* headers)
}

export namespace Auth {
  export const Oauth = z
    .object({
      type: z.literal("oauth"),
      refresh: z.string(),
      access: z.string(),
      expires: z.number(),
      accountId: z.string().optional(),
    })
    .passthrough() // Allow extra fields like email, projectId for antigravity
    .meta({ ref: "OAuth" })

  export const Api = z
    .object({
      type: z.literal("api"),
      key: z.string(),
    })
    .passthrough() // Allow extra fields like username for languagetool
    .meta({ ref: "ApiAuth" })

  export const WellKnown = z
    .object({
      type: z.literal("wellknown"),
      key: z.string(),
      token: z.string(),
    })
    .meta({ ref: "WellKnownAuth" })

  export const Info = z.discriminatedUnion("type", [Oauth, Api, WellKnown]).meta({ ref: "Auth" })
  export type Info = z.infer<typeof Info>

  const filepath = path.join(Global.Path.data, "auth.json")

  export async function get(providerID: string): Promise<Info | undefined> {
    const auth = await all()
    return auth[providerID]
  }

  export async function all(): Promise<Record<string, Info>> {
    const file = Bun.file(filepath)
    const data = await file.json().catch(() => ({}) as Record<string, unknown>)
    return Object.entries(data).reduce(
      (acc, [key, value]) => {
        const parsed = Info.safeParse(value)
        if (!parsed.success) return acc
        acc[key] = parsed.data
        return acc
      },
      {} as Record<string, Info>,
    )
  }

  export async function set(key: string, info: Info) {
    const file = Bun.file(filepath)
    const data = await all()
    await Bun.write(file, JSON.stringify({ ...data, [key]: info }, null, 2))
    await fs.chmod(file.name!, 0o600)
  }

  export async function remove(key: string) {
    const file = Bun.file(filepath)
    const data = await all()
    delete data[key]
    await Bun.write(file, JSON.stringify(data, null, 2))
    await fs.chmod(file.name!, 0o600)
  }

  const log = Log.create({ service: "auth" })

  /**
   * Check if an OAuth token is expiring soon (within buffer)
   */
  export function isExpiringSoon(auth: Info): boolean {
    if (auth.type !== "oauth") return false
    return auth.expires < Date.now() + REFRESH_BUFFER_MS
  }

  /**
   * Check if an OAuth token is expired
   */
  export function isExpired(auth: Info): boolean {
    if (auth.type !== "oauth") return false
    return auth.expires < Date.now()
  }

  /**
   * Refresh an OAuth token for a known provider
   */
  export async function refreshToken(providerID: string): Promise<boolean> {
    const auth = await get(providerID)
    if (!auth || auth.type !== "oauth") return false

    const config = OAUTH_REFRESH_CONFIG[providerID]
    if (!config) {
      log.warn("no refresh config for provider", { providerID })
      return false
    }

    try {
      log.info("refreshing token", { providerID, expiresIn: Math.round((auth.expires - Date.now()) / 1000) })

      const body: Record<string, string> = {
        grant_type: "refresh_token",
        refresh_token: auth.refresh,
        client_id: config.clientId,
      }
      if (config.clientSecret) {
        body.client_secret = config.clientSecret
      }

      const response = await fetch(config.url, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams(body),
      })

      if (!response.ok) {
        log.error("token refresh failed", { providerID, status: response.status })
        return false
      }

      const json = (await response.json()) as {
        access_token: string
        refresh_token?: string
        expires_in: number
      }

      await set(providerID, {
        ...auth,
        type: "oauth",
        access: json.access_token,
        refresh: json.refresh_token ?? auth.refresh,
        expires: Date.now() + json.expires_in * 1000,
      })

      log.info("token refreshed", { providerID, expiresIn: json.expires_in })
      return true
    } catch (error) {
      log.error("token refresh error", { providerID, error: String(error) })
      return false
    }
  }

  /**
   * Proactively refresh all OAuth tokens that are expiring soon
   */
  export async function refreshAllExpiring(): Promise<{ refreshed: string[]; failed: string[] }> {
    const allAuth = await all()
    const refreshed: string[] = []
    const failed: string[] = []

    for (const [providerID, auth] of Object.entries(allAuth)) {
      if (auth.type !== "oauth") continue
      if (!isExpiringSoon(auth)) continue
      if (!OAUTH_REFRESH_CONFIG[providerID]) continue

      const success = await refreshToken(providerID)
      if (success) {
        refreshed.push(providerID)
      } else {
        failed.push(providerID)
      }
    }

    if (refreshed.length > 0 || failed.length > 0) {
      log.info("proactive token refresh complete", { refreshed, failed })
    }

    return { refreshed, failed }
  }

  /**
   * Get status of all OAuth tokens
   */
  export async function status(): Promise<
    Record<string, { valid: boolean; expiringSoon: boolean; expiresIn: number | null }>
  > {
    const allAuth = await all()
    const result: Record<string, { valid: boolean; expiringSoon: boolean; expiresIn: number | null }> = {}

    for (const [providerID, auth] of Object.entries(allAuth)) {
      if (auth.type === "oauth") {
        const expiresIn = Math.round((auth.expires - Date.now()) / 1000)
        result[providerID] = {
          valid: !isExpired(auth),
          expiringSoon: isExpiringSoon(auth),
          expiresIn,
        }
      } else {
        result[providerID] = {
          valid: true,
          expiringSoon: false,
          expiresIn: null,
        }
      }
    }

    return result
  }
}
