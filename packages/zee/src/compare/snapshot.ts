import fs from "node:fs"
import path from "node:path"
import { readableStreamToText } from "bun"
import { Installation } from "../installation"

export type RuntimeMode = "source" | "binary"

export type UpstreamPin = {
  remote: string
  branch: string
  url?: string
  head?: string
  error?: string
}

export type SkillsSnapshot = {
  total: number
  namespaces: Record<string, number>
}

export type PiMonoSnapshot = {
  installedPiCodingAgentVersion?: string
  latestTag?: string
  latestVersion?: string
  head?: string
}

export type CompareSnapshot = {
  generatedAt: string
  sourceRoot?: string
  zee: {
    version: string
    channel: string
    runtimeMode: RuntimeMode
    gitSha?: string
  }
  upstream: {
    opencode?: UpstreamPin
    openclaw?: UpstreamPin
    pimono?: UpstreamPin
  }
  pimono: PiMonoSnapshot
  skills?: SkillsSnapshot
  warnings: string[]
}

export type ExecResult = {
  exitCode: number
  stdout: string
  stderr: string
}

export type ExecRunner = (cmd: string[], opts?: { cwd?: string }) => Promise<ExecResult>

export type SnapshotOptions = {
  fetch?: boolean
  rootDir?: string
  now?: Date
  includeSkills?: boolean
  exec?: ExecRunner
}

function findSourceRoot(startDir: string): string | undefined {
  let current = path.resolve(startDir)
  for (;;) {
    const packageRoot = path.join(current, "packages", "zee")
    const zeeDir = path.join(current, ".zee")
    const vendorPersonas = path.join(current, "vendor", "personas")
    if (fs.existsSync(packageRoot) || fs.existsSync(zeeDir) || fs.existsSync(vendorPersonas)) return current
    const parent = path.dirname(current)
    if (parent === current) return undefined
    current = parent
  }
}

function resolveSourceRoot(): string | undefined {
  const envSource = (process.env.ZEE_SOURCE || process.env.ZEE_ROOT)?.trim()
  if (envSource) return envSource

  const starts: string[] = [process.cwd()]
  const argvPath = process.argv[1]
  if (argvPath) starts.push(path.dirname(path.resolve(argvPath)))
  starts.push(path.dirname(process.execPath))

  for (const start of starts) {
    const root = findSourceRoot(start)
    if (root) return root
  }
  return undefined
}

export const defaultExec: ExecRunner = async (cmd, opts) => {
  const proc = Bun.spawn(cmd, {
    cwd: opts?.cwd,
    stdout: "pipe",
    stderr: "pipe",
    env: process.env,
  })

  const exitCode = await proc.exited
  const stdout = proc.stdout ? (typeof proc.stdout === "number" ? "" : await readableStreamToText(proc.stdout)) : ""
  const stderr = proc.stderr ? (typeof proc.stderr === "number" ? "" : await readableStreamToText(proc.stderr)) : ""

  return { exitCode, stdout, stderr }
}

async function git(exec: ExecRunner, args: string[], cwd: string): Promise<ExecResult> {
  return exec(["git", ...args], { cwd })
}

async function gitTrim(exec: ExecRunner, args: string[], cwd: string): Promise<string | undefined> {
  const result = await git(exec, args, cwd)
  if (result.exitCode !== 0) return undefined
  const out = result.stdout.trim()
  return out ? out : undefined
}

async function resolveRemoteUrl(exec: ExecRunner, remote: string, cwd: string): Promise<string | undefined> {
  return gitTrim(exec, ["remote", "get-url", remote], cwd)
}

async function resolveRef(exec: ExecRunner, ref: string, cwd: string): Promise<string | undefined> {
  return gitTrim(exec, ["rev-parse", "--verify", ref], cwd)
}

async function fetchRemote(exec: ExecRunner, remote: string, cwd: string): Promise<{ ok: boolean; error?: string }> {
  const result = await git(exec, ["fetch", remote, "--quiet"], cwd)
  if (result.exitCode === 0) return { ok: true }
  const msg = (result.stderr || result.stdout).trim()
  return { ok: false, error: msg || `git fetch ${remote} failed` }
}

function parseInstalledPiCodingAgentVersion(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined
  // Match versions like "0.52.9" or "^0.52.9"; strip non-numeric prefix.
  const match = raw.match(/(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)$/)
  return match?.[1]
}

async function readPiMonoInstalledVersion(sourceRoot: string): Promise<string | undefined> {
  const pkgPath = path.join(sourceRoot, "packages", "zee", "Swabble", "package.json")
  if (!fs.existsSync(pkgPath)) return undefined
  try {
    const parsed = JSON.parse(fs.readFileSync(pkgPath, "utf-8")) as {
      dependencies?: Record<string, string>
    }
    return parseInstalledPiCodingAgentVersion(parsed.dependencies?.["@mariozechner/pi-coding-agent"])
  } catch {
    return undefined
  }
}

