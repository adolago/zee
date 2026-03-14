#!/usr/bin/env bun

import { $ } from "bun"
import fs from "node:fs"
import path from "node:path"

import pkg from "../package.json"

const dir = path.resolve(import.meta.dir, "..")
process.chdir(dir)

const NPM_PACKAGE = process.env.ZEE_NPM_PACKAGE?.trim() || pkg.name
const PUBLISH_TAG = process.env.ZEE_PUBLISH_TAG?.trim() || "latest"
const distRoot = path.join(dir, "dist")

function packageParts(packageName: string) {
  if (packageName.startsWith("@")) {
    const [scope, name] = packageName.split("/")
    return { scope, name }
  }
  return { scope: undefined, name: packageName }
}

function packageDir(packageName: string) {
  return path.join(distRoot, ...packageName.split("/"))
}

function discoverPackageDirs(packageName: string) {
  const { scope, name } = packageParts(packageName)
  const scopeRoot = scope ? path.join(distRoot, scope) : distRoot
  const items: Array<{ packageName: string; dir: string; main: boolean }> = []

  if (scope && fs.existsSync(scopeRoot)) {
    for (const entry of fs.readdirSync(scopeRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      if (entry.name === name || entry.name.startsWith(`${name}-`)) {
        const discoveredName = `${scope}/${entry.name}`
        items.push({
          packageName: discoveredName,
          dir: path.join(scopeRoot, entry.name),
          main: discoveredName === packageName,
        })
      }
    }
  } else if (fs.existsSync(packageDir(packageName))) {
    items.push({ packageName, dir: packageDir(packageName), main: true })
  }

  return items.sort((a, b) => {
    if (a.main === b.main) return a.packageName.localeCompare(b.packageName)
    return a.main ? 1 : -1
  })
}

async function packageVersionExists(packageName: string, version: string) {
  const result = await $`npm view ${`${packageName}@${version}`} version`.quiet().nothrow()
  return result.exitCode === 0
}

const packages = discoverPackageDirs(NPM_PACKAGE)
if (packages.length === 0) {
  throw new Error(`No dist packages found for ${NPM_PACKAGE} under ${distRoot}`)
}

for (const item of packages) {
  const meta = JSON.parse(fs.readFileSync(path.join(item.dir, "package.json"), "utf-8")) as {
    name: string
    version: string
  }

  if (await packageVersionExists(meta.name, meta.version)) {
    console.log(`Skipping ${meta.name}@${meta.version}; already published.`)
    continue
  }

  console.log(`Publishing ${meta.name}@${meta.version} with tag ${PUBLISH_TAG}`)
  await $`bun pm pack`.cwd(item.dir)
  await $`npm publish *.tgz --access public --tag ${PUBLISH_TAG} --provenance`.cwd(item.dir)
}
