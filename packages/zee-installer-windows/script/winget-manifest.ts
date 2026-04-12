#!/usr/bin/env bun

import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"

const packageRoot = path.resolve(import.meta.dir, "..")
const repoRoot = path.resolve(packageRoot, "..", "..")
const zeePkg = JSON.parse(fs.readFileSync(path.join(repoRoot, "packages", "zee", "package.json"), "utf-8")) as {
  version: string
}

const version = process.env.ZEE_VERSION?.trim() || zeePkg.version
const msiPath = path.resolve(process.env.ZEE_MSI_PATH?.trim() || path.join(packageRoot, "dist", "ZeeSetup-x64.msi"))
const outDir = path.join(packageRoot, "dist", "winget")
const installerUrl =
  process.env.ZEE_WINGET_INSTALLER_URL?.trim() ||
  `https://github.com/adolago/zee/releases/download/v${version}/ZeeSetup-x64.msi`

function sha256(filepath: string): string {
  return crypto.createHash("sha256").update(fs.readFileSync(filepath)).digest("hex").toUpperCase()
}

if (!fs.existsSync(msiPath)) {
  throw new Error(`MSI not found: ${msiPath}`)
}

fs.mkdirSync(outDir, { recursive: true })

const installerManifest = `# yaml-language-server: $schema=https://aka.ms/winget-manifest.installer.1.9.0.schema.json
PackageIdentifier: Adolago.Zee
PackageVersion: ${version}
InstallerType: msi
Scope: machine
InstallModes:
- silent
- silentWithProgress
UpgradeBehavior: install
ReleaseDate: ${new Date().toISOString().slice(0, 10)}
Installers:
- Architecture: x64
  InstallerUrl: ${installerUrl}
  InstallerSha256: ${sha256(msiPath)}
ManifestType: installer
ManifestVersion: 1.9.0
`

const defaultLocaleManifest = `# yaml-language-server: $schema=https://aka.ms/winget-manifest.defaultLocale.1.9.0.schema.json
PackageIdentifier: Adolago.Zee
PackageVersion: ${version}
PackageLocale: en-US
Publisher: Adolago
PackageName: Zee
License: MIT
ShortDescription: Zee unified assistant engine for life admin, investing, and learning.
ManifestType: defaultLocale
ManifestVersion: 1.9.0
`

const versionManifest = `# yaml-language-server: $schema=https://aka.ms/winget-manifest.version.1.9.0.schema.json
PackageIdentifier: Adolago.Zee
PackageVersion: ${version}
DefaultLocale: en-US
ManifestType: version
ManifestVersion: 1.9.0
`

fs.writeFileSync(path.join(outDir, "Adolago.Zee.installer.yaml"), installerManifest, "utf-8")
fs.writeFileSync(path.join(outDir, "Adolago.Zee.locale.en-US.yaml"), defaultLocaleManifest, "utf-8")
fs.writeFileSync(path.join(outDir, "Adolago.Zee.yaml"), versionManifest, "utf-8")

console.log(
  JSON.stringify(
    {
      version,
      installerUrl,
      outDir,
    },
    null,
    2,
  ),
)