async function resolveLatestPiMonoTag(exec: ExecRunner, cwd: string, warnings: string[]): Promise<string | undefined> {
  const tags = await gitTrim(exec, ["tag", "-l", "v0.*", "--sort=-v:refname"], cwd)
  if (!tags) return undefined

  const lines = tags
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)

  // Find the newest v0.* tag that is reachable from pimono/main (when remotes/tags are fetched).
  for (const tag of lines) {
    const r = await git(exec, ["merge-base", "--is-ancestor", tag, "pimono/main"], cwd)
    if (r.exitCode === 0) return tag
  }

  // Fallback: pick the newest v0.* tag by version sort, even if remote reachability cannot be verified.
  if (lines.length > 0) {
    warnings.push("Unable to verify pi-mono tag reachability from pimono/main; using newest local v0.* tag.")
    return lines[0]
  }

  return undefined
}

async function countSkills(sourceRoot: string): Promise<SkillsSnapshot | undefined> {
  const skillsRoot = path.join(sourceRoot, ".agents", "skills")
  if (!fs.existsSync(skillsRoot)) return undefined

  const glob = new Bun.Glob(".agents/skills/**/SKILL.md")
  let total = 0
  const namespaces: Record<string, number> = {}

  for await (const match of glob.scan({
    cwd: sourceRoot,
    absolute: false,
    onlyFiles: true,
    followSymlinks: true,
    dot: true,
  })) {
    total++
    const parts = String(match).split(/[\\/]/).filter(Boolean)
    const idx = parts.findIndex((p, i) => p === ".agents" && parts[i + 1] === "skills")
    const ns = idx >= 0 ? parts[idx + 2] : undefined
    if (ns) namespaces[ns] = (namespaces[ns] || 0) + 1
  }

  return { total, namespaces }
}

export async function collectSnapshot(options: SnapshotOptions = {}): Promise<CompareSnapshot> {
  const now = options.now ?? new Date()
  const warnings: string[] = []

  const sourceRoot = options.rootDir ?? resolveSourceRoot()
  const cwd = sourceRoot ?? process.cwd()
  const exec = options.exec ?? defaultExec

  const zee = {
    version: Installation.VERSION,
    channel: Installation.CHANNEL,
    runtimeMode: Installation.runtimeMode() as RuntimeMode,
    gitSha: undefined as string | undefined,
  }

  // Best-effort local git SHA.
  const head = await resolveRef(exec, "HEAD", cwd)
  if (head) zee.gitSha = head

  const upstream: CompareSnapshot["upstream"] = {}

  const upstreams: Array<{ key: keyof CompareSnapshot["upstream"]; remote: string; branch: string }> = [
    { key: "opencode", remote: "opencode", branch: "dev" },
    { key: "openclaw", remote: "openclaw", branch: "main" },
    { key: "pimono", remote: "pimono", branch: "main" },
  ]

  // Optionally fetch remotes (best-effort; never hard-fail the compare output).
  for (const u of upstreams) {
    const url = await resolveRemoteUrl(exec, u.remote, cwd)
    if (!url) continue
    if (!options.fetch) continue
    const fetched = await fetchRemote(exec, u.remote, cwd)
    if (!fetched.ok) warnings.push(`Fetch failed for remote '${u.remote}': ${fetched.error ?? "unknown error"}`)
  }

  // Resolve upstream pins.
  for (const u of upstreams) {
    const url = await resolveRemoteUrl(exec, u.remote, cwd)
    if (!url) {
      warnings.push(`Git remote '${u.remote}' not configured (or not readable).`)
      continue
    }
    const ref = `${u.remote}/${u.branch}`
    const resolved = await resolveRef(exec, ref, cwd)
    if (!resolved) {
      warnings.push(`Git ref '${ref}' not available. Run: git fetch ${u.remote}`)
      upstream[u.key] = { remote: u.remote, branch: u.branch, url, error: "ref-not-found" }
      continue
    }
    upstream[u.key] = { remote: u.remote, branch: u.branch, url, head: resolved }
  }

  const pimonoHead = upstream.pimono?.head
  const installedPiCodingAgentVersion = sourceRoot ? await readPiMonoInstalledVersion(sourceRoot) : undefined
  const latestTag = await resolveLatestPiMonoTag(exec, cwd, warnings)

  const pimono: PiMonoSnapshot = {
    head: pimonoHead,
    installedPiCodingAgentVersion,
    latestTag,
    latestVersion: latestTag?.startsWith("v") ? latestTag.slice(1) : latestTag,
  }

  const skills = options.includeSkills === false || !sourceRoot ? undefined : await countSkills(sourceRoot)

  return {
    generatedAt: now.toISOString(),
    sourceRoot: sourceRoot,
    zee,
    upstream,
    pimono,
    skills,
    warnings,
  }
}
