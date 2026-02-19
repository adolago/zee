/**
 * Markdown Source-of-Truth Layer
 *
 * Syncs memory entries to human-readable Markdown files:
 * - Daily logs: ~/.local/state/zee/memory/YYYY-MM-DD.md
 * - Entity pages: ~/.local/state/zee/memory/bank/entities/{entity-name}.md
 *
 * These files are git-auditable and human-editable.
 * Qdrant remains the primary query engine; Markdown is the audit trail.
 */

import {
  existsSync,
  mkdirSync,
  appendFileSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  copyFileSync,
  statSync,
} from "node:fs"
import { dirname, join } from "node:path"
import { homedir } from "node:os"
import type { MemoryEntry } from "./types"
import { Log } from "../../packages/zee/src/util/log"

const log = Log.create({ service: "memory-markdown" })

// =============================================================================
// Configuration
// =============================================================================

export interface MarkdownSyncConfig {
  /** Base directory for markdown files. Default: ~/.local/state/zee/memory */
  baseDir?: string
  /** Whether markdown sync is enabled. Default: true */
  enabled?: boolean
  /** Whether to include confidence info in entries. Default: true */
  includeConfidence?: boolean
}

/** Default base directory for markdown memory files */
const DEFAULT_BASE_DIR = join(homedir(), ".local", "state", "zee", "memory")
const LEGACY_BASE_DIR = join(homedir(), "zee", "memory")

export interface MarkdownMigrationResult {
  copied: number
  skipped: number
  errors: number
}

function maybeCopyFile(sourcePath: string, targetPath: string): "copied" | "skipped" {
  if (existsSync(targetPath)) {
    const sourceStats = statSync(sourcePath)
    const targetStats = statSync(targetPath)
    if (targetStats.mtimeMs >= sourceStats.mtimeMs) {
      return "skipped"
    }
  }

  copyFileSync(sourcePath, targetPath)
  return "copied"
}

/**
 * Migrate markdown memory files from legacy location to target location.
 *
 * Copies:
 * - Daily logs: YYYY-MM-DD.md
 * - Entity pages: bank/entities/*.md
 *
 * Existing target files are only replaced when the source file is newer.
 */
export function migrateLegacyMarkdownMemory(sourceDir: string, targetDir: string): MarkdownMigrationResult {
  const result: MarkdownMigrationResult = {
    copied: 0,
    skipped: 0,
    errors: 0,
  }

  if (sourceDir === targetDir) {
    return result
  }

  const copy = (relativePath: string) => {
    const sourcePath = join(sourceDir, relativePath)
    const targetPath = join(targetDir, relativePath)
    try {
      mkdirSync(dirname(targetPath), { recursive: true })
      const status = maybeCopyFile(sourcePath, targetPath)
      result[status]++
    } catch {
      result.errors++
    }
  }

  if (existsSync(sourceDir)) {
    for (const name of readdirSync(sourceDir)) {
      if (/^\d{4}-\d{2}-\d{2}\.md$/.test(name)) {
        copy(name)
      }
    }
  }

  const legacyEntitiesDir = join(sourceDir, "bank", "entities")
  if (existsSync(legacyEntitiesDir)) {
    for (const name of readdirSync(legacyEntitiesDir)) {
      if (name.endsWith(".md")) {
        copy(join("bank", "entities", name))
      }
    }
  }

  return result
}

// =============================================================================
// MarkdownSync Class
// =============================================================================

export class MarkdownSync {
  private readonly baseDir: string
  private readonly enabled: boolean
  private readonly includeConfidence: boolean
  private initialized = false
  private attemptedLegacyMigration = false

  constructor(config?: MarkdownSyncConfig) {
    this.baseDir = config?.baseDir ?? DEFAULT_BASE_DIR
    this.enabled = config?.enabled ?? true
    this.includeConfidence = config?.includeConfidence ?? true
  }

