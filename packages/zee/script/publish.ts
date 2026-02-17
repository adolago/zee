#!/usr/bin/env bun
import { $ } from "bun"
import pkg from "../package.json"
import { Script } from "@zee/script"
import { fileURLToPath } from "url"
import path from "path"
import fs from "fs"

const dir = fileURLToPath(new URL("..", import.meta.url))
const repoRoot = path.resolve(dir, "..", "..")
process.chdir(dir)

// =============================================================================
// Configuration
// =============================================================================

const DEFAULT_NPM_PACKAGE = "@zee/zee"
const NPM_PACKAGE = process.env.ZEE_NPM_PACKAGE?.trim() || DEFAULT_NPM_PACKAGE
const SCOPE_PREFIX = NPM_PACKAGE.startsWith("@") ? NPM_PACKAGE.split("/")[0] : ""
const scopedName = (name: string) => {
  if (!SCOPE_PREFIX) return name
  const bare = name.startsWith("@") ? name.replace(/^@[^/]+\//, "") : name
  return `${SCOPE_PREFIX}/${bare}`
}

const GITHUB_REPO = process.env.ZEE_GITHUB_REPO?.trim() || "adolago/zee"
const skipDocker = ["1", "true", "yes"].includes((process.env.ZEE_SKIP_DOCKER ?? "").toLowerCase())
const skipGithub = ["1", "true", "yes"].includes((process.env.ZEE_SKIP_GITHUB ?? "").toLowerCase())

const npmOtp = process.env.ZEE_NPM_OTP?.trim() || process.env.NPM_OTP?.trim() || process.env.NPM_CONFIG_OTP?.trim()
const otpArgs = npmOtp ? ["--otp", npmOtp] : []

console.log("=== Zee Publish Script ===")
console.log({
  package: NPM_PACKAGE,
  version: Script.version,
  channel: Script.channel,
  preview: Script.preview,
  skipDocker,
  skipGithub,
})

// =============================================================================
// Version Management
// =============================================================================

async function updateVersionAcrossRepos(version: string) {
  console.log(`\n* Updating version to ${version} across repos...`)

  // Update packages/zee/package.json
  const zeePkgPath = path.join(dir, "package.json")
  const zeePkg = JSON.parse(fs.readFileSync(zeePkgPath, "utf-8"))
  zeePkg.version = version
  fs.writeFileSync(zeePkgPath, JSON.stringify(zeePkg, null, 2) + "\n")
  console.log(`  Updated ${zeePkgPath}`)

  // Update root package.json
  const rootPkgPath = path.join(repoRoot, "package.json")
  if (fs.existsSync(rootPkgPath)) {
    const rootPkg = JSON.parse(fs.readFileSync(rootPkgPath, "utf-8"))
    rootPkg.version = version
    fs.writeFileSync(rootPkgPath, JSON.stringify(rootPkg, null, 2) + "\n")
    console.log(`  Updated ${rootPkgPath}`)
  }
}

async function gitTagAndPush(version: string) {
  if (Script.preview) {
    console.log(`\n> Would create git tag v${version} (dry-run)`)
    return
  }

  console.log(`\n> Creating git tag v${version}...`)

  // Commit version changes
  await $`git add -A`.cwd(repoRoot).quiet().nothrow()
  await $`git commit -m "chore: bump version to ${version}" --allow-empty`.cwd(repoRoot).quiet().nothrow()

  // Create and push tag
  await $`git tag -a v${version} -m "Release v${version}"`.cwd(repoRoot).quiet().nothrow()
  await $`git push origin dev`.cwd(repoRoot).quiet().nothrow()
  await $`git push origin v${version}`.cwd(repoRoot).quiet().nothrow()
  console.log(`  Tagged and pushed v${version}`)
}

// =============================================================================
// Build Verification
// =============================================================================

const { binaries } = await import("./build.ts")
{
  const binarySuffix = process.env.ZEE_BINARY_SUFFIX?.trim()
  const osName = process.platform === "win32" ? "windows" : process.platform
  const name = [pkg.name, osName, process.arch, binarySuffix].filter(Boolean).join("-")
  console.log(`\n> Smoke test: running dist/${name}/bin/zee --version`)
  await $`./dist/${name}/bin/zee --version`
}

// =============================================================================
// Prepare npm Package
// =============================================================================

console.log(`\n* Preparing npm package ${NPM_PACKAGE}...`)

await $`mkdir -p ./dist/${pkg.name}`
await $`cp -r ./bin ./dist/${pkg.name}/bin`
await $`cp ./README.md ./dist/${pkg.name}/README.md`
await $`cp ./script/postinstall.mjs ./dist/${pkg.name}/postinstall.mjs`

await Bun.file(`./dist/${pkg.name}/package.json`).write(
  JSON.stringify(
    {
      name: NPM_PACKAGE,
      description: "Zee engine (CLI + daemon)",
      bin: {
        zee: "./bin/zee",
      },
      scripts: {
        postinstall: "bun ./postinstall.mjs || node ./postinstall.mjs",
      },
      version: Script.version,
      license: "MIT",
      repository: {
        type: "git",
        url: `git+https://github.com/${GITHUB_REPO}.git`,
      },
      keywords: ["ai", "agent", "tui", "cli", "llm", "claude", "openai"],
      optionalDependencies: Object.fromEntries(
        Object.entries(binaries).map(([name, version]) => [scopedName(name), version]),
      ),
    },
    null,
    2,
  ),
)

// =============================================================================
// Publish to npm
// =============================================================================

const tags = [Script.channel]
const publishFlag = Script.preview ? "--dry-run" : ""

console.log(`\n> Publishing platform binaries to npm...`)
const tasks = Object.entries(binaries).map(async ([name]) => {
  const pkgPath = `./dist/${name}/package.json`
  const raw = await Bun.file(pkgPath).text()
  const parsed = JSON.parse(raw)
  parsed.name = scopedName(name)
  await Bun.file(pkgPath).write(JSON.stringify(parsed, null, 2))
  if (process.platform !== "win32") {
    await $`chmod -R 755 .`.cwd(`./dist/${name}`)
  }
  await $`bun pm pack`.cwd(`./dist/${name}`)
  for (const tag of tags) {
    await $`npm publish ${publishFlag} *.tgz --access public --tag ${tag} ${otpArgs}`.cwd(`./dist/${name}`)
  }
})
await Promise.all(tasks)

console.log(`\n> Publishing main package ${NPM_PACKAGE}...`)
for (const tag of tags) {
  await $`cd ./dist/${pkg.name} && bun pm pack && npm publish ${publishFlag} *.tgz --access public --tag ${tag} ${otpArgs}`
}

// =============================================================================
// GitHub Release & Docker
// =============================================================================

if (!Script.preview) {
  // Update versions and create git tags
  await updateVersionAcrossRepos(Script.version)
  await gitTagAndPush(Script.version)

  // Create archives for GitHub release (in dist/ directory)
  console.log(`\n* Creating release archives...`)
  const archives: string[] = []
  for (const key of Object.keys(binaries)) {
    const assetBase = key.replace(/^@[^/]+\//, "")
    if (key.includes("linux")) {
      await $`tar -czf dist/${assetBase}.tar.gz -C dist/${key}/bin .`.cwd(dir)
      archives.push(`dist/${assetBase}.tar.gz`)
    } else {
      await $`zip -rj dist/${assetBase}.zip dist/${key}/bin/*`.cwd(dir)
      archives.push(`dist/${assetBase}.zip`)
    }
  }
  console.log(`  Created: ${archives.join(", ")}`)

  // Create GitHub release
  if (!skipGithub) {
    console.log(`\n> Creating GitHub release v${Script.version}...`)
    const releaseNotes = `## Zee v${Script.version}

### Installation

\`\`\`bash
npm install -g ${NPM_PACKAGE}@${Script.version}
# or
bun install -g ${NPM_PACKAGE}@${Script.version}
\`\`\`

### Changes

See [CHANGELOG](https://github.com/${GITHUB_REPO}/blob/dev/CHANGELOG.md) for details.
`
    const releaseNotesFile = path.join(dir, "dist", "RELEASE_NOTES.md")
    fs.writeFileSync(releaseNotesFile, releaseNotes)

    const archiveFlags = archives.join(" ")
    await $`gh release create v${Script.version} ${archiveFlags} --repo ${GITHUB_REPO} --title "v${Script.version}" --notes-file ${releaseNotesFile} --prerelease`
      .cwd(dir)
      .nothrow()
    console.log(`  Created GitHub release v${Script.version}`)
  }

  // Build and push Docker image
  if (!skipDocker) {
    console.log(`\n> Building and pushing Docker image...`)
    const image = `ghcr.io/${GITHUB_REPO.split("/")[0]}/zee`
    const platforms = "linux/amd64,linux/arm64"
    const dockerTags = [`${image}:${Script.version}`, `${image}:latest`]
    const tagFlags = dockerTags.flatMap((t) => ["-t", t])
    await $`docker buildx build --platform ${platforms} ${tagFlags} --push .`.nothrow()
    console.log(`  Pushed ${dockerTags.join(", ")}`)
  }
}

console.log(`\n+ Publish complete!`)
if (Script.preview) {
  console.log(`   (This was a dry-run. Set ZEE_CHANNEL=stable to publish for real)`)
} else {
  console.log(`   Package: npm install -g ${NPM_PACKAGE}@${Script.version}`)
}
