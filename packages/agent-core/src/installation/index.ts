import { BusEvent } from "@/bus/bus-event"
import path from "path"
import fs from "node:fs"
import { $ } from "bun"
import z from "zod"
import { NamedError } from "@agent-core/util/error"
import { Log } from "../util/log"
import { iife } from "@/util/iife"
import { Flag } from "../flag/flag"
import { fileURLToPath } from "url"

declare global {
  const AGENT_CORE_VERSION: string
  const AGENT_CORE_CHANNEL: string
  const AGENT_CORE_VERSION: string
  const AGENT_CORE_CHANNEL: string
}

export namespace Installation {
  const log = Log.create({ service: "installation" })
  const DEFAULT_NPM_PACKAGE = "@adolago/agent-core"
  const PACKAGE_JSON_PATH = (() => {
    try {
      const here = path.dirname(fileURLToPath(import.meta.url))
      return path.resolve(here, "..", "..", "package.json")
    } catch {
      return undefined
    }
  })()
  const PACKAGE_VERSION = (() => {
    if (!PACKAGE_JSON_PATH) return undefined
    try {
      const raw = fs.readFileSync(PACKAGE_JSON_PATH, "utf-8")
      const parsed = JSON.parse(raw) as { version?: string }
      return typeof parsed.version === "string" ? parsed.version : undefined
    } catch {
      return undefined
    }
  })()
  export const NPM_PACKAGES = Array.from(
    new Set(
      [process.env.AGENT_CORE_NPM_PACKAGE?.trim(), DEFAULT_NPM_PACKAGE, "agent-core-ai"].filter(Boolean),
    ),
  ) as string[]

  function preferredNpmPackage() {
    return NPM_PACKAGES[0] ?? DEFAULT_NPM_PACKAGE
  }

  async function listGlobalPackages(manager: "npm" | "pnpm" | "bun" | "yarn") {
    switch (manager) {
      case "npm":
        return $`npm list -g --depth=0`.throws(false).quiet().text()
      case "pnpm":
        return $`pnpm list -g --depth=0`.throws(false).quiet().text()
      case "bun":
        return $`bun pm ls -g`.throws(false).quiet().text()
      case "yarn":
        return $`yarn global list`.throws(false).quiet().text()
    }
  }

  export async function resolveNpmPackage(method: Method) {
    if (method !== "npm" && method !== "pnpm" && method !== "bun" && method !== "yarn") {
      return preferredNpmPackage()
    }
    const output = await listGlobalPackages(method)
    for (const pkg of NPM_PACKAGES) {
      if (output.includes(pkg)) return pkg
    }
    return preferredNpmPackage()
  }

  export type Method = Awaited<ReturnType<typeof method>>

  export const Event = {
    Updated: BusEvent.define(
      "installation.updated",
      z.object({
        version: z.string(),
      }),
    ),
    UpdateAvailable: BusEvent.define(
      "installation.update-available",
      z.object({
        version: z.string(),
      }),
    ),
  }

  export const Info = z
    .object({
      version: z.string(),
      latest: z.string(),
    })
    .meta({
      ref: "InstallationInfo",
    })
  export type Info = z.infer<typeof Info>

  export async function info() {
    return {
      version: VERSION,
      latest: await latest(),
    }
  }

  export function isPreview() {
    return CHANNEL !== "latest"
  }

  export function isLocal() {
    return CHANNEL === "local"
  }

  export type RuntimeMode = "source" | "binary"
  export type RuntimeInfo = {
    version: string
    channel: string
    mode: RuntimeMode
    execPath: string
    entry?: string
    pid: number
    packageVersion?: string
    execModifiedAt?: string
    execModifiedTs?: number
    entryModifiedAt?: string
    entryModifiedTs?: number
  }

  export function runtimeMode(execPath: string = process.execPath): RuntimeMode {
    const exec = path.basename(execPath).toLowerCase()
    if (exec === "bun" || exec === "node" || exec === "deno") return "source"
    return "binary"
  }

