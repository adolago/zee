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
const swabbleRoot = path.join(dir, "Swabble")
const swabbleExtensionsRoot = path.join(swabbleRoot, "extensions")
const swabblePluginSdkRoot = path.join(swabbleRoot, "src", "plugin-sdk")

const zeeAssetsRoot = path.join(repoRoot, ".zee")
const agentsSkillsRoot = path.join(repoRoot, ".agents", "skills")

const BUNDLED_EXTENSION_IDS = ["whatsapp", "telegram", "slack", "discord"] as const
const EXTENSION_PLUGIN_MANIFEST_FILENAMES = ["zee.plugin.json", "clawdbot.plugin.json"] as const

const extensionPluginSdkAliasPlugin = {
  name: "extension-plugin-sdk-alias",
  setup(build: Bun.PluginBuilder) {
    build.onResolve({ filter: /^zee\/plugin-sdk$/ }, () => ({
      path: path.join(swabblePluginSdkRoot, "index.ts"),
    }))
  },
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
  const entries = ["agent", "command", "themes", "skill", "tool", "plugin"]
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

function bundlePersonaSkills(distRoot: string) {
  if (!fs.existsSync(agentsSkillsRoot)) return
  const destRoot = path.join(distRoot, ".zee", "skill")
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

function toBundledExtensionEntry(entry: string): string {
  const trimmed = entry.trim().replace(/\\/g, "/")
  if (!trimmed) return "index.js"
  const ext = path.extname(trimmed)
  if (!ext) return `${trimmed}.js`
  if (ext === ".js" || ext === ".mjs" || ext === ".cjs") return trimmed
  return `${trimmed.slice(0, -ext.length)}.js`
}

async function bundleSwabbleExtensions(distRoot: string, target?: { os: string; arch: string }) {
  if (!fs.existsSync(swabbleExtensionsRoot)) return

  const extensionsDestRoot = path.join(distRoot, "bin", "extensions")
  fs.mkdirSync(extensionsDestRoot, { recursive: true })

  for (const extensionId of BUNDLED_EXTENSION_IDS) {
    const extensionSrcRoot = path.join(swabbleExtensionsRoot, extensionId)
    if (!fs.existsSync(extensionSrcRoot)) continue

    const extensionDestRoot = path.join(extensionsDestRoot, extensionId)
    fs.mkdirSync(extensionDestRoot, { recursive: true })

    const manifestPath = path.join(extensionSrcRoot, "package.json")
    let manifest: Record<string, unknown> = {}
    if (fs.existsSync(manifestPath)) {
      try {
        manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8")) as Record<string, unknown>
      } catch {
        manifest = {}
      }
    }

    const rawExtensions = (() => {
      const zeeMeta = manifest.zee
      if (!zeeMeta || typeof zeeMeta !== "object") return []
      const value = (zeeMeta as { extensions?: unknown }).extensions
      if (!Array.isArray(value)) return []
      return value.filter((item): item is string => typeof item === "string")
    })()

    const extensionEntries = rawExtensions.length > 0 ? rawExtensions : ["./index.ts"]
    const bundledEntries: string[] = []
    const pluginManifestSource = EXTENSION_PLUGIN_MANIFEST_FILENAMES
      .map((filename) => path.join(extensionSrcRoot, filename))
      .find((manifestPath) => fs.existsSync(manifestPath))

    if (!pluginManifestSource) {
      throw new Error(
        `Failed to bundle extension "${extensionId}": missing plugin manifest (expected one of ${EXTENSION_PLUGIN_MANIFEST_FILENAMES.join(", ")})`,
      )
    }

    for (const entry of extensionEntries) {
      const sourceEntry = path.resolve(extensionSrcRoot, entry)
      if (!fs.existsSync(sourceEntry)) {
        console.warn(`[build] skipped extension entry (missing): ${sourceEntry}`)
        continue
      }

      const bundledEntry = toBundledExtensionEntry(entry)
      const result = await Bun.build({
        entrypoints: [sourceEntry],
        outdir: extensionDestRoot,
        format: "esm",
        target: "bun",
        splitting: false,
        sourcemap: "none",
        minify: false,
        external: ["electron"],
        plugins: [extensionPluginSdkAliasPlugin],
      })
      if (!result.success) {
        const errors = result.logs.map((log) => log.message).join("; ")
        throw new Error(`Failed to bundle extension "${extensionId}" entry "${entry}": ${errors}`)
      }

      // Bun.build with outdir already writes files to disk; do NOT re-write
      // artifacts here -- artifact.path can be absolute/deep-relative which
      // would create nested home/ directories in the output.

      bundledEntries.push(`./${bundledEntry.replace(/\\/g, "/").replace(/^\.\//, "")}`)
    }

    // Clean up any home/ directories that Bun.build may have created
    // via asset copying with absolute source paths
    const homeDir = path.join(extensionDestRoot, "home")
    if (fs.existsSync(homeDir)) {
      fs.rmSync(homeDir, { recursive: true, force: true })
    }

    // Strip cross-platform native modules -- keep only the target platform
    if (target) {
      const platformPrefix = `${target.os}-${target.arch}`
      for (const file of fs.readdirSync(extensionDestRoot)) {
        if (file.endsWith(".node") && !file.includes(platformPrefix)) {
          fs.unlinkSync(path.join(extensionDestRoot, file))
        }
      }
    }

    if (bundledEntries.length === 0) {
      throw new Error(`Failed to bundle extension "${extensionId}": no valid entries`)
    }

    const nextManifest = {
      ...manifest,
      zee: {
        ...((manifest.zee && typeof manifest.zee === "object") ? manifest.zee : {}),
        extensions: bundledEntries,
      },
    }
    fs.writeFileSync(path.join(extensionDestRoot, "package.json"), JSON.stringify(nextManifest, null, 2))
    fs.copyFileSync(
      pluginManifestSource,
      path.join(extensionDestRoot, path.basename(pluginManifestSource)),
    )
  }
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
  bundlePersonaSkills(path.join(dir, "dist", name))
  bundleSrcModules(path.join(dir, "dist", name))
  await bundleSwabbleExtensions(path.join(dir, "dist", name), { os: item.os, arch: item.arch })
  binaries[name] = Script.version
}

export { binaries }
