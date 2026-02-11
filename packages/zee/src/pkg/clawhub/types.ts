/**
 * ClawHub Marketplace Registry Types
 *
 * Type definitions for the ClawHub public registry API responses.
 * Consume-only: zee downloads and installs skills but never publishes.
 */

export interface ClawHubSkillSummary {
  id: string
  name: string
  description: string
  author: string
  version: string
  downloads: number
  tags: string[]
  updatedAt: string
  createdAt: string
}

export interface ClawHubSkillDetail extends ClawHubSkillSummary {
  readme: string
  license?: string
  repository?: string
  homepage?: string
  versions: ClawHubSkillVersion[]
  requires?: ClawHubRequires
}

export interface ClawHubSkillVersion {
  version: string
  publishedAt: string
  changelog?: string
  requires?: ClawHubRequires
}

export interface ClawHubRequires {
  /** Required binaries that must be available in PATH. */
  bins?: string[]
  /** Required environment variables. */
  env?: string[]
  /** Required config keys. */
  config?: string[]
  /** Supported operating systems (e.g. "linux", "darwin", "win32"). */
  os?: string[]
}

export interface ClawHubSearchResult {
  results: ClawHubSkillSummary[]
  total: number
  page: number
  pageSize: number
}

export interface ClawHubSearchParams {
  query: string
  page?: number
  pageSize?: number
  tags?: string[]
}

export interface ClawHubInstalledSkill {
  id: string
  version: string
  installedAt: string
  location: string
  source: "clawhub"
  /** Persona this skill is scoped to, or undefined for shared. */
  persona?: "zee" | "stanley" | "johny"
}

export interface ClawHubManifest {
  installed: Record<string, ClawHubInstalledSkill>
}