  export function isSourceRuntime() {
    return runtimeMode() === "source"
  }

  function resolveEntryPath(): string | undefined {
    const candidate = process.argv[1]
    if (!candidate) return undefined
    const resolved = path.isAbsolute(candidate) ? candidate : path.resolve(process.cwd(), candidate)
    if (!fs.existsSync(resolved)) return undefined
    return resolved
  }

  function statPath(target?: string): { modifiedAt: string; modifiedTs: number } | undefined {
    if (!target) return undefined
    try {
      const stat = fs.statSync(target)
      return { modifiedAt: stat.mtime.toISOString(), modifiedTs: stat.mtime.getTime() }
    } catch {
      return undefined
    }
  }

  export async function method() {
    if (process.execPath.includes(path.join(".agent-core", "bin"))) return "curl"
    if (process.execPath.includes(path.join(".local", "bin"))) return "curl"
    const exec = process.execPath.toLowerCase()

    const checks = [
      {
        name: "npm" as const,
        command: () => $`npm list -g --depth=0`.throws(false).quiet().text(),
      },
      {
        name: "yarn" as const,
        command: () => $`yarn global list`.throws(false).quiet().text(),
      },
      {
        name: "pnpm" as const,
        command: () => $`pnpm list -g --depth=0`.throws(false).quiet().text(),
      },
      {
        name: "bun" as const,
        command: () => $`bun pm ls -g`.throws(false).quiet().text(),
      },
      {
        name: "brew" as const,
        command: () => $`brew list --formula`.throws(false).quiet().text(),
      },
      ...(process.platform === "win32"
        ? [
            {
              name: "choco" as const,
              command: () => $`choco list --local-only`.throws(false).quiet().text(),
            },
            {
              name: "scoop" as const,
              command: () => $`scoop list`.throws(false).quiet().text(),
            },
          ]
        : []),
    ]

    checks.sort((a, b) => {
      const aMatches = exec.includes(a.name)
      const bMatches = exec.includes(b.name)
      if (aMatches && !bMatches) return -1
      if (!aMatches && bMatches) return 1
      return 0
    })

    const npmPackages = NPM_PACKAGES
    const brewPackages = ["agent-core", "adolago/tap/agent-core"]
    const winPackages = ["agent-core"]

    for (const check of checks) {
      const output = await check.command()
      if (check.name === "brew") {
        if (brewPackages.some((pkg) => output.includes(pkg))) return check.name
        continue
      }
      if (check.name === "choco" || check.name === "scoop") {
        if (winPackages.some((pkg) => output.includes(pkg))) return check.name
        continue
      }
      if (npmPackages.some((pkg) => output.includes(pkg))) return check.name
    }

    return "unknown"
  }

  export const UpgradeFailedError = NamedError.create(
    "UpgradeFailedError",
    z.object({
      stderr: z.string(),
    }),
  )

  async function getBrewFormula() {
    const tapFormula = await $`brew list --formula adolago/tap/agent-core`.throws(false).quiet().text()
    if (tapFormula.includes("agent-core")) return "adolago/tap/agent-core"
    const coreFormula = await $`brew list --formula agent-core`.throws(false).quiet().text()
    if (coreFormula.includes("agent-core")) return "agent-core"
    return "agent-core"
  }

