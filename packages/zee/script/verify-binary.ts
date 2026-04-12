#!/usr/bin/env bun

import fs from "fs"

import { formatTimestamp, getNewestSourceMtimeMs, resolveLocalBinaryInfo } from "./local-binary"

const info = resolveLocalBinaryInfo()

console.log("=== Binary Version Check ===")
console.log("")

if (!fs.existsSync(info.binaryPath)) {
  console.error("ERROR: Local binary not found")
  console.error(`  Expected binary: ${info.binaryPath}`)
  console.error("  Run: bun run build")
  process.exit(1)
}

if (info.hostPlatform === "win32") {
  if (!fs.existsSync(info.cmdPath)) {
    console.error("ERROR: PowerShell launcher not found")
    console.error(`  Expected launcher: ${info.cmdPath}`)
    console.error("  Run: bun run build")
    process.exit(1)
  }

  const launcher = fs.readFileSync(info.cmdPath, "utf8")
  if (!launcher.includes(info.binaryPath.replace(/\//g, "\\"))) {
    console.error("ERROR: PowerShell launcher does not point to the local build")
    console.error(`  Launcher: ${info.cmdPath}`)
    console.error(`  Local build: ${info.binaryPath}`)
    console.error("  Run: bun run build")
    process.exit(1)
  }

  console.log(`Installed launcher: ${info.cmdPath}`)
  console.log(`Local build:        ${info.binaryPath}`)
} else {
  if (!fs.existsSync(info.linkPath)) {
    console.error("ERROR: zee not found in PATH link location")
    console.error(`  Expected link: ${info.linkPath}`)
    console.error("  Run: bun run build")
    process.exit(1)
  }

  const resolvedBinary = fs.realpathSync(info.linkPath)
  const resolvedLocal = fs.realpathSync(info.binaryPath)

  console.log(`Installed binary: ${info.linkPath}`)
  console.log(`  -> Resolves to: ${resolvedBinary}`)
  console.log(`Local build:      ${info.binaryPath}`)

  if (resolvedBinary !== resolvedLocal) {
    console.error("")
    console.error("ERROR: Installed binary is not the local build")
    console.error("  Run: bun run build")
    process.exit(1)
  }
}

const binaryMtimeMs = fs.statSync(info.binaryPath).mtimeMs
const sourceNewestMtimeMs = getNewestSourceMtimeMs()

if (sourceNewestMtimeMs > binaryMtimeMs) {
  console.error("")
  console.error("WARNING: Source files are newer than the built binary")
  console.error(`  Source modified: ${formatTimestamp(sourceNewestMtimeMs)}`)
  console.error(`  Binary built:    ${formatTimestamp(binaryMtimeMs)}`)
  console.error("  Run: bun run build")
  process.exit(1)
}

console.log("")
console.log("Binary verified")
console.log(`  Location: ${info.binaryPath}`)
console.log(`  Built:    ${formatTimestamp(binaryMtimeMs)}`)
console.log("")
console.log("Ready to test!")
