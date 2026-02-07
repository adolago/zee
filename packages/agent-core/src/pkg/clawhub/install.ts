/**
 * ClawHub Skill Installation
 *
 * Downloads and installs skills from ClawHub to ~/.agents/skills/@clawhub/.
 * Manages the local manifest of installed marketplace skills.
 */

import fs from "fs"
import path from "path"
import os from "os"
import { createClawHubClient, type ClawHubClient } from "./client"
import { evaluateGating } from "./gating"
import type { ClawHubInstalledSkill, ClawHubManifest } from "./types"

const CLAWHUB_SKILLS_DIR = path.join(os.homedir(), ".agents", "skills", "@clawhub")
const MANIFEST_FILE = path.join(CLAWHUB_SKILLS_DIR, ".manifest.json")

const VALID_PERSONAS = ["zee", "stanley", "johny"] as const
type Persona = (typeof VALID_PERSONAS)[number]

/** Derive the local directory name from a skill ID (handles "owner/slug" format). */
function skillDirName(skillId: string): string {
  // "steipete/coding-agent" -> "coding-agent"
  return skillId.includes("/") ? skillId.split("/").pop()! : skillId
}

function resolveSkillDir(skillId: string, persona?: string): string {
  const dirName = skillDirName(skillId)
  if (persona && VALID_PERSONAS.includes(persona as Persona)) {
    return path.join(os.homedir(), ".agents", "skills", `@${persona}`, dirName)
  }
  return path.join(CLAWHUB_SKILLS_DIR, dirName)
}

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
}

function readManifest(): ClawHubManifest {
  try {
    if (fs.existsSync(MANIFEST_FILE)) {
      const raw = fs.readFileSync(MANIFEST_FILE, "utf-8")
      return JSON.parse(raw) as ClawHubManifest
    }
  } catch {
    // corrupted manifest; start fresh
  }
  return { installed: {} }
}

function writeManifest(manifest: ClawHubManifest): void {
  ensureDir(CLAWHUB_SKILLS_DIR)
  fs.writeFileSync(MANIFEST_FILE, JSON.stringify(manifest, null, 2))
}

export interface InstallResult {
  ok: boolean
  skillId: string
  version: string
  location: string
  gatingIssues?: Array<{ kind: string; name: string; message: string }>
  /** Environment variables required by this skill (from requires.env). */
  requiredEnv?: string[]
  error?: string
}

export interface UpdateResult {
  skillId: string
  updated: boolean
  fromVersion?: string
  toVersion?: string
  error?: string
}

export function createClawHubInstaller(client?: ClawHubClient) {
  const api = client ?? createClawHubClient()

  return {
    /** Install a skill from the ClawHub marketplace.
     * @param persona - If set, installs to ~/.agents/skills/@<persona>/ for persona-specific scoping.
     */
    async install(skillId: string, version?: string, persona?: string): Promise<InstallResult> {
      const skillDir = resolveSkillDir(skillId, persona)

      try {
        // Fetch skill details
        const detail = await api.get(skillId)

        // Check gating requirements
        const targetVersion = version ?? detail.version
        const versionInfo = detail.versions.find((v) => v.version === targetVersion)
        const requires = versionInfo?.requires ?? detail.requires
        const gating = await evaluateGating(requires)

        if (!gating.ok) {
          return {
            ok: false,
            skillId,
            version: targetVersion,
            location: skillDir,
            gatingIssues: gating.issues,
            error: `Gating requirements not met: ${gating.issues.map((i) => i.message).join("; ")}`,
          }
        }

        // Download the skill content
        const skillMd = await api.downloadSkillMd(skillId, version)

        // Write to disk
        ensureDir(skillDir)
        fs.writeFileSync(path.join(skillDir, "SKILL.md"), skillMd)

        // Update manifest
        const manifest = readManifest()
        manifest.installed[skillId] = {
          id: skillId,
          version: targetVersion,
          installedAt: new Date().toISOString(),
          location: skillDir,
          source: "clawhub",
          ...(persona && VALID_PERSONAS.includes(persona as Persona) ? { persona: persona as Persona } : {}),
        }
        writeManifest(manifest)

        const requiredEnv = requires?.env?.length ? requires.env : undefined
        return { ok: true, skillId, version: targetVersion, location: skillDir, requiredEnv }
      } catch (err) {
        return {
          ok: false,
          skillId,
          version: version ?? "latest",
          location: skillDir,
          error: err instanceof Error ? err.message : String(err),
        }
      }
    },

    /** Update a specific installed skill or all installed skills. */
    async update(skillId?: string): Promise<UpdateResult[]> {
      const manifest = readManifest()
      const toUpdate = skillId ? (skillId in manifest.installed ? [skillId] : []) : Object.keys(manifest.installed)

      const results: UpdateResult[] = []

      for (const id of toUpdate) {
        const current = manifest.installed[id]
        if (!current) continue

        try {
          const detail = await api.get(id)
          if (detail.version === current.version) {
            results.push({ skillId: id, updated: false, fromVersion: current.version })
            continue
          }

          const installResult = await this.install(id, detail.version)
          results.push({
            skillId: id,
            updated: installResult.ok,
            fromVersion: current.version,
            toVersion: detail.version,
            error: installResult.error,
          })
        } catch (err) {
          results.push({
            skillId: id,
            updated: false,
            fromVersion: current.version,
            error: err instanceof Error ? err.message : String(err),
          })
        }
      }

      return results
    },

    /** List all installed ClawHub skills. */
    list(): ClawHubInstalledSkill[] {
      const manifest = readManifest()
      return Object.values(manifest.installed)
    },

    /** Uninstall a ClawHub skill. */
    uninstall(skillId: string): boolean {
      const manifest = readManifest()
      if (!(skillId in manifest.installed)) return false

      const entry = manifest.installed[skillId]
      // Use stored location (handles persona-scoped installs), fallback to @clawhub/ dir
      const skillDir = entry.location ?? path.join(CLAWHUB_SKILLS_DIR, skillDirName(skillId))
      if (fs.existsSync(skillDir)) {
        fs.rmSync(skillDir, { recursive: true, force: true })
      }

      delete manifest.installed[skillId]
      writeManifest(manifest)
      return true
    },

    /** Transfer a skill between personas (or to/from shared). */
    transfer(skillId: string, toPersona?: string): { ok: boolean; from?: string; to?: string; error?: string } {
      const manifest = readManifest()
      if (!(skillId in manifest.installed)) {
        return { ok: false, error: `Skill "${skillId}" is not installed via ClawHub` }
      }

      const entry = manifest.installed[skillId]
      const oldDir = entry.location ?? path.join(CLAWHUB_SKILLS_DIR, skillDirName(skillId))
      const newDir = resolveSkillDir(skillId, toPersona)

      if (oldDir === newDir) {
        return { ok: false, error: `Skill is already in ${toPersona ?? "shared"}` }
      }

      if (!fs.existsSync(oldDir)) {
        return { ok: false, error: `Skill directory not found: ${oldDir}` }
      }

      // Move the directory
      ensureDir(path.dirname(newDir))
      fs.renameSync(oldDir, newDir)

      // Update manifest
      const fromLabel = entry.persona ?? "shared"
      entry.location = newDir
      entry.persona = toPersona && VALID_PERSONAS.includes(toPersona as Persona) ? (toPersona as Persona) : undefined
      writeManifest(manifest)

      return { ok: true, from: fromLabel, to: toPersona ?? "shared" }
    },
  }
}

export type ClawHubInstaller = ReturnType<typeof createClawHubInstaller>
