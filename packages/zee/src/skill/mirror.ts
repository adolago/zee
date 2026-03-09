import fs from "node:fs"
import path from "node:path"
import { createHash } from "node:crypto"
import z from "zod"
import { Global } from "@/global"
import { Log } from "@/util/log"

const log = Log.create({ service: "skill-mirror" })

const BUNDLED_MANIFEST_PATH = path.join(Global.Path.source, ".zee", "skill-manifest.json")
const BUNDLED_SKILLS_DIR = path.join(Global.Path.source, ".zee", "skill")
const MIRROR_DESTINATION = path.join(Global.Path.config, "skills")
const MIRROR_STATE_PATH = path.join(Global.Path.config, "skill-mirror-state.json")

function normalizeManifestContext(value?: string): "zee" | undefined {
  return value === "zee" ? "zee" : undefined
}

const SkillManifestEntrySchema = z.object({
  id: z.string(),
  path: z.string(),
  context: z.literal("zee").optional().transform(normalizeManifestContext),
  title: z.string(),
  description: z.string(),
  requires: z.record(z.string(), z.unknown()).optional(),
  curated: z.boolean(),
})

const SkillManifestSchema = z.object({
  version: z.number(),
  generatedAt: z.string(),
  skills: z.array(SkillManifestEntrySchema),
})

const SkillMirrorStateSchema = z.object({
  version: z.number(),
  manifestHash: z.string(),
  mirroredAt: z.string(),
  sourceRoot: z.string(),
  destinationRoot: z.string(),
  skillCount: z.number(),
})

type SkillManifest = z.infer<typeof SkillManifestSchema>
type SkillMirrorState = z.infer<typeof SkillMirrorStateSchema>

export interface SkillMirrorResult {
  status: "synced" | "skipped" | "failed"
  reason?: string
  skillCount: number
  manifestHash?: string
  source?: string
  destination?: string
}

function computeManifestHash(raw: string): string {
  return createHash("sha256").update(raw).digest("hex")
}

function normalizeRelativeSkillPath(value: string): string | undefined {
  const normalized = path.posix.normalize(value.replaceAll("\\", "/")).replace(/^\/+/, "")
  if (!normalized || normalized === "." || normalized.startsWith("../")) return undefined
  return normalized
}

function readMirrorState(): SkillMirrorState | undefined {
  try {
    const raw = fs.readFileSync(MIRROR_STATE_PATH, "utf-8")
    const parsed = SkillMirrorStateSchema.safeParse(JSON.parse(raw))
    if (!parsed.success) return undefined
    return parsed.data
  } catch {
    return undefined
  }
}

function writeMirrorState(state: SkillMirrorState): void {
  fs.mkdirSync(path.dirname(MIRROR_STATE_PATH), { recursive: true })
  fs.writeFileSync(MIRROR_STATE_PATH, JSON.stringify(state, null, 2) + "\n")
}

function isMirrorDrifted(manifest: SkillManifest): boolean {
  for (const entry of manifest.skills) {
    const relativePath = normalizeRelativeSkillPath(entry.path)
    if (!relativePath) continue
    const expectedSkillFile = path.join(MIRROR_DESTINATION, relativePath, "SKILL.md")
    if (!fs.existsSync(expectedSkillFile)) {
      return true
    }
  }
  return false
}

export async function syncBundledSkillsToMachine(options?: {
  force?: boolean
  reason?: string
}): Promise<SkillMirrorResult> {
  if (!fs.existsSync(BUNDLED_MANIFEST_PATH) || !fs.existsSync(BUNDLED_SKILLS_DIR)) {
    return {
      status: "skipped",
      reason: "bundled-skill-manifest-missing",
      skillCount: 0,
      source: BUNDLED_SKILLS_DIR,
      destination: MIRROR_DESTINATION,
    }
  }

  let manifestRaw = ""
  try {
    manifestRaw = await Bun.file(BUNDLED_MANIFEST_PATH).text()
  } catch (error) {
    return {
      status: "failed",
      reason: `unable-to-read-manifest: ${error instanceof Error ? error.message : String(error)}`,
      skillCount: 0,
      source: BUNDLED_SKILLS_DIR,
      destination: MIRROR_DESTINATION,
    }
  }

  let parsedJson: unknown
  try {
    parsedJson = JSON.parse(manifestRaw)
  } catch {
    return {
      status: "failed",
      reason: "invalid-manifest-json",
      skillCount: 0,
      source: BUNDLED_SKILLS_DIR,
      destination: MIRROR_DESTINATION,
    }
  }

  const parsedManifest = SkillManifestSchema.safeParse(parsedJson)
  if (!parsedManifest.success) {
    return {
      status: "failed",
      reason: "invalid-manifest-schema",
      skillCount: 0,
      source: BUNDLED_SKILLS_DIR,
      destination: MIRROR_DESTINATION,
    }
  }

  const manifest = parsedManifest.data
  const manifestHash = computeManifestHash(manifestRaw)
  const state = readMirrorState()
  const drifted = isMirrorDrifted(manifest)

  if (!options?.force && state?.manifestHash === manifestHash && !drifted) {
    return {
      status: "skipped",
      reason: "up-to-date",
      skillCount: manifest.skills.length,
      manifestHash,
      source: BUNDLED_SKILLS_DIR,
      destination: MIRROR_DESTINATION,
    }
  }

  let copied = 0
  try {
    fs.mkdirSync(MIRROR_DESTINATION, { recursive: true })

    for (const entry of manifest.skills) {
      const relativePath = normalizeRelativeSkillPath(entry.path)
      if (!relativePath) continue

      const sourcePath = path.join(BUNDLED_SKILLS_DIR, relativePath)
      const destinationPath = path.join(MIRROR_DESTINATION, relativePath)
      if (!fs.existsSync(sourcePath)) continue

      fs.cpSync(sourcePath, destinationPath, {
        recursive: true,
        dereference: true,
        filter: (candidate) => {
          const base = path.basename(candidate)
          return base !== ".git" && base !== "node_modules" && base !== ".venv" && base !== "venv"
        },
      })
      copied++
    }

    writeMirrorState({
      version: 1,
      manifestHash,
      mirroredAt: new Date().toISOString(),
      sourceRoot: BUNDLED_SKILLS_DIR,
      destinationRoot: MIRROR_DESTINATION,
      skillCount: manifest.skills.length,
    })

    log.info("bundled skills mirrored", {
      reason: options?.reason ?? "manual",
      copied,
      total: manifest.skills.length,
      destination: MIRROR_DESTINATION,
    })

    return {
      status: "synced",
      reason: copied === 0 ? "no-valid-entries" : "mirrored",
      skillCount: manifest.skills.length,
      manifestHash,
      source: BUNDLED_SKILLS_DIR,
      destination: MIRROR_DESTINATION,
    }
  } catch (error) {
    log.error("bundled skill mirror failed", {
      reason: options?.reason ?? "manual",
      error: error instanceof Error ? error.message : String(error),
    })
    return {
      status: "failed",
      reason: error instanceof Error ? error.message : String(error),
      skillCount: manifest.skills.length,
      manifestHash,
      source: BUNDLED_SKILLS_DIR,
      destination: MIRROR_DESTINATION,
    }
  }
}
