import path from "node:path"
import fs from "node:fs/promises"
import { BunProc } from "@/bun"
import { Global } from "@/global"
import { Log } from "@/util/log"
import { Filesystem } from "@/util/filesystem"
import { loadPackageMetadata, type ResourceKind, ResourceKindSchema, validateManifestPaths, type ZeeManifest } from "./manifest"

const log = Log.create({ service: "package-manager" })

export type PackageScope = "global" | "local"

export type InstalledPackage = {
  source: string
  packageName: string
  version?: string
  scope: PackageScope
  runtimeRoot: string
  projectRoot?: string
  installedAt: number
  manifest: ZeeManifest
  linkedPaths: string[]
}

type PackageState = {
  installs: InstalledPackage[]
}

function stateFilepath() {
  return path.join(Global.Path.state, "packages.json")
}

function runtimeRootForScope(scope: PackageScope, projectRoot?: string): string {
  if (scope === "local") {
    if (!projectRoot) throw new Error("local scope requires projectRoot")
    return path.join(projectRoot, ".zee", "packages")
  }
  return path.join(Global.Path.data, "packages")
}

function resourcesRootForScope(scope: PackageScope, projectRoot?: string): string {
  if (scope === "local") {
    if (!projectRoot) throw new Error("local scope requires projectRoot")
    return path.join(projectRoot, ".zee")
  }
  return Global.Path.config
}

function safeSegment(input: string): string {
  return input.replace(/[^a-zA-Z0-9._-]/g, "_")
}

async function readState(): Promise<PackageState> {
  const txt = await fs.readFile(stateFilepath(), "utf-8").catch(() => "")
  if (!txt) return { installs: [] }
  try {
    const parsed = JSON.parse(txt) as PackageState
    if (!Array.isArray(parsed.installs)) return { installs: [] }
    return parsed
  } catch {
    return { installs: [] }
  }
}

async function writeState(state: PackageState) {
  const filepath = stateFilepath()
  await fs.mkdir(path.dirname(filepath), { recursive: true })
  await Bun.write(filepath, JSON.stringify(state, null, 2))
}

async function ensureRuntimeRoot(runtimeRoot: string) {
  await fs.mkdir(runtimeRoot, { recursive: true })
  const pkgJson = path.join(runtimeRoot, "package.json")
  const exists = await Filesystem.exists(pkgJson)
  if (!exists) {
    await Bun.write(
      pkgJson,
      JSON.stringify(
        {
          name: "zee-package-runtime",
          private: true,
          type: "module",
          dependencies: {},
        },
        null,
        2,
      ),
    )
  }
}

async function readDependencies(runtimeRoot: string): Promise<Record<string, string>> {
  const pkgJson = path.join(runtimeRoot, "package.json")
  const txt = await fs.readFile(pkgJson, "utf-8")
  const parsed = JSON.parse(txt) as { dependencies?: Record<string, string> }
  return parsed.dependencies ?? {}
}

function changedPackages(before: Record<string, string>, after: Record<string, string>): string[] {
  const out = new Set<string>()
  for (const [name, version] of Object.entries(after)) {
    if (before[name] !== version) out.add(name)
  }
  return [...out]
}

async function linkResourcePaths(input: {
  packageName: string
  packageDir: string
  manifest: ZeeManifest
  scope: PackageScope
  projectRoot?: string
}) {
  const resourcesRoot = resourcesRootForScope(input.scope, input.projectRoot)
  const pkgSegment = safeSegment(input.packageName)
  const linkedPaths: string[] = []

  const ensureCleanDir = async (dir: string) => {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {})
    await fs.mkdir(dir, { recursive: true })
  }

  for (const kind of ResourceKindSchema.options) {
    const entries = input.manifest[kind]
    if (!entries.length) continue

    const targetRoot = path.join(resourcesRoot, kind, pkgSegment)
    await ensureCleanDir(targetRoot)

    for (const rel of entries) {
      const sourcePath = path.resolve(input.packageDir, rel)
      const sourceExists = await Filesystem.exists(sourcePath)
      if (!sourceExists) {
        throw new Error(`Missing ${kind} path "${rel}" in package ${input.packageName}`)
      }

      const basename = path.basename(rel)
      const targetPath = path.join(targetRoot, basename)
      await fs.rm(targetPath, { recursive: true, force: true }).catch(() => {})
      await fs.symlink(sourcePath, targetPath)
      linkedPaths.push(targetPath)
    }
  }

  return linkedPaths
}

function dedupeInstalls(installs: InstalledPackage[]): InstalledPackage[] {
  const byKey = new Map<string, InstalledPackage>()
  for (const item of installs) {
    const key = `${item.scope}:${item.projectRoot ?? "-"}:${item.packageName}`
    byKey.set(key, item)
  }
  return [...byKey.values()]
}