  /** Ensure directory structure exists */
  private ensureDirs(): void {
    if (this.initialized) return
    if (!this.enabled) return

    try {
      const dirs = [this.baseDir, join(this.baseDir, "bank"), join(this.baseDir, "bank", "entities")]

      for (const dir of dirs) {
        if (!existsSync(dir)) {
          mkdirSync(dir, { recursive: true })
        }
      }

      this.migrateLegacyIfNeeded()
      this.initialized = true
    } catch (err) {
      log.warn("Failed to create markdown directories", {
        baseDir: this.baseDir,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  private migrateLegacyIfNeeded(): void {
    if (this.attemptedLegacyMigration) return
    this.attemptedLegacyMigration = true

    // Only migrate automatically for the default XDG state path.
    if (this.baseDir !== DEFAULT_BASE_DIR) return
    if (!existsSync(LEGACY_BASE_DIR)) return

    const result = migrateLegacyMarkdownMemory(LEGACY_BASE_DIR, this.baseDir)
    if (result.copied > 0 || result.errors > 0) {
      log.info("migrated legacy markdown memory files", {
        source: LEGACY_BASE_DIR,
        target: this.baseDir,
        copied: result.copied,
        skipped: result.skipped,
        errors: result.errors,
      })
    }
  }

  // ===========================================================================
  // Daily Logs
  // ===========================================================================

  /** Get the daily log file path for a timestamp */
  private dailyLogPath(timestamp: number): string {
    const date = new Date(timestamp)
    const yyyy = date.getFullYear()
    const mm = String(date.getMonth() + 1).padStart(2, "0")
    const dd = String(date.getDate()).padStart(2, "0")
    return join(this.baseDir, `${yyyy}-${mm}-${dd}.md`)
  }

  /** Append a memory entry to the daily log */
  appendToDailyLog(entry: MemoryEntry): void {
    if (!this.enabled) return
    this.ensureDirs()

    try {
      const filePath = this.dailyLogPath(entry.createdAt)
      const isNew = !existsSync(filePath)

      const time = new Date(entry.createdAt).toLocaleTimeString("en-US", {
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      })

      const lines: string[] = []

      // Add header if new file
      if (isNew) {
        const dateStr = new Date(entry.createdAt).toLocaleDateString("en-US", {
          weekday: "long",
          year: "numeric",
          month: "long",
          day: "numeric",
        })
        lines.push(`# ${dateStr}`, "")
      }

      // Format entry
      const locationParts = [entry.domain, entry.topic, entry.subtopic].filter(Boolean)
      const location = locationParts.length > 0 ? ` [${locationParts.join("/")}]` : ""
      const versionTag = entry.version && entry.version > 1 ? ` (v${entry.version})` : ""
      const confidenceTag =
        this.includeConfidence && entry.confidence !== undefined ? ` {${(entry.confidence * 100).toFixed(0)}%}` : ""

      lines.push(`## ${time} - ${entry.category}${location}${versionTag}${confidenceTag}`, "", entry.content, "")

      // Add metadata line
      const metaParts: string[] = []
      if (entry.id) metaParts.push(`id:${entry.id.substring(0, 8)}`)
      if (entry.memoryId) metaParts.push(`mid:${entry.memoryId.substring(0, 8)}`)
      if (entry.metadata?.tags?.length) metaParts.push(`tags:${entry.metadata.tags.join(",")}`)
      if (entry.metadata?.entities?.length) metaParts.push(`entities:${entry.metadata.entities.join(",")}`)
      if (entry.kind && entry.kind !== "auto") metaParts.push(`kind:${entry.kind}`)
      if (entry.priority && entry.priority !== "normal") metaParts.push(`priority:${entry.priority}`)
      if (entry.bookmarked) metaParts.push("bookmarked")

      if (metaParts.length > 0) {
        lines.push(`<!-- ${metaParts.join(" | ")} -->`, "")
      }

      lines.push("---", "")

      appendFileSync(filePath, lines.join("\n"), "utf-8")
    } catch (err) {
      log.debug("Failed to append to daily log (non-fatal)", {
        id: entry.id,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  // ===========================================================================
  // Entity Pages
  // ===========================================================================

  /** Sanitize entity name for filesystem */
  private entityFileName(entityName: string): string {
    return entityName
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
      .substring(0, 100)
  }

  /** Get entity page file path */
  entityPagePath(entityName: string): string {
    return join(this.baseDir, "bank", "entities", `${this.entityFileName(entityName)}.md`)
  }

  /** Write or update an entity page */
  writeEntityPage(
    entityName: string,
    content: {
      summary: string
      facts: Array<{ content: string; confidence?: number; date: string }>
      relationships?: Array<{ target: string; type: string }>
    },
  ): void {
    if (!this.enabled) return
    this.ensureDirs()

    try {
      const filePath = this.entityPagePath(entityName)
      const lines: string[] = []

      lines.push(`# ${entityName}`, "")
      lines.push(`_Last updated: ${new Date().toISOString()}_`, "")

      // Summary
      lines.push("## Summary", "", content.summary, "")

      // Facts
      if (content.facts.length > 0) {
        lines.push("## Facts", "")
        for (const fact of content.facts) {
          const conf = fact.confidence !== undefined ? ` (${(fact.confidence * 100).toFixed(0)}% confidence)` : ""
          lines.push(`- ${fact.content}${conf} -- ${fact.date}`)
        }
        lines.push("")
      }

      // Relationships
      if (content.relationships && content.relationships.length > 0) {
        lines.push("## Relationships", "")
        for (const rel of content.relationships) {
          lines.push(`- ${rel.type} -> ${rel.target}`)
        }
        lines.push("")
      }

      writeFileSync(filePath, lines.join("\n"), "utf-8")
      log.debug("Entity page written", { entity: entityName, path: filePath })
    } catch (err) {
      log.debug("Failed to write entity page (non-fatal)", {
        entity: entityName,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  /** List all existing entity page names */
  listEntityPages(): string[] {
    if (!this.enabled) return []
    this.ensureDirs()

    try {
      const entitiesDir = join(this.baseDir, "bank", "entities")
      if (!existsSync(entitiesDir)) return []

      return readdirSync(entitiesDir)
        .filter((f) => f.endsWith(".md"))
        .map((f) => f.replace(/\.md$/, ""))
    } catch {
      return []
    }
  }

  /** Read an entity page's raw content */
  readEntityPage(entityName: string): string | null {
    try {
      const filePath = this.entityPagePath(entityName)
      if (!existsSync(filePath)) return null
      return readFileSync(filePath, "utf-8")
    } catch {
      return null
    }
  }

  // ===========================================================================
  // Daily Log Reading
  // ===========================================================================

  /** List available daily log dates */
  listDailyLogs(): string[] {
    if (!this.enabled) return []
    this.ensureDirs()

    try {
      return readdirSync(this.baseDir)
        .filter((f) => /^\d{4}-\d{2}-\d{2}\.md$/.test(f))
        .map((f) => f.replace(/\.md$/, ""))
        .sort()
    } catch {
      return []
    }
  }

  /** Read a daily log's raw content */
  readDailyLog(date: string): string | null {
    try {
      const filePath = join(this.baseDir, `${date}.md`)
      if (!existsSync(filePath)) return null
      return readFileSync(filePath, "utf-8")
    } catch {
      return null
    }
  }

  /** Get base directory */
  getBaseDir(): string {
    return this.baseDir
  }

  /** Check if sync is enabled */
  isEnabled(): boolean {
    return this.enabled
  }
}

// =============================================================================
// Singleton
// =============================================================================

let _markdownSync: MarkdownSync | null = null

export function getMarkdownSync(config?: MarkdownSyncConfig): MarkdownSync {
  if (!_markdownSync) {
    _markdownSync = new MarkdownSync(config)
  }
  return _markdownSync
}

export function resetMarkdownSync(): void {
  _markdownSync = null
}
