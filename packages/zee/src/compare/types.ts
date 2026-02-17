export type ProjectId = "zee" | "opencode" | "openclaw" | "pimono"

export type CompareScope = "quick" | "full"
export type CompareFormat = "text" | "md" | "json"

export type SupportLevel = "yes" | "no" | "partial" | "via_plugin" | "planned" | "n_a" | "unknown"

export type Evidence = { kind: "repo_path"; ref: string } | { kind: "doc"; ref: string } | { kind: "note"; ref: string }

export type FeatureSupport = {
  level: SupportLevel
  notes?: string
  evidence?: Evidence[]
}

export type Feature = {
  /** Stable ID for scripting and doc anchors. */
  id: string
  /** Stable category label used for grouping in outputs. */
  category: string
  /** Short row label used in tables. */
  label: string
  /** One-sentence description of what the feature means. */
  description: string
  /** Support matrix per project. */
  support: Record<ProjectId, FeatureSupport>
  /** Optional tags for filtering or future render variants. */
  tags?: string[]
  /** Optional ordering hint within a category. Lower first. */
  sort?: number
}
