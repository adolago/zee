import { $ } from "bun"
import path from "path"
import { satisfies } from "semver"

// When in src/pkg/script, go up 5 levels to reach the monorepo root
// src/pkg/script -> src/pkg -> src -> agent-core -> packages -> agent-core (root)
const rootPkgPath = path.resolve(import.meta.dir, "../../../../../package.json")
const rootPkg = await Bun.file(rootPkgPath).json()
const expectedBunVersion = rootPkg.packageManager?.split("@")[1]

// Read version from agent-core package.json as fallback (go up 3 levels to packages/agent-core)
const agentCorePkgPath = path.resolve(import.meta.dir, "../../../package.json")
const agentCorePkg = await Bun.file(agentCorePkgPath).json().catch(() => ({}))
const packageJsonVersion = agentCorePkg.version as string | undefined

if (!expectedBunVersion) {
  throw new Error("packageManager field not found in root package.json")
}

const expectedBunVersionRange = `^${expectedBunVersion}`
if (!satisfies(process.versions.bun, expectedBunVersionRange)) {
  throw new Error(`This script requires bun@${expectedBunVersionRange}, but you are using bun@${process.versions.bun}`)
}

const env = {
  AGENT_CORE_CHANNEL: process.env["AGENT_CORE_CHANNEL"],
  AGENT_CORE_BUMP: process.env["AGENT_CORE_BUMP"],
  AGENT_CORE_VERSION: process.env["AGENT_CORE_VERSION"],
  AGENT_CORE_NPM_PACKAGE: process.env["AGENT_CORE_NPM_PACKAGE"],
}
const DEFAULT_NPM_PACKAGE = "@adolago/agent-core"
const registry = "https://registry.npmjs.org"
const npmPackage = env.AGENT_CORE_NPM_PACKAGE || DEFAULT_NPM_PACKAGE
const encodedPackage = encodeURIComponent(npmPackage)
const CHANNEL = await (async () => {
  if (env.AGENT_CORE_CHANNEL) return env.AGENT_CORE_CHANNEL
  if (env.AGENT_CORE_BUMP) return "latest"
  const version = env.AGENT_CORE_VERSION
  if (version && !version.startsWith("0.0.0-")) return "latest"
  return await $`git branch --show-current`.text().then((x) => x.trim())
})()
const IS_PREVIEW = CHANNEL !== "latest"

const VERSION = await (async () => {
  if (env.AGENT_CORE_VERSION) return env.AGENT_CORE_VERSION
  if (env.AGENT_CORE_VERSION) return env.AGENT_CORE_VERSION
  // For dev/preview builds, generate nightly version (increments daily)
  if (IS_PREVIEW) {
    const [major, minor] = (packageJsonVersion?.replace(/-.*$/, "") || "0.2.0").split(".").map(Number)
    // Nightly number = days since Jan 30, 2026 (so Jan 31 = 1)
    const now = new Date()
    const startYear = 2026, startMonth = 0, startDay = 30 // Jan 30, 2026
    const startDate = new Date(startYear, startMonth, startDay)
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const nightly = Math.round((today.getTime() - startDate.getTime()) / (24 * 60 * 60 * 1000))
    return `${major}.${minor}.${nightly}-nightly`
  }
  // Use package.json version if available (for release builds)
  if (packageJsonVersion && packageJsonVersion !== "0.0.0") return packageJsonVersion
  const version = await fetch(`${registry}/${encodedPackage}/latest`)
    .then((res) => {
      if (!res.ok) throw new Error(res.statusText)
      return res.json()
    })
    .then((data: any) => data.version)
  const [major, minor, patch] = version.split(".").map((x: string) => Number(x) || 0)
  const t = (env.AGENT_CORE_BUMP || env.AGENT_CORE_BUMP)?.toLowerCase()
  if (t === "major") return `${major + 1}.0.0`
  if (t === "minor") return `${major}.${minor + 1}.0`
  return `${major}.${minor}.${patch + 1}`
})()

export const Script = {
  get channel() {
    return CHANNEL
  },
  get version() {
    return VERSION
  },
  get preview() {
    return IS_PREVIEW
  },
}
console.log(`agent-core script`, JSON.stringify(Script, null, 2))
