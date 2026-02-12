import type { CompareFormat, CompareScope, Feature, ProjectId, SupportLevel } from "./types"
import type { CompareSnapshot } from "./snapshot"

export type CompareProjects = Record<
  ProjectId,
  {
    id: ProjectId
    name: string
    repo?: string
    branch?: string
  }
>

export const DEFAULT_PROJECTS: CompareProjects = {
  zee: { id: "zee", name: "Zee", repo: "adolago/zee", branch: "dev" },
  opencode: { id: "opencode", name: "OpenCode", repo: "sst/opencode", branch: "dev" },
  openclaw: { id: "openclaw", name: "OpenClaw", repo: "openclaw/openclaw", branch: "main" },
  pimono: { id: "pimono", name: "Pi-mono", repo: "badlogic/pi-mono", branch: "main" },
}

export function supportLevelLabel(level: SupportLevel): string {
  switch (level) {
    case "yes":
      return "Yes"
    case "no":
      return "No"
    case "partial":
      return "Partial"
    case "via_plugin":
      return "Via plugin"
    case "planned":
      return "Planned"
    case "n_a":
      return "N/A"
    case "unknown":
      return "Unknown"
    default: {
      const exhaustive: never = level
      return exhaustive
    }
  }
}

function escapeMdTableCell(input: string): string {
  // Avoid breaking tables; keep readable.
  return input.replace(/\|/g, "\\|").replace(/\r?\n/g, " ").trim()
}

function normalizeProjects(projects: CompareProjects): Array<{ id: ProjectId; name: string }> {
  // Fixed display order.
  return [
    { id: "zee", name: projects.zee.name },
    { id: "opencode", name: projects.opencode.name },
    { id: "openclaw", name: projects.openclaw.name },
    { id: "pimono", name: projects.pimono.name },
  ]
}

function groupByCategory(features: Feature[]): Array<{ category: string; features: Feature[] }> {
  const map = new Map<string, Feature[]>()
  for (const f of features) {
    const arr = map.get(f.category)
    if (arr) arr.push(f)
    else map.set(f.category, [f])
  }
  return Array.from(map.entries()).map(([category, fs]) => ({ category, features: fs }))
}

function formatPins(snapshot?: CompareSnapshot): string[] {
  if (!snapshot) return []
  const lines: string[] = []

  lines.push(`Generated: ${snapshot.generatedAt}`)
  lines.push(`Zee: ${snapshot.zee.channel}/${snapshot.zee.version} (${snapshot.zee.runtimeMode})`)
  if (snapshot.zee.gitSha) lines.push(`Zee git: ${snapshot.zee.gitSha}`)

  const up = snapshot.upstream
  if (up.opencode?.head) lines.push(`OpenCode pin: ${up.opencode.head} (${up.opencode.remote}/${up.opencode.branch})`)
  if (up.openclaw?.head) lines.push(`OpenClaw pin: ${up.openclaw.head} (${up.openclaw.remote}/${up.openclaw.branch})`)
  if (up.pimono?.head) lines.push(`Pi-mono pin: ${up.pimono.head} (${up.pimono.remote}/${up.pimono.branch})`)

  if (snapshot.pimono.installedPiCodingAgentVersion) {
    lines.push(`Pi-mono (installed): @mariozechner/pi-coding-agent@${snapshot.pimono.installedPiCodingAgentVersion}`)
  }
  if (snapshot.pimono.latestTag) {
    lines.push(`Pi-mono (latest tag): ${snapshot.pimono.latestTag}`)
  }

  if (snapshot.skills) {
    lines.push(`Skills: ${snapshot.skills.total}`)
  }

  if (snapshot.warnings.length) {
    lines.push(`Warnings: ${snapshot.warnings.length} (use --scope full to see details)`)
  }

  return lines
}

export type RenderCompareInput = {
  features: Feature[]
  snapshot?: CompareSnapshot
  scope: CompareScope
  format: CompareFormat
  projects?: CompareProjects
}

export function renderCompare(input: RenderCompareInput): string | object {
  const projects = input.projects ?? DEFAULT_PROJECTS
  switch (input.format) {
    case "text":
      return renderText(input.features, projects, input.snapshot, input.scope)
    case "md":
      return renderMarkdown(input.features, projects, input.snapshot, input.scope)
    case "json":
      return renderJson(input.features, projects, input.snapshot)
    default: {
      const exhaustive: never = input.format
      return exhaustive
    }
  }
}

function renderText(
  features: Feature[],
  projects: CompareProjects,
  snapshot: CompareSnapshot | undefined,
  scope: CompareScope,
): string {
  const p = normalizeProjects(projects)
  const out: string[] = []
  out.push("Feature Comparison")
  out.push("")

  const pins = formatPins(snapshot)
  if (pins.length) {
    out.push("Snapshot")
    for (const line of pins) out.push(`- ${line}`)
    out.push("")
  }

  const groups = groupByCategory(features)
  for (const g of groups) {
    out.push(g.category)
    for (const f of g.features) {
      const parts = p.map(({ id, name }) => `${name}=${supportLevelLabel(f.support[id].level)}`)
      out.push(`- ${f.label}: ${parts.join(" | ")}`)
      if (scope === "full") {
        out.push(`  ${f.description}`)
        for (const { id, name } of p) {
          const cell = f.support[id]
          if (!cell.notes && (!cell.evidence || cell.evidence.length === 0)) continue
          const pieces: string[] = []
          if (cell.notes) pieces.push(cell.notes)
          if (cell.evidence?.length) {
            pieces.push(
              "evidence: " +
                cell.evidence
                  .map((e) => `${e.kind}:${e.ref}`)
                  .join(", "),
            )
          }
          out.push(`  ${name}: ${pieces.join(" | ")}`)
        }
      }
    }
    out.push("")
  }

  if (scope === "full" && snapshot?.warnings.length) {
    out.push("Warnings")
    for (const w of snapshot.warnings) out.push(`- ${w}`)
    out.push("")
  }

  return out.join("\n")
}

