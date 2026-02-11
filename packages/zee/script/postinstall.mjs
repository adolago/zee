#!/usr/bin/env node

import fs from "fs"
import path from "path"
import os from "os"
import { fileURLToPath } from "url"
import { createRequire } from "module"
import { execSync } from "child_process"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)

function detectPlatformAndArch() {
  // Map platform names
  let platform
  switch (os.platform()) {
    case "linux":
      platform = "linux"
      break
    case "win32":
      platform = "windows"
      break
    default:
      return null
  }

  // Map architecture names
  let arch
  switch (os.arch()) {
    case "x64":
      arch = "x64"
      break
    case "arm64":
      arch = "arm64"
      break
    case "arm":
      arch = "arm"
      break
    default:
      arch = os.arch()
      break
  }

  // Detect musl vs glibc on Linux
  let libc = ""
  if (platform === "linux") {
    try {
      const lddVersion = execSync("ldd --version 2>&1", { encoding: "utf8" })
      if (lddVersion.toLowerCase().includes("musl")) {
        libc = "-musl"
      }
    } catch (e) {
      // ldd failed, try alternative detection
      try {
        const muslFiles = fs.readdirSync("/lib").filter((f) => f.startsWith("ld-musl-"))
        if (muslFiles.length > 0) {
          libc = "-musl"
        }
      } catch (e) {
        // Ignore, default to glibc
      }
    }
  }

  return { platform, arch, libc }
}

function resolvePackageScope() {
  try {
    const pkgRaw = fs.readFileSync(path.join(__dirname, "package.json"), "utf8")
    const pkg = JSON.parse(pkgRaw)
    if (typeof pkg.name === "string" && pkg.name.startsWith("@")) {
      return pkg.name.split("/")[0]
    }
  } catch {}
  return null
}

function findBinary() {
  const detected = detectPlatformAndArch()
  if (!detected) {
    throw new Error(`Unsupported platform: ${os.platform()}`)
  }
  const { platform, arch, libc } = detected
  const baseName = `zee-${platform}-${arch}${libc}`
  const scope = resolvePackageScope()
  const packageNames = [scope ? `${scope}/${baseName}` : null, baseName].filter(Boolean)
  const binaryName = platform === "windows" ? "zee.exe" : "zee"

  for (const packageName of packageNames) {
    try {
      // Use require.resolve to find the package
      const packageJsonPath = require.resolve(`${packageName}/package.json`)
      const packageDir = path.dirname(packageJsonPath)
      const binaryPath = path.join(packageDir, "bin", binaryName)

      if (!fs.existsSync(binaryPath)) {
        throw new Error(`Binary not found at ${binaryPath}`)
      }

      return { binaryPath, binaryName }
    } catch {
      continue
    }
  }

  const label = packageNames.join(" or ")
  throw new Error(`Could not find package ${label}`)
}

function prepareBinDirectory(binaryName) {
  const binDir = path.join(__dirname, "bin")
  const targetPath = path.join(binDir, binaryName)

  // Ensure bin directory exists
  if (!fs.existsSync(binDir)) {
    fs.mkdirSync(binDir, { recursive: true })
  }

  // Remove existing binary/symlink if it exists
  if (fs.existsSync(targetPath)) {
    fs.unlinkSync(targetPath)
  }

  return { binDir, targetPath }
}

function symlinkBinary(sourcePath, binaryName) {
  const { targetPath } = prepareBinDirectory(binaryName)

  fs.symlinkSync(sourcePath, targetPath)
  console.log(`zee binary symlinked: ${targetPath} -> ${sourcePath}`)

  // Verify the file exists after operation
  if (!fs.existsSync(targetPath)) {
    throw new Error(`Failed to symlink binary to ${targetPath}`)
  }
}

async function main() {
  try {
    if (os.platform() === "win32") {
      // On Windows, the .exe is already included in the package and bin field points to it
      // No postinstall setup needed
      console.log("Windows detected: binary setup not needed (using packaged .exe)")
      return
    }

    // On non-Windows platforms, just verify the binary package exists
    // Don't replace the wrapper script - it handles binary execution
    const { binaryPath } = findBinary()
    console.log(`Platform binary verified at: ${binaryPath}`)
    console.log("Wrapper script will handle binary execution")
  } catch (error) {
    console.error("Failed to setup zee binary:", error.message)
    process.exit(1)
  }
}

try {
  main()
} catch (error) {
  console.error("Postinstall script error:", error.message)
  process.exit(0)
}
