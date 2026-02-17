/**
 * ClawHub Marketplace HTTP Client
 *
 * Provides API access to the ClawHub public skill registry.
 * Consume-only: search, get details, download, list versions.
 */

import type { ClawHubSearchParams, ClawHubSearchResult, ClawHubSkillDetail, ClawHubSkillVersion } from "./types"

const DEFAULT_BASE_URL = "https://auth.clawdhub.com/api/v1"
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
      headers: { Accept: "application/json", "User-Agent": "zee/clawhub-client" },
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

/** Extract slug from "owner/slug" or bare "slug" format. */
function toSlug(skillId: string): string {
  return skillId.includes("/") ? skillId.split("/").pop()! : skillId
}

/** Map the real ClawdHub API response to our internal ClawHubSkillDetail type. */
function mapSkillDetail(raw: any, skillId: string): ClawHubSkillDetail {
  const skill = raw.skill ?? raw
  const latestVersion = raw.latestVersion ?? {}
  const owner = raw.owner ?? {}
  return {
    id: skillId,
    name: skill.displayName ?? skill.slug ?? skillId,
    description: skill.summary ?? "",
    author: owner.handle ?? owner.displayName ?? "",
    version: latestVersion.version ?? skill.tags?.latest ?? "1.0.0",
    downloads: skill.stats?.downloads ?? 0,
    tags: Object.keys(skill.tags ?? {}).filter((k) => k !== "latest"),
    updatedAt: skill.updatedAt ? new Date(skill.updatedAt).toISOString() : "",
    createdAt: skill.createdAt ? new Date(skill.createdAt).toISOString() : "",
    readme: "",
    versions: latestVersion.version
      ? [
          {
            version: latestVersion.version,
            publishedAt: latestVersion.createdAt ? new Date(latestVersion.createdAt).toISOString() : "",
            changelog: latestVersion.changelog,
          },
        ]
      : [],
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
      const raw = await fetchJson<any>(`${baseUrl}/skills?${qs}`, timeoutMs)
      const items = raw.items ?? raw.results ?? []
      return {
        results: items.map((item: any) => ({
          id: item.slug ?? item.id,
          name: item.displayName ?? item.name ?? item.slug,
          description: item.summary ?? item.description ?? "",
          author: item.owner?.handle ?? item.author ?? "",
          version: item.tags?.latest ?? item.latestVersion?.version ?? "1.0.0",
          downloads: item.stats?.downloads ?? 0,
          tags: Object.keys(item.tags ?? {}).filter((k: string) => k !== "latest"),
          updatedAt: item.updatedAt ? new Date(item.updatedAt).toISOString() : "",
          createdAt: item.createdAt ? new Date(item.createdAt).toISOString() : "",
        })),
        total: raw.total ?? items.length,
        page: params.page ?? 1,
        pageSize: params.pageSize ?? items.length,
      }
    },

    /** Get full details for a skill by ID (supports "owner/slug" or flat "slug" format). */
    async get(skillId: string): Promise<ClawHubSkillDetail> {
      const slug = toSlug(skillId)
      const raw = await fetchJson<any>(`${baseUrl}/skills/${encodeURIComponent(slug)}`, timeoutMs)
      return mapSkillDetail(raw, skillId)
    },

    /** List all published versions for a skill. */
    async listVersions(skillId: string): Promise<ClawHubSkillVersion[]> {
      const detail = await this.get(skillId)
      return detail.versions
    },

    /** Download the SKILL.md content for a specific version. */
    async downloadSkillMd(skillId: string, _version?: string): Promise<string> {
      const slug = toSlug(skillId)
      const url = `${baseUrl}/download?slug=${encodeURIComponent(slug)}`
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), timeoutMs)
      try {
        const res = await fetch(url, {
          headers: { "User-Agent": "zee/clawhub-client" },
          signal: controller.signal,
        })
        if (!res.ok) {
          throw new Error(`ClawHub download error ${res.status}`)
        }

        // The API returns a ZIP file containing SKILL.md
        const arrayBuffer = await res.arrayBuffer()
        const buffer = Buffer.from(arrayBuffer)

        // Check if response is a ZIP (starts with PK\x03\x04)
        if (buffer.length > 4 && buffer[0] === 0x50 && buffer[1] === 0x4b) {
          // Extract SKILL.md from ZIP using built-in decompress
          const { Decompress } = await import("fflate" as string).catch(() => ({ Decompress: null }))
          if (Decompress) {
            const fflate = await import("fflate" as string)
            const decompressed = fflate.unzipSync(new Uint8Array(buffer))
            for (const [name, data] of Object.entries(decompressed)) {
              if (name === "SKILL.md" || name.endsWith("/SKILL.md")) {
                return new TextDecoder().decode(data as Uint8Array)
              }
            }
            throw new Error("SKILL.md not found in archive")
          }

          // Fallback: use unzip via child_process
          const { execSync } = await import("node:child_process")
          const { mkdtempSync, readFileSync, rmSync } = await import("node:fs")
          const { join } = await import("node:path")
          const { tmpdir } = await import("node:os")
          const tmpDir = mkdtempSync(join(tmpdir(), "clawhub-"))
          try {
            const zipPath = join(tmpDir, "skill.zip")
            const { writeFileSync } = await import("node:fs")
            writeFileSync(zipPath, buffer)
            execSync(`unzip -o "${zipPath}" -d "${tmpDir}"`, { stdio: "pipe" })
            return readFileSync(join(tmpDir, "SKILL.md"), "utf-8")
          } finally {
            rmSync(tmpDir, { recursive: true, force: true })
          }
        }

        // Plain text response
        return new TextDecoder().decode(buffer)
      } finally {
        clearTimeout(timer)
      }
    },
  }
}

export type ClawHubClient = ReturnType<typeof createClawHubClient>