function renderMarkdown(
  features: Feature[],
  projects: CompareProjects,
  snapshot: CompareSnapshot | undefined,
  scope: CompareScope,
): string {
  const p = normalizeProjects(projects)
  const out: string[] = []
  out.push("# Feature Comparison")
  out.push("")
  out.push("This document is generated. Do not edit by hand.")
  out.push("")
  out.push("Regenerate:")
  out.push("")
  out.push("```bash")
  out.push("cd packages/zee && bun run --conditions=browser ./src/index.ts compare --format md --scope full --output ../../docs/architecture/feature-comparison.md")
  out.push("```")
  out.push("")

  if (snapshot) {
    out.push("## Snapshot")
    out.push("")
    out.push(`- Generated: \`${snapshot.generatedAt}\``)
    out.push(`- Zee: \`${snapshot.zee.channel}/${snapshot.zee.version}\` (\`${snapshot.zee.runtimeMode}\`)`)
    if (snapshot.zee.gitSha) out.push(`- Zee git: \`${snapshot.zee.gitSha}\``)
    if (snapshot.upstream.opencode?.head) out.push(`- OpenCode pin: \`${snapshot.upstream.opencode.head}\` (\`${snapshot.upstream.opencode.remote}/${snapshot.upstream.opencode.branch}\`)`)
    if (snapshot.upstream.openclaw?.head) out.push(`- OpenClaw pin: \`${snapshot.upstream.openclaw.head}\` (\`${snapshot.upstream.openclaw.remote}/${snapshot.upstream.openclaw.branch}\`)`)
    if (snapshot.upstream.pimono?.head) out.push(`- Pi-mono pin: \`${snapshot.upstream.pimono.head}\` (\`${snapshot.upstream.pimono.remote}/${snapshot.upstream.pimono.branch}\`)`)
    if (snapshot.pimono.installedPiCodingAgentVersion) out.push(`- Pi-mono installed: \`@mariozechner/pi-coding-agent@${snapshot.pimono.installedPiCodingAgentVersion}\``)
    if (snapshot.pimono.latestTag) out.push(`- Pi-mono latest tag: \`${snapshot.pimono.latestTag}\``)
    if (snapshot.skills) {
      const topNamespaces = Object.entries(snapshot.skills.namespaces)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 6)
        .map(([k, v]) => `${k}=${v}`)
        .join(", ")
      out.push(`- Skills: \`${snapshot.skills.total}\`${topNamespaces ? ` (top: ${topNamespaces})` : ""}`)
    }
    out.push("")
  }

  out.push("## Legend")
  out.push("")
  out.push("- Yes: built-in")
  out.push("- Partial: exists but limited scope or different semantics")
  out.push("- Via plugin: available through plugins/extensions")
  out.push("- Planned: intended but not yet shipped")
  out.push("- N/A: not applicable")
  out.push("- Unknown: not verified")
  out.push("")

  out.push("## Feature Matrix")
  out.push("")
  out.push(
    [
      "| Feature | Description |",
      ...p.map((x) => ` ${x.name} |`),
    ].join(""),
  )
  out.push(
    [
      "| --- | --- |",
      ...p.map(() => " --- |"),
    ].join(""),
  )

  const groups = groupByCategory(features)
  for (const g of groups) {
    // Category row as a bold divider inside the table.
    out.push(
      `| **${escapeMdTableCell(g.category)}** |  |` +
        p.map(() => "  |").join(""),
    )
    for (const f of g.features) {
      const cells = p.map(({ id }) => escapeMdTableCell(supportLevelLabel(f.support[id].level)))
      out.push(
        `| ${escapeMdTableCell(f.label)} | ${escapeMdTableCell(f.description)} | ${cells.join(" | ")} |`,
      )
    }
  }

  if (scope === "full") {
    out.push("")
    out.push("## Notes (Full)")
    out.push("")

    for (const g of groups) {
      const withNotes = g.features.filter((f) =>
        p.some(({ id }) => {
          const cell = f.support[id]
          return Boolean(cell.notes) || Boolean(cell.evidence?.length)
        }),
      )
      if (withNotes.length === 0) continue

      out.push(`### ${escapeMdTableCell(g.category)}`)
      out.push("")

      for (const f of withNotes) {
        out.push(`#### ${escapeMdTableCell(f.label)}`)
        out.push("")
        out.push(f.description)
        out.push("")
        for (const { id, name } of p) {
          const cell = f.support[id]
          if (!cell.notes && (!cell.evidence || cell.evidence.length === 0)) continue
          const pieces: string[] = []
          pieces.push(supportLevelLabel(cell.level))
          if (cell.notes) pieces.push(cell.notes)
          if (cell.evidence?.length) {
            pieces.push("evidence: " + cell.evidence.map((e) => `${e.kind}:${e.ref}`).join(", "))
          }
          out.push(`- ${name}: ${pieces.join(" | ")}`)
        }
        out.push("")
      }
    }

    if (snapshot?.warnings.length) {
      out.push("### Snapshot Warnings")
      out.push("")
      for (const w of snapshot.warnings) out.push(`- ${escapeMdTableCell(w)}`)
      out.push("")
    }
  }

  return out.join("\n")
}

function renderJson(features: Feature[], projects: CompareProjects, snapshot: CompareSnapshot | undefined): object {
  return {
    generatedAt: snapshot?.generatedAt ?? new Date().toISOString(),
    projects,
    snapshot: snapshot ?? null,
    features,
  }
}
