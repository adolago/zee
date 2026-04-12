#!/usr/bin/env bun

import fs from "fs"
import os from "os"
import path from "path"
import { fileURLToPath } from "url"

import pkg from "../package.json"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

export const packagesZeeDir = path.resolve(__dirname, "..")

export type LocalBinaryInfo = {
  hostPlatform: NodeJS.Platform
  packagePlatform: string
  arch: string
  binaryName: string
  distRoot: string
  binaryPath: string
  bunBinDir: string
  linkPath: string
  cmdPath: string
  ps1Path: string
  exeShimPath: string
}

function resolvePackagePlatform(platform: NodeJS.Platform): string {
  switch (platform) {
    case "win32":
      return "windows"
    default:
      return platform
  }
}

export function resolveLocalBinaryInfo(): LocalBinaryInfo {
  const hostPlatform = process.platform
  const packagePlatform = resolvePackagePlatform(hostPlatform)
  const arch = process.arch
  const binaryName = hostPlatform === "win32" ? "zee.exe" : "zee"
  const distRoot = path.join(packagesZeeDir, "dist", `${pkg.name}-${packagePlatform}-${arch}`)
  const bunInstall = process.env.BUN_INSTALL?.trim() || path.join(os.homedir(), ".bun")
  const bunBinDir = path.join(bunInstall, "bin")

  return {
    hostPlatform,
    packagePlatform,
    arch,
    binaryName,
    distRoot,
    binaryPath: path.join(distRoot, "bin", binaryName),
    bunBinDir,
    linkPath: path.join(bunBinDir, "zee"),
    cmdPath: path.join(bunBinDir, "zee.cmd"),
    ps1Path: path.join(bunBinDir, "zee.ps1"),
    exeShimPath: path.join(bunBinDir, "zee.exe"),
  }
}

export function removePathIfExists(filepath: string) {
  try {
    fs.rmSync(filepath, { force: true })
  } catch {}
}

export function getNewestSourceMtimeMs(rootDir = path.join(packagesZeeDir, "src")): number {
  let newest = 0
  const queue = [rootDir]

  while (queue.length > 0) {
    const current = queue.pop()
    if (!current || !fs.existsSync(current)) continue

    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const resolved = path.join(current, entry.name)
      if (entry.isDirectory()) {
        queue.push(resolved)
        continue
      }
      if (!entry.isFile() || !resolved.endsWith(".ts")) continue
      const mtime = fs.statSync(resolved).mtimeMs
      if (mtime > newest) {
        newest = mtime
      }
    }
  }

  return newest
}

export function formatTimestamp(timestampMs: number): string {
  return new Date(timestampMs).toISOString()
}
