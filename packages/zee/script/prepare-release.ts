#!/usr/bin/env bun

import fs from "node:fs"
import path from "node:path"

import pkg from "../package.json"
import { Script } from "../src/pkg/script"

const dir = path.resolve(import.meta.dir, "..")
process.chdir(dir)

const NPM_PACKAGE = process.env.ZEE_NPM_PACKAGE?.trim() || pkg.name
const GITHUB_REPO = process.env.ZEE_GITHUB_REPO?.trim() || "adolago/zee"
const distRoot = path.join(dir, "dist")

function packageDir(packageName: string) {
  return path.join(distRoot, ...packageName.split("/"))
}

function packageParts(packageName: string) {
  if (packageName.startsWith("@")) {
    const [scope, name] = packageName.split("/")
    return { scope, name }
  }
  return { scope: undefined, name: packageName }
}

function discoverPlatformPackages(packageName: string) {
  const { scope, name } = packageParts(packageName)
  const scopeRoot = scope ? path.join(distRoot, scope) : distRoot
  if (!fs.existsSync(scopeRoot)) return []

  return fs
    .readdirSync(scopeRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith(`${name}-`))
    .map((entry) => ({
      packageName: scope ? `${scope}/${entry.name}` : entry.name,
      dir: path.join(scopeRoot, entry.name),
    }))
    .sort((a, b) => a.packageName.localeCompare(b.packageName))
}

const mainDir = packageDir(NPM_PACKAGE)
const platformPackages = discoverPlatformPackages(NPM_PACKAGE)

if (platformPackages.length === 0) {
  throw new Error(`No built platform packages found for ${NPM_PACKAGE} under ${distRoot}`)
}

fs.rmSync(mainDir, { recursive: true, force: true })
fs.mkdirSync(path.join(mainDir, "bin"), { recursive: true })

fs.cpSync(path.join(dir, "bin"), path.join(mainDir, "bin"), { recursive: true })
fs.cpSync(path.join(dir, "README.md"), path.join(mainDir, "README.md"))
fs.cpSync(path.join(dir, "script", "postinstall.mjs"), path.join(mainDir, "postinstall.mjs"))

const optionalDependencies = Object.fromEntries(
  platformPackages.map(({ dir }) => {
    const meta = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf-8")) as {
      name: string
      version: string
    }
    return [meta.name, meta.version]
  }),
)

fs.writeFileSync(
  path.join(mainDir, "package.json"),
  JSON.stringify(
    {
      name: NPM_PACKAGE,
      description: "Zee engine (CLI + daemon)",
      version: Script.version,
      license: "MIT",
      repository: {
        type: "git",
        url: `git+https://github.com/${GITHUB_REPO}.git`,
      },
      bin: {
        zee: "./bin/zee",
      },
      scripts: {
        postinstall: "bun ./postinstall.mjs || node ./postinstall.mjs",
      },
      optionalDependencies,
      keywords: ["ai", "agent", "tui", "cli", "llm", "claude", "openai"],
      publishConfig: {
        access: "public",
      },
    },
    null,
    2,
  ) + "\n",
)

console.log(
  JSON.stringify(
    {
      package: NPM_PACKAGE,
      version: Script.version,
      platformPackages: platformPackages.map((item) => item.packageName),
    },
    null,
    2,
  ),
)