  export async function upgrade(method: Method, target: string) {
    let cmd
    switch (method) {
      case "curl":
        cmd = $`curl -fsSL https://raw.githubusercontent.com/adolago/agent-core/dev/install | bash`.env({
          ...process.env,
          VERSION: target,
        })
        break
      case "npm":
        cmd = $`npm install -g ${(await resolveNpmPackage(method))}@${target}`
        break
      case "pnpm":
        cmd = $`pnpm install -g ${(await resolveNpmPackage(method))}@${target}`
        break
      case "bun":
        cmd = $`bun install -g ${(await resolveNpmPackage(method))}@${target}`
        break
      case "brew": {
        const formula = await getBrewFormula()
        cmd = $`brew upgrade ${formula}`.env({
          HOMEBREW_NO_AUTO_UPDATE: "1",
          ...process.env,
        })
        break
      }
      case "choco":
        cmd = $`choco upgrade agent-core --version ${target} -y`
        break
      case "scoop":
        cmd = $`scoop update agent-core`
        break
      default:
        throw new Error(`Unknown method: ${method}`)
    }
    const result = await cmd.quiet().throws(false)
    if (result.exitCode !== 0) {
      const stderr = result.stderr.toString("utf8")
      throw new UpgradeFailedError({
        stderr: stderr,
      })
    }
    log.info("upgraded", {
      method,
      target,
      stdout: result.stdout.toString(),
      stderr: result.stderr.toString(),
    })
    await $`${process.execPath} --version`.nothrow().quiet().text()
  }

  // Version set at build time; fallback uses package.json or "dev".
  export const VERSION =
    typeof AGENT_CORE_VERSION === "string"
      ? AGENT_CORE_VERSION
      : typeof AGENT_CORE_VERSION === "string"
        ? AGENT_CORE_VERSION
        : PACKAGE_VERSION ?? "dev"
  export const CHANNEL =
    typeof AGENT_CORE_CHANNEL === "string"
      ? AGENT_CORE_CHANNEL
      : typeof AGENT_CORE_CHANNEL === "string"
        ? AGENT_CORE_CHANNEL
        : "local"
  export const USER_AGENT = `agent-core/${CHANNEL}/${VERSION}/${Flag.AGENT_CORE_CLIENT}`

  export function runtimeInfo(): RuntimeInfo {
    const execPath = process.execPath
    const entry = resolveEntryPath()
    const execStat = statPath(execPath)
    const entryStat = statPath(entry)
    return {
      version: VERSION,
      channel: CHANNEL,
      mode: runtimeMode(execPath),
      execPath,
      entry,
      pid: process.pid,
      packageVersion: PACKAGE_VERSION,
      execModifiedAt: execStat?.modifiedAt,
      execModifiedTs: execStat?.modifiedTs,
      entryModifiedAt: entryStat?.modifiedAt,
      entryModifiedTs: entryStat?.modifiedTs,
    }
  }

  export async function latest(installMethod?: Method) {
    const detectedMethod = installMethod || (await method())

    if (detectedMethod === "brew") {
      const formula = await getBrewFormula()
      if (formula === "agent-core" || formula === "adolago/tap/agent-core") {
        return fetch("https://formulae.brew.sh/api/formula/agent-core.json")
          .then((res) => {
            if (!res.ok) throw new Error(res.statusText)
            return res.json()
          })
          .then((data: any) => data.versions.stable)
      }
    }

    if (detectedMethod === "npm" || detectedMethod === "bun" || detectedMethod === "pnpm" || detectedMethod === "yarn") {
      const registry = await iife(async () => {
        const r = (await $`npm config get registry`.quiet().nothrow().text()).trim()
        const reg = r || "https://registry.npmjs.org"
        return reg.endsWith("/") ? reg.slice(0, -1) : reg
      })
      const channel = CHANNEL
      const npmPackage = await resolveNpmPackage(detectedMethod)
      const encoded = encodeURIComponent(npmPackage)
      return fetch(`${registry}/${encoded}/${channel}`)
        .then((res) => {
          if (!res.ok) throw new Error(res.statusText)
          return res.json()
        })
        .then((data: any) => data.version)
    }

    return fetch("https://api.github.com/repos/adolago/agent-core/releases/latest")
      .then((res) => {
        if (!res.ok) throw new Error(res.statusText)
        return res.json()
      })
      .then((data: any) => data.tag_name.replace(/^v/, ""))
  }
}
