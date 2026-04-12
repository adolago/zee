#!/usr/bin/env bun

import fs from "fs"

import { removePathIfExists, resolveLocalBinaryInfo } from "./local-binary"

const info = resolveLocalBinaryInfo()

if (!fs.existsSync(info.binaryPath)) {
  console.error(`ERROR: Built binary not found at ${info.binaryPath}`)
  console.error("Run `bun run build` first.")
  process.exit(1)
}

fs.mkdirSync(info.bunBinDir, { recursive: true })

if (info.hostPlatform === "win32") {
  removePathIfExists(info.linkPath)
  removePathIfExists(info.exeShimPath)

  const cmdBinaryPath = info.binaryPath.replace(/\//g, "\\")
  const cmdDistRoot = info.distRoot.replace(/\//g, "\\")
  const cmdContents = [
    "@echo off",
    "setlocal",
    `if \"%ZEE_ROOT%\"==\"\" set \"ZEE_ROOT=${cmdDistRoot}\"`,
    `\"${cmdBinaryPath}\" %*`,
    "exit /b %ERRORLEVEL%",
    "",
  ].join("\r\n")
  const ps1Contents = [
    `if (-not $env:ZEE_ROOT) { $env:ZEE_ROOT = ${JSON.stringify(info.distRoot)} }`,
    `& ${JSON.stringify(info.binaryPath)} @args`,
    "exit $LASTEXITCODE",
    "",
  ].join("\r\n")

  fs.writeFileSync(info.cmdPath, cmdContents)
  fs.writeFileSync(info.ps1Path, ps1Contents)

  console.log(`Created PowerShell launcher: ${info.cmdPath}`)
  console.log(`Created PowerShell helper: ${info.ps1Path}`)
  console.log(`Native binary: ${info.binaryPath}`)
  process.exit(0)
}

removePathIfExists(info.cmdPath)
removePathIfExists(info.ps1Path)
removePathIfExists(info.linkPath)
fs.symlinkSync(info.binaryPath, info.linkPath)

console.log(`Linked local binary: ${info.linkPath} -> ${info.binaryPath}`)
