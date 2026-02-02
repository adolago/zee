#!/usr/bin/env bun

import solidPlugin from "@opentui/solid/bun-plugin"
import path from "path"
import fs from "fs"
import { createRequire } from "module"
import { $ } from "bun"
import { fileURLToPath } from "url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const dir = path.resolve(__dirname, "..")
const repoRoot = path.resolve(dir, "..", "..")

process.chdir(dir)

import pkg from "../package.json"
import { Script } from "../src/pkg/script"

const personasRoot = path.resolve(repoRoot, "packages", "personas")
const zeeRoot = path.join(personasRoot, "zee")
const tiaraRoot = path.resolve(repoRoot, "packages", "tiara")
const agentCoreAssetsRoot = path.join(repoRoot, ".agent-core")
const agentsSkillsRoot = path.join(repoRoot, ".agents", "skills")

async function ensureZeeDependencies() {
  const nodeModules = path.join(zeeRoot, "node_modules")
  if (fs.existsSync(nodeModules)) return
  if (!fs.existsSync(path.join(zeeRoot, "package.json"))) return
  console.log("installing zee dependencies for bundling")
  await $`pnpm install --prod --ignore-scripts`.cwd(zeeRoot)
}

function bundlePersonas(distRoot: string) {
  if (!fs.existsSync(personasRoot)) return
  const destRoot = path.join(distRoot, "packages", "personas")
  fs.mkdirSync(destRoot, { recursive: true })
  // Only bundle Zee - Stanley is external (STANLEY_REPO env var), Johny is in agent-core
  const src = path.join(personasRoot, "zee")
  if (!fs.existsSync(src)) return
  const dest = path.join(destRoot, "zee")
  fs.cpSync(src, dest, {
    recursive: true,
    dereference: true,
    filter: (srcPath) => {
      const base = path.basename(srcPath)
      if (base === ".git" || base === ".venv" || base === "venv") return false
      // Avoid recursive symlink loop in extensions
      if (srcPath.includes("/extensions/") && base === "node_modules") return false
      // Avoid recursive symlink loop in pnpm structure
      if (srcPath.includes("node_modules/zee")) return false
      // Skip .pnpm store - has complex internal symlinks that break rm -rf on rebuild
      if (base === ".pnpm") return false
      // Skip broken symlinks (e.g., skills -> absolute path that doesn't exist in CI)
      try {
        const stats = fs.lstatSync(srcPath)
        if (stats.isSymbolicLink()) {
          const target = fs.readlinkSync(srcPath)
          // Skip absolute symlinks (they won't work in dist)
          if (path.isAbsolute(target)) return false
          // Check if relative symlink target exists
          const resolvedTarget = path.resolve(path.dirname(srcPath), target)
          if (!fs.existsSync(resolvedTarget)) return false
        }
      } catch {
        return false
      }
      return true
    },
  })

  // Also copy extensions to bin/extensions so bundled-dir.ts can find them
  // as a sibling of the executable (process.execPath/../extensions)
  const extensionsSrc = path.join(src, "extensions")
  const extensionsDest = path.join(distRoot, "bin", "extensions")
  if (fs.existsSync(extensionsSrc)) {
    fs.cpSync(extensionsSrc, extensionsDest, {
      recursive: true,
      dereference: true,
      filter: (srcPath) => {
        const base = path.basename(srcPath)
        return base !== ".git" && base !== "node_modules"
      },
    })
  }
}

function bundleTiara(distRoot: string) {
  if (!fs.existsSync(tiaraRoot)) return
  const destRoot = path.join(distRoot, "packages", "tiara")
  fs.mkdirSync(destRoot, { recursive: true })
  fs.cpSync(tiaraRoot, destRoot, {
    recursive: true,
    dereference: true,
    filter: (srcPath) => {
      const base = path.basename(srcPath)
      return base !== ".git" && base !== "node_modules" && base !== ".venv" && base !== "venv"
    },
  })
}

