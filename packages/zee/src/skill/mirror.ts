import fs from "node:fs"
import path from "node:path"
import { createHash } from "node:crypto"
import z from "zod"
import { Global } from "@/global"
import { Log } from "@/util/log"

const log = Log.create({ service: "skill-mirror" })

function getBundledManifestPath(): string {
  return path.join(Global.Path.source, ".zee", "skill-manifest.json")
}

function getBundledSkillsDir(): string {
  return path.join(Global.Path.source, ".zee", "skill")
}

function getMirrorDestination(): string {
  return path.join(Global.Path.config, "skills")
}

function getMirrorStatePath(): string {
  return path.join(Global.Path.config, "skill-mirror-state.json")
}

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
    const raw = fs.readFileSync(getMirrorStatePath(), "utf-8")
    const parsed = SkillMirrorStateSchema.safeParse(JSON.parse(raw))
    if (!parsed.success) return undefined
    return parsed.data
  } catch {
    return undefined
  }
}

function writeMirrorState(state: SkillMirrorState): void {
  const mirrorStatePath = getMirrorStatePath()
  fs.mkdirSync(path.dirname(mirrorStatePath), { recursive: true })
  fs.writeFileSync(mirrorStatePath, JSON.stringify(state, null, 2) + "\n")
}

function deleteMirrorState(): void {
  try {
    fs.rmSync(getMirrorStatePath(), { force: true })
  } catch {
    // Ignore cleanup errors.
  }
}

function isMirrorDrifted(manifest: SkillManifest): boolean {
  const mirrorDestination = getMirrorDestination()
  for (const entry of manifest.skills) {
    const relativePath = normalizeRelativeSkillPath(entry.path)
    if (!relativePath) continue
    const expectedSkillFile = path.join(mirrorDestination, relativePath, "SKILL.md")
    if (!fs.existsSync(expectedSkillFile)) {
      return true
    }
  }
  return false
}

function findSourceCheckoutSkillRoot(startDir: string = process.cwd()): string | undefined {
  let current = path.resolve(startDir)
  for (;;) {
    const candidate = path.join(current, ".agents", "skills", "@zee")
    if (fs.existsSync(candidate)) return candidate
    const parent = path.dirname(current)
    if (parent === current) return undefined
    current = parent
  }
}

function removeEmptyParents(startPath: string, stopPath: string): void {
  let current = path.resolve(startPath)
  const root = path.resolve(stopPath)
  while (current.startsWith(root) && current !== root) {
    try {
      if (fs.readdirSync(current).length > 0) return
      fs.rmdirSync(current)
    } catch {
      return
    }
    current = path.dirname(current)
  }
}

function pruneMirroredSkills(manifest: SkillManifest): number {
  const mirrorDestination = getMirrorDestination()
  let removed = 0
  for (const entry of manifest.skills) {
    const relativePath = normalizeRelativeSkillPath(entry.path)
    if (!relativePath) continue
    const destinationPath = path.join(mirrorDestination, relativePath)
    if (!fs.existsSync(destinationPath)) continue
    fs.rmSync(destinationPath, { recursive: true, force: true })
    removeEmptyParents(path.dirname(destinationPath), mirrorDestination)
    removed++
  }

  try {
    if (fs.existsSync(mirrorDestination) && fs.readdirSync(mirrorDestination).length === 0) {
      fs.rmdirSync(mirrorDestination)
    }
  } catch {
    // Ignore cleanup errors.
  }

  deleteMirrorState()
  return removed
}

export async function syncBundledSkillsToMachine(options?: {
  force?: boolean
  reason?: string
}): Promise<SkillMirrorResult> {
  const bundledManifestPath = getBundledManifestPath()
  const bundledSkillsDir = getBundledSkillsDir()
  const mirrorDestination = getMirrorDestination()

  if (!fs.existsSync(bundledManifestPath) || !fs.existsSync(bundledSkillsDir)) {
    return {
      status: "skipped",
      reason: "bundled-skill-manifest-missing",
      skillCount: 0,
      source: bundledSkillsDir,
      destination: mirrorDestination,
    }
  }

  let manifestRaw = ""
  try {
    manifestRaw = await Bun.file(bundledManifestPath).text()
  } catch (error) {
    return {
      status: "failed",
      reason: `unable-to-read-manifest: ${error instanceof Error ? error.message : String(error)}`,
      skillCount: 0,
      source: bundledSkillsDir,
      destination: mirrorDestination,
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
      source: bundledSkillsDir,
      destination: mirrorDestination,
    }
  }

  const parsedManifest = SkillManifestSchema.safeParse(parsedJson)
  if (!parsedManifest.success) {
    return {
      status: "failed",
      reason: "invalid-manifest-schema",
      skillCount: 0,
      source: bundledSkillsDir,
      destination: mirrorDestination,
    }
  }

  const manifest = parsedManifest.data
  const manifestHash = computeManifestHash(manifestRaw)
  const state = readMirrorState()
  const drifted = isMirrorDrifted(manifest)
  const sourceCheckoutSkills = findSourceCheckoutSkillRoot()

  if (sourceCheckoutSkills) {
    const removed = pruneMirroredSkills(manifest)
    if (removed > 0) {
      log.info("skipped bundled skill mirror because source checkout skills are available", {
        sourceCheckoutSkills,
        removed,
        destination: mirrorDestination,
      })
    }

    return {
      status: "skipped",
      reason: "source-checkout-skills-present",
      skillCount: manifest.skills.length,
      manifestHash,
      source: bundledSkillsDir,
      destination: mirrorDestination,
    }
  }

  if (!options?.force && state?.manifestHash === manifestHash && !drifted) {
    return {
      status: "skipped",
      reason: "up-to-date",
      skillCount: manifest.skills.length,
      manifestHash,
      source: bundledSkillsDir,
      destination: mirrorDestination,
    }
  }

  let copied = 0
  try {
    fs.mkdirSync(mirrorDestination, { recursive: true })

    for (const entry of manifest.skills) {
      const relativePath = normalizeRelativeSkillPath(entry.path)
      if (!relativePath) continue

      const sourcePath = path.join(bundledSkillsDir, relativePath)
      const destinationPath = path.join(mirrorDestination, relativePath)
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
      sourceRoot: bundledSkillsDir,
      destinationRoot: mirrorDestination,
      skillCount: manifest.skills.length,
    })

    log.info("bundled skills mirrored", {
      reason: options?.reason ?? "manual",
      copied,
      total: manifest.skills.length,
      destination: mirrorDestination,
    })

    return {
      status: "synced",
      reason: copied === 0 ? "no-valid-entries" : "mirrored",
      skillCount: manifest.skills.length,
      manifestHash,
      source: bundledSkillsDir,
      destination: mirrorDestination,
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
      source: bundledSkillsDir,
      destination: mirrorDestination,
    }
  }
}
