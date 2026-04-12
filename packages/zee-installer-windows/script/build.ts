#!/usr/bin/env bun

import { $ } from "bun"
import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"

const packageRoot = path.resolve(import.meta.dir, "..")
const repoRoot = path.resolve(packageRoot, "..", "..")
const zeePackageRoot = path.join(repoRoot, "packages", "zee")
const zeePkg = JSON.parse(fs.readFileSync(path.join(zeePackageRoot, "package.json"), "utf-8")) as { version: string }

const version = process.env.ZEE_VERSION?.trim() || zeePkg.version
const sourceDir = path.resolve(
  process.env.ZEE_WINDOWS_DIST?.trim() || path.join(zeePackageRoot, "dist", "@adolago", "zee-windows-x64"),
)
const outDir = path.join(packageRoot, "dist")
const generatedDir = path.join(outDir, "generated")
const wxsPath = path.join(generatedDir, "Zee.generated.wxs")
const msiPath = path.join(outDir, "ZeeSetup-x64.msi")
const shaPath = path.join(outDir, "ZeeSetup-x64.sha256")

const upgradeCode = "1F55C9F7-0DD0-4B29-B0E7-A8A9AD87D2A8"

type FileEntry = {
  id: string
  componentId: string
  source: string
  relative: string
}

type DirNode = {
  id: string
  name: string
  dirs: Map<string, DirNode>
  files: FileEntry[]
}

function xml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;")
}

function stableId(prefix: string, value: string): string {
  return `${prefix}_${crypto.createHash("sha1").update(value).digest("hex").slice(0, 16)}`
}

function walkFiles(dir: string): string[] {
  const result: string[] = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const resolved = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      result.push(...walkFiles(resolved))
      continue
    }
    if (entry.isFile()) result.push(resolved)
  }
  return result
}

function addFile(root: DirNode, filePath: string): FileEntry {
  const relative = path.relative(sourceDir, filePath).replaceAll("\\", "/")
  const parts = relative.split("/")
  const filename = parts.pop()
  if (!filename) throw new Error(`Invalid file path: ${filePath}`)

  let current = root
  let currentRel = ""
  for (const part of parts) {
    currentRel = currentRel ? `${currentRel}/${part}` : part
    let next = current.dirs.get(part)
    if (!next) {
      next = {
        id: stableId("dir", currentRel),
        name: part,
        dirs: new Map(),
        files: [],
      }
      current.dirs.set(part, next)
    }
    current = next
  }

  const file: FileEntry = {
    id: relative === "bin/zee.exe" ? "ZeeExe" : stableId("file", relative),
    componentId: stableId("cmp", relative),
    source: filePath,
    relative,
  }
  current.files.push(file)
  return file
}

function renderDir(node: DirNode, indent = "      "): string[] {
  const lines: string[] = []
  const children = [...node.dirs.values()].sort((a, b) => a.name.localeCompare(b.name))
  for (const child of children) {
    lines.push(`${indent}<Directory Id="${child.id}" Name="${xml(child.name)}">`)
    lines.push(...renderDir(child, `${indent}  `))
    lines.push(`${indent}</Directory>`)
  }

  for (const file of node.files.sort((a, b) => a.relative.localeCompare(b.relative))) {
    lines.push(`${indent}<Component Id="${file.componentId}" Guid="*">`)
    lines.push(`${indent}  <File Id="${file.id}" Source="${xml(file.source)}" KeyPath="yes" />`)
    lines.push(`${indent}</Component>`)
  }
  return lines
}

function renderWxs(filePaths: string[]): string {
  const root: DirNode = {
    id: "INSTALLFOLDER",
    name: "Zee",
    dirs: new Map(),
    files: [],
  }
  const files = filePaths.map((filePath) => addFile(root, filePath))

  const componentRefs = files
    .map((file) => `      <ComponentRef Id="${file.componentId}" />`)
    .sort()
    .join("\n")

  return `<?xml version="1.0" encoding="UTF-8"?>
<Wix xmlns="http://wixtoolset.org/schemas/v4/wxs">
  <Package
    Name="Zee"
    Manufacturer="Adolago"
    Version="$(var.ProductVersion)"
    UpgradeCode="${upgradeCode}"
    Scope="perMachine">
    <MajorUpgrade DowngradeErrorMessage="A newer version of Zee is already installed." />
    <MediaTemplate EmbedCab="yes" />

    <Property Id="ZEE_START_SERVICE" Value="1" />
    <Property Id="ZEE_ADD_PATH" Value="1" />
    <Property Id="ZEE_KEEP_DATA_ON_UNINSTALL" Value="1" />

    <StandardDirectory Id="ProgramFiles64Folder">
      <Directory Id="INSTALLFOLDER" Name="Zee">
${renderDir(root).join("\n")}
      </Directory>
    </StandardDirectory>

    <CustomAction
      Id="InstallZeeService"
      FileRef="ZeeExe"
      ExeCommand="daemon-install --non-interactive --force --binary &quot;[#ZeeExe]&quot; --scope machine --service-account virtual --start --json"
      Execute="deferred"
      Return="check"
      Impersonate="no" />
    <CustomAction
      Id="UninstallZeeService"
      FileRef="ZeeExe"
      ExeCommand="daemon-uninstall --json"
      Execute="deferred"
      Return="ignore"
      Impersonate="no" />

    <InstallExecuteSequence>
      <Custom Action="InstallZeeService" After="InstallFiles" Condition="NOT Installed AND ZEE_START_SERVICE = &quot;1&quot;" />
      <Custom Action="UninstallZeeService" Before="RemoveFiles" Condition="REMOVE = &quot;ALL&quot;" />
    </InstallExecuteSequence>

    <Feature Id="MainFeature" Title="Zee" Level="1">
${componentRefs}
    </Feature>
  </Package>
</Wix>
`
}

function sha256(filepath: string): string {
  return crypto.createHash("sha256").update(fs.readFileSync(filepath)).digest("hex")
}

if (!fs.existsSync(path.join(sourceDir, "bin", "zee.exe"))) {
  throw new Error(`Expected Windows Zee binary at ${path.join(sourceDir, "bin", "zee.exe")}`)
}

fs.rmSync(outDir, { recursive: true, force: true })
fs.mkdirSync(generatedDir, { recursive: true })

const filePaths = walkFiles(sourceDir).sort()
fs.writeFileSync(wxsPath, renderWxs(filePaths), "utf-8")

const wix = Bun.which("wix.exe") || Bun.which("wix")
if (!wix) {
  throw new Error("WiX Toolset not found. Install WiX v4+ and ensure wix.exe is on PATH.")
}

await $`${wix} build ${wxsPath} -arch x64 -d ProductVersion=${version} -out ${msiPath}`

const digest = sha256(msiPath)
fs.writeFileSync(shaPath, `${digest}  ${path.basename(msiPath)}\n`, "utf-8")
await $`bun run script/winget-manifest.ts`.cwd(packageRoot)

console.log(
  JSON.stringify(
    {
      version,
      sourceDir,
      msi: msiPath,
      sha256: digest,
    },
    null,
    2,
  ),
)