function bundleSrcModules(distRoot: string) {
  // Bundle src/ modules that are dynamically imported at runtime
  // These are imported via relative paths like ../../../../../src/memory/unified
  const srcRoot = path.join(repoRoot, "src")
  if (!fs.existsSync(srcRoot)) return
  
  const destRoot = path.join(distRoot, "src")
  fs.mkdirSync(destRoot, { recursive: true })
  
  // Modules needed at runtime (dynamically imported)
  const modules = ["memory", "config"]
  for (const mod of modules) {
    const src = path.join(srcRoot, mod)
    if (!fs.existsSync(src)) continue
    const dest = path.join(destRoot, mod)
    fs.cpSync(src, dest, {
      recursive: true,
      dereference: true,
      filter: (srcPath) => {
        const base = path.basename(srcPath)
        // Skip test files and node_modules
        if (base.includes(".test.") || base === "node_modules") return false
        return true
      },
    })
  }
}

function bundleAgentCoreAssets(distRoot: string) {
  if (!fs.existsSync(agentCoreAssetsRoot)) return
  const destRoot = path.join(distRoot, ".agent-core")
  fs.mkdirSync(destRoot, { recursive: true })
  const entries = ["agent", "command", "themes", "skill"]
  for (const entry of entries) {
    const src = path.join(agentCoreAssetsRoot, entry)
    if (!fs.existsSync(src)) continue
    const dest = path.join(destRoot, entry)
    fs.cpSync(src, dest, {
      recursive: true,
      dereference: true,
      filter: (srcPath) => {
        const base = path.basename(srcPath)
        return base !== ".git" && base !== "node_modules" && base !== ".venv" && base !== "venv"
      },
    })
  }

  // Bundle a safe version of the config with default_agent set
  const configSrc = path.join(agentCoreAssetsRoot, "agent-core.jsonc")
  if (fs.existsSync(configSrc)) {
    const configDest = path.join(destRoot, "agent-core.jsonc")
    const raw = fs.readFileSync(configSrc, "utf-8")
    // Strip local-only MCP paths that won't work in dist
    const safeConfig = raw.replace(/"command":\s*\[.*?\]/g, '"command": []')
    fs.writeFileSync(configDest, safeConfig)
  }
}

function bundlePersonaSkills(distRoot: string) {
  if (!fs.existsSync(agentsSkillsRoot)) return
  const destRoot = path.join(distRoot, ".agent-core", "skill")
  fs.mkdirSync(destRoot, { recursive: true })
  const skills = ["zee", "stanley", "johny", "personas"]
  for (const skill of skills) {
    const src = path.join(agentsSkillsRoot, skill)
    if (!fs.existsSync(src)) continue
    const dest = path.join(destRoot, skill)
    fs.cpSync(src, dest, {
      recursive: true,
      dereference: true,
      filter: (srcPath) => {
        const base = path.basename(srcPath)
        return base !== ".git" && base !== "node_modules" && base !== ".venv" && base !== "venv"
      },
    })
  }
}

// Fetch and generate models.dev snapshot for bundling
const modelsData = await fetch("https://models.dev/api.json").then((x) => x.text())
await Bun.write(
  path.join(dir, "src/provider/models-snapshot.ts"),
  `// Auto-generated by build.ts - do not edit\nexport const snapshot = ${modelsData} as const\n`,
)
console.log("Generated models-snapshot.ts")

const singleFlag = process.argv.includes("--single")
const baselineFlag = process.argv.includes("--baseline")
const skipInstall = process.argv.includes("--skip-install")
const binarySuffix = process.env.OPENCODE_BINARY_SUFFIX?.trim()
const targetsArg =
  process.env.AGENT_CORE_TARGETS ??
  (() => {
    const idx = process.argv.indexOf("--targets")
    if (idx === -1) return undefined
    return process.argv[idx + 1]
  })()

const allTargets: {
  os: string
  arch: "arm64" | "x64"
  abi?: "musl"
  avx2?: false
}[] = [
  {
    os: "linux",
    arch: "arm64",
  },
  {
    os: "linux",
    arch: "x64",
  },
  {
    os: "linux",
    arch: "x64",
    avx2: false,
  },
  {
    os: "linux",
    arch: "arm64",
    abi: "musl",
  },
  {
    os: "linux",
    arch: "x64",
    abi: "musl",
  },
  {
    os: "linux",
    arch: "x64",
    abi: "musl",
    avx2: false,
  },
  {
    os: "win32",
    arch: "x64",
  },
  {
    os: "win32",
    arch: "x64",
    avx2: false,
  },
]

const targetsFilter = (() => {
  if (!targetsArg) return undefined
  const requested = targetsArg
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => item.split("-"))
  return (item: (typeof allTargets)[number]) => {
    return requested.some(([os, arch, variant]) => {
      if (os && item.os !== os) return false
      if (arch && item.arch !== arch) return false
      if (variant === "baseline") return item.avx2 === false
      if (variant === "musl") return item.abi === "musl"
      return item.avx2 !== false && item.abi === undefined
    })
  }
})()