export async function installSource(input: {
  source: string
  scope: PackageScope
  projectRoot?: string
}): Promise<InstalledPackage[]> {
  const runtimeRoot = runtimeRootForScope(input.scope, input.projectRoot)
  await ensureRuntimeRoot(runtimeRoot)
  const depsBefore = await readDependencies(runtimeRoot)

  await BunProc.run(["add", "--force", "--exact", "--cwd", runtimeRoot, input.source], {
    cwd: runtimeRoot,
  })

  const depsAfter = await readDependencies(runtimeRoot)
  const changed = changedPackages(depsBefore, depsAfter)
  if (!changed.length) {
    return []
  }

  const state = await readState()
  const now = Date.now()
  const installed: InstalledPackage[] = []

  for (const packageName of changed) {
    const packageDir = path.join(runtimeRoot, "node_modules", packageName)
    const meta = await loadPackageMetadata(packageDir)
    const manifestErrors = validateManifestPaths(meta)
    if (manifestErrors.length) {
      throw new Error(`Invalid zee manifest in ${packageName}: ${manifestErrors.join("; ")}`)
    }

    const linkedPaths = await linkResourcePaths({
      packageName,
      packageDir,
      manifest: meta.manifest,
      scope: input.scope,
      projectRoot: input.projectRoot,
    })

    installed.push({
      source: input.source,
      packageName,
      version: depsAfter[packageName],
      scope: input.scope,
      runtimeRoot,
      projectRoot: input.projectRoot,
      installedAt: now,
      manifest: meta.manifest,
      linkedPaths,
    })
  }

  const filtered = state.installs.filter((entry) => {
    return !installed.some((next) => {
      return (
        next.scope === entry.scope &&
        next.packageName === entry.packageName &&
        (next.projectRoot ?? "") === (entry.projectRoot ?? "")
      )
    })
  })

  state.installs = dedupeInstalls([...filtered, ...installed])
  await writeState(state)
  return installed
}

export async function removePackage(input: {
  identifier: string
  scope?: PackageScope
  projectRoot?: string
}): Promise<InstalledPackage[]> {
  const state = await readState()
  const matches = state.installs.filter((entry) => {
    if (input.scope && entry.scope !== input.scope) return false
    if (entry.packageName !== input.identifier && entry.source !== input.identifier) return false
    if (entry.scope === "local") {
      return (entry.projectRoot ?? "") === (input.projectRoot ?? "")
    }
    return true
  })

  for (const entry of matches) {
    await BunProc.run(["remove", "--cwd", entry.runtimeRoot, entry.packageName], {
      cwd: entry.runtimeRoot,
    }).catch(() => {})
    for (const linkedPath of entry.linkedPaths) {
      await fs.rm(linkedPath, { recursive: true, force: true }).catch(() => {})
    }
    const resourcesRoot = resourcesRootForScope(entry.scope, entry.projectRoot)
    for (const kind of ResourceKindSchema.options) {
      const dir = path.join(resourcesRoot, kind, safeSegment(entry.packageName))
      await fs.rm(dir, { recursive: true, force: true }).catch(() => {})
    }
  }

  state.installs = state.installs.filter((entry) => !matches.includes(entry))
  await writeState(state)
  return matches
}

export async function listInstalled(input?: { scope?: PackageScope; projectRoot?: string }): Promise<InstalledPackage[]> {
  const state = await readState()
  return state.installs
    .filter((entry) => {
      if (input?.scope && entry.scope !== input.scope) return false
      if (entry.scope === "local" && input?.projectRoot) {
        return (entry.projectRoot ?? "") === input.projectRoot
      }
      return true
    })
    .sort((a, b) => b.installedAt - a.installedAt)
}

export async function updatePackages(input?: {
  identifier?: string
  scope?: PackageScope
  projectRoot?: string
}) {
  const installs = await listInstalled({
    scope: input?.scope,
    projectRoot: input?.projectRoot,
  })
  const targets = input?.identifier
    ? installs.filter((entry) => entry.packageName === input.identifier || entry.source === input.identifier)
    : installs

  const updated: InstalledPackage[] = []
  const seen = new Set<string>()
  for (const item of targets) {
    const key = `${item.scope}:${item.projectRoot ?? "-"}:${item.source}`
    if (seen.has(key)) continue
    seen.add(key)
    const result = await installSource({
      source: item.source,
      scope: item.scope,
      projectRoot: item.projectRoot,
    })
    updated.push(...result)
  }
  return updated
}

export async function inspectPackageConfig(input?: { scope?: PackageScope; projectRoot?: string }) {
  const scope = input?.scope ?? "global"
  const runtimeRoot = runtimeRootForScope(scope, input?.projectRoot)
  const resourcesRoot = resourcesRootForScope(scope, input?.projectRoot)
  const installs = await listInstalled({ scope, projectRoot: input?.projectRoot })
  return {
    scope,
    runtimeRoot,
    resourcesRoot,
    stateFile: stateFilepath(),
    installs,
  }
}

export function formatManifestKinds(manifest: ZeeManifest) {
  const out: Partial<Record<ResourceKind, number>> = {}
  for (const kind of ResourceKindSchema.options) {
    if (manifest[kind].length) out[kind] = manifest[kind].length
  }
  return out
}

log.info("package manager loaded")
