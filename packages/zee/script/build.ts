#!/usr/bin/env bun

import solidPlugin from "@opentui/solid/bun-plugin"
import path from "path"
import fs from "fs"
import { createRequire } from "module"
import { $ } from "bun"
import { fileURLToPath } from "url"
import { parse as parseYaml } from "yaml"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const dir = path.resolve(__dirname, "..")
const repoRoot = path.resolve(dir, "..", "..")

process.chdir(dir)

import pkg from "../package.json"
import { Script } from "../src/pkg/script"

const personasRoot = path.resolve(repoRoot, "packages", "personas")
const zeeRoot = path.join(personasRoot, "zee")
const zeeAssetsRoot = path.join(repoRoot, ".zee")
const agentsSkillsRoot = path.join(repoRoot, ".agents", "skills")
const SKILL_GLOB = new Bun.Glob("**/SKILL.md")

type SkillManifestContext = "zee" | "stanley" | "johny"

type SkillManifestEntry = {
  id: string
  path: string
  context?: SkillManifestContext
  title: string
  description: string
  requires?: Record<string, unknown>
  curated: true
}

type SkillManifest = {
  version: number
  generatedAt: string
  skills: SkillManifestEntry[]
}

function normalizeSkillPath(value: string): string {
  return value.replaceAll("\\", "/").replace(/^\/+/, "")
}

function extractFrontmatter(markdown: string): Record<string, unknown> {
  const match = markdown.match(/^---\s*\r?\n([\s\S]*?)\r?\n---\s*(?:\r?\n|$)/)
  if (!match) return {}
  try {
    const parsed = parseYaml(match[1])
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
  } catch {
    // Ignore malformed frontmatter and keep best-effort defaults.
  }
  return {}
}

function extractSkillContext(skillPath: string): SkillManifestContext | undefined {
  const match = skillPath.match(/(?:^|\/)@(zee|stanley|johny)(?:\/|$)/)
  if (!match) return undefined
  return match[1] as SkillManifestContext
}

function parseSkillRequires(frontmatter: Record<string, unknown>): Record<string, unknown> | undefined {
  const direct = frontmatter.requires
  if (direct && typeof direct === "object" && !Array.isArray(direct)) {
    return direct as Record<string, unknown>
  }

  const metadata = frontmatter.metadata
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return undefined
  }

  const metadataRecord = metadata as Record<string, unknown>
  const metadataRequires = metadataRecord.requires
  if (metadataRequires && typeof metadataRequires === "object" && !Array.isArray(metadataRequires)) {
    return metadataRequires as Record<string, unknown>
  }

  const metadataZee = metadataRecord.zee
  if (!metadataZee || typeof metadataZee !== "object" || Array.isArray(metadataZee)) {
    return undefined
  }

  const zeeRequires = (metadataZee as Record<string, unknown>).requires
  if (zeeRequires && typeof zeeRequires === "object" && !Array.isArray(zeeRequires)) {
    return zeeRequires as Record<string, unknown>
  }

  return undefined
}

async function createSkillManifest(skillRoot: string): Promise<SkillManifest> {
  const matches = await Array.fromAsync(
    SKILL_GLOB.scan({
      cwd: skillRoot,
      absolute: true,
      onlyFiles: true,
      followSymlinks: true,
      dot: true,
    }),
  )

  const skills: SkillManifestEntry[] = matches
    .map((matchPath) => {
      const relativeSkillFile = normalizeSkillPath(path.relative(skillRoot, matchPath))
      const relativeSkillDir = normalizeSkillPath(path.dirname(relativeSkillFile))
      const markdown = fs.readFileSync(matchPath, "utf-8")
      const frontmatter = extractFrontmatter(markdown)

      const frontmatterName = typeof frontmatter.name === "string" ? frontmatter.name.trim() : ""
      const title = frontmatterName || path.basename(relativeSkillDir)
      const description =
        typeof frontmatter.description === "string" ? frontmatter.description.trim() : "Curated Zee skill"
      const requires = parseSkillRequires(frontmatter)
      const context = extractSkillContext(relativeSkillDir)
      const id = relativeSkillDir.replaceAll("/", ".")

      return {
        id,
        path: relativeSkillDir,
        ...(context ? { context } : {}),
        title,
        description,
        ...(requires ? { requires } : {}),
        curated: true as const,
      }
    })
    .sort((a, b) => a.path.localeCompare(b.path))

  if (skills.length === 0) {
    throw new Error(`No SKILL.md files were bundled under ${skillRoot}`)
  }

  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    skills,
  }
}

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
  // Only bundle Zee. Other personas are legacy UI affordances, not separate runtimes.
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