// Default to linux-x64 only for solo development
const targets = targetsFilter
  ? allTargets.filter(targetsFilter)
  : singleFlag
    ? allTargets.filter((item) => {
        if (item.os !== process.platform || item.arch !== process.arch) {
          return false
        }
        if (item.avx2 === false) {
          return baselineFlag
        }
        if (item.abi !== undefined) {
          return false
        }
        return true
      })
    : allTargets.filter((item) => {
        // Solo development: linux-x64 only by default
        return item.os === "linux" && item.arch === "x64" && item.abi === undefined && item.avx2 !== false
      })

await $`rm -rf dist`

const binaries: Record<string, string> = {}
if (!skipInstall) {
  await $`bun install --os="*" --cpu="*" @opentui/core@${pkg.dependencies["@opentui/core"]}`
  await $`bun install --os="*" --cpu="*" @parcel/watcher@${pkg.dependencies["@parcel/watcher"]}`
}
if (fs.existsSync(zeeRoot)) {
  await ensureZeeDependencies()
}

for (const item of targets) {
  const baseName = [
    pkg.name,
    // changing to win32 flags npm for some reason
    item.os === "win32" ? "windows" : item.os,
    item.arch,
    item.avx2 === false ? "baseline" : undefined,
    item.abi === undefined ? undefined : item.abi,
  ]
    .filter(Boolean)
    .join("-")
  const name = [baseName, binarySuffix].filter(Boolean).join("-")
  console.log(`building ${name}`)
  await $`mkdir -p dist/${name}/bin`

  const require = createRequire(import.meta.url)
  const corePkg = require.resolve("@opentui/core/package.json")
  const parserWorker = path.join(path.dirname(corePkg), "parser.worker.js")
  const workerPath = "./src/cli/cmd/tui/worker.ts"

  // Use platform-specific bunfs root path based on target OS
  const bunfsRoot = item.os === "win32" ? "B:/~BUN/root/" : "/$bunfs/root/"
  const workerRelativePath = path.relative(dir, parserWorker).replaceAll("\\", "/")

  await Bun.build({
    conditions: ["browser"],
    external: ["electron"],
    tsconfig: "./tsconfig.json",
    plugins: [solidPlugin],
    sourcemap: "external",
    compile: {
      autoloadBunfig: false,
      autoloadDotenv: false,
      //@ts-ignore (bun types aren't up to date)
      autoloadTsconfig: true,
      autoloadPackageJson: true,
      target: baseName.replace(pkg.name, "bun") as any,
      outfile: `dist/${name}/bin/agent-core`,
      execArgv: [`--user-agent=agent-core/${Script.version}`, "--use-system-ca", "--"],
      windows: {},
    },
    entrypoints: ["./src/index.ts", parserWorker, workerPath],
    define: {
      AGENT_CORE_VERSION: `'${Script.version}'`,
      AGENT_CORE_CHANNEL: `'${Script.channel}'`,
      OPENCODE_VERSION: `'${Script.version}'`,
      OTUI_TREE_SITTER_WORKER_PATH: bunfsRoot + workerRelativePath,
      OPENCODE_WORKER_PATH: workerPath,
      OPENCODE_CHANNEL: `'${Script.channel}'`,
      OPENCODE_LIBC: item.os === "linux" ? `'${item.abi ?? "glibc"}'` : "",
    },
  })

  await $`rm -rf ./dist/${name}/bin/tui`
  const pkgJson = JSON.stringify(
    {
      name,
      version: Script.version,
      os: [item.os],
      cpu: [item.arch],
    },
    null,
    2,
  )
  await Bun.file(`dist/${name}/package.json`).write(pkgJson)
  await Bun.file(`dist/${name}/bin/package.json`).write(pkgJson)
  // Bundle personas so standalone installs can resolve them via AGENT_CORE_ROOT.
  bundlePersonas(path.join(dir, "dist", name))
  bundleTiara(path.join(dir, "dist", name))
  bundleAgentCoreAssets(path.join(dir, "dist", name))
  bundlePersonaSkills(path.join(dir, "dist", name))
  bundleSrcModules(path.join(dir, "dist", name))
  binaries[name] = Script.version
}

export { binaries }
