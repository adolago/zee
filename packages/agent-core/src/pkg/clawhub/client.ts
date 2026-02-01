/**
 * ClawHub Marketplace HTTP Client
 *
 * Provides API access to the ClawHub public skill registry.
 * Consume-only: search, get details, download, list versions.
 */

import type {
  ClawHubSearchParams,
  ClawHubSearchResult,
  ClawHubSkillDetail,
  ClawHubSkillVersion,
} from "./types"

const DEFAULT_BASE_URL = "https://api.clawhub.com/v1"
const DEFAULT_TIMEOUT_MS = 15_000

export interface ClawHubClientOptions {
  baseUrl?: string
  timeoutMs?: number
}

async function fetchJson<T>(url: string, timeoutMs: number): Promise<T> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, {
      headers: { Accept: "application/json", "User-Agent": "agent-core/clawhub-client" },
      signal: controller.signal,
    })
    if (!res.ok) {
      const body = await res.text().catch(() => "")
      throw new Error(`ClawHub API error ${res.status}: ${body}`)
    }
    return (await res.json()) as T
  } finally {
    clearTimeout(timer)
  }
}

export function createClawHubClient(options?: ClawHubClientOptions) {
  const baseUrl = (options?.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, "")
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS

  return {
    /** Search the marketplace for skills. */
    async search(params: ClawHubSearchParams): Promise<ClawHubSearchResult> {
      const qs = new URLSearchParams({ q: params.query })
      if (params.page) qs.set("page", String(params.page))
      if (params.pageSize) qs.set("pageSize", String(params.pageSize))
      if (params.tags?.length) qs.set("tags", params.tags.join(","))
      return fetchJson<ClawHubSearchResult>(`${baseUrl}/skills?${qs}`, timeoutMs)
    },

    /** Get full details for a skill by ID (supports "owner/slug" or flat "id" format). */
    async get(skillId: string): Promise<ClawHubSkillDetail> {
      // Support owner/slug format: "steipete/coding-agent"
      const encoded = skillId.includes("/")
        ? skillId.split("/").map(encodeURIComponent).join("/")
        : encodeURIComponent(skillId)
      return fetchJson<ClawHubSkillDetail>(`${baseUrl}/skills/${encoded}`, timeoutMs)
    },

    /** List all published versions for a skill. */
    async listVersions(skillId: string): Promise<ClawHubSkillVersion[]> {
      const detail = await this.get(skillId)
      return detail.versions
    },

    /** Download the SKILL.md content for a specific version. */
    async downloadSkillMd(skillId: string, version?: string): Promise<string> {
      const versionSuffix = version ? `@${version}` : ""
      const encoded = skillId.includes("/")
        ? skillId.split("/").map(encodeURIComponent).join("/")
        : encodeURIComponent(skillId)
      const url = `${baseUrl}/skills/${encoded}${versionSuffix}/download`
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), timeoutMs)
      try {
        const res = await fetch(url, {
          headers: { "User-Agent": "agent-core/clawhub-client" },
          signal: controller.signal,
        })
        if (!res.ok) {
          throw new Error(`ClawHub download error ${res.status}`)
        }
        return await res.text()
      } finally {
        clearTimeout(timer)
      }
    },
  }
}

export type ClawHubClient = ReturnType<typeof createClawHubClient>