function bundleZeeAssets(distRoot: string) {
  if (!fs.existsSync(zeeAssetsRoot)) return
  const destRoot = path.join(distRoot, ".zee")
  fs.mkdirSync(destRoot, { recursive: true })
  const entries = ["agent", "command", "themes", "skill", "tool", "plugin", "identity"]
  for (const entry of entries) {
    const src = path.join(zeeAssetsRoot, entry)
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
  const configSrc = path.join(zeeAssetsRoot, "zee.jsonc")
  if (fs.existsSync(configSrc)) {
    const configDest = path.join(destRoot, "zee.jsonc")
    const raw = fs.readFileSync(configSrc, "utf-8")
    // Strip local-only MCP paths that won't work in dist
    const safeConfig = raw.replace(/"command":\s*\[.*?\]/g, '"command": []')
    fs.writeFileSync(configDest, safeConfig)
  }
}

async function bundlePersonaSkills(distRoot: string) {
  if (!fs.existsSync(agentsSkillsRoot)) return
  const destRoot = path.join(distRoot, ".zee", "skill")
  fs.mkdirSync(destRoot, { recursive: true })
  const skills = fs
    .readdirSync(agentsSkillsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
    .map((entry) => entry.name)

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

  const manifest = await createSkillManifest(destRoot)
  const manifestPath = path.join(distRoot, ".zee", "skill-manifest.json")
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n")

  console.log(`Bundled ${manifest.skills.length} curated skills into ${manifestPath}`)
}

// Fetch and generate models.dev snapshot for bundling
const modelsUrl = process.env.ZEE_MODELS_URL || "https://models.dev"
const modelsData = process.env.MODELS_DEV_API_JSON
  ? await Bun.file(process.env.MODELS_DEV_API_JSON).text()
  : await fetch(`${modelsUrl}/api.json`).then((x) => x.text())
await Bun.write(
  path.join(dir, "src/provider/models-snapshot.ts"),
  `// Auto-generated by build.ts - do not edit\nexport const snapshot = ${modelsData} as const\n`,
)
console.log("Generated models-snapshot.ts")

const singleFlag = process.argv.includes("--single")
const baselineFlag = process.argv.includes("--baseline")
const skipInstall = process.argv.includes("--skip-install")
const binarySuffix = process.env.ZEE_BINARY_SUFFIX?.trim()
const targetsArg =
  process.env.ZEE_TARGETS ??
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
const shouldInstallBuildDeps = !skipInstall && process.env.CI === "true"
if (shouldInstallBuildDeps) {
  console.log("CI build: installing platform build dependencies")
  await $`bun install --os="*" --cpu="*" @opentui/core@${pkg.dependencies["@opentui/core"]}`
  await $`bun install --os="*" --cpu="*" @parcel/watcher@${pkg.dependencies["@parcel/watcher"]}`
} else {
  if (skipInstall) {
    console.log("Skipping build dependency install (--skip-install).")
  } else {
    console.log("Skipping build dependency install (local build; CI installs only).")
  }
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
      outfile: `dist/${name}/bin/zee`,
      execArgv: [`--user-agent=zee/${Script.version}`, "--use-system-ca", "--"],
      windows: {},
    },
    entrypoints: ["./src/index.ts", parserWorker, workerPath],
    define: {
      ZEE_VERSION: `'${Script.version}'`,
      ZEE_CHANNEL: `'${Script.channel}'`,
      OTUI_TREE_SITTER_WORKER_PATH: bunfsRoot + workerRelativePath,
      ZEE_WORKER_PATH: workerPath,
      ZEE_LIBC: item.os === "linux" ? `'${item.abi ?? "glibc"}'` : "",
      __ZEE_VERSION__: `'${Script.version}'`,
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
  // Bundle personas so standalone installs can resolve them via ZEE_ROOT.
  bundlePersonas(path.join(dir, "dist", name))
  bundleZeeAssets(path.join(dir, "dist", name))
  await bundlePersonaSkills(path.join(dir, "dist", name))
  bundleSrcModules(path.join(dir, "dist", name))
  binaries[name] = Script.version
}

export { binaries }
