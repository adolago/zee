/**
 * Path Validation and Sandbox Enforcement
 *
 * Prevents path traversal attacks in tools that accept file paths.
 * Ported from Zee sandbox-paths.ts (commit 9b6fffd00a) and hardened
 * with symlink detection and configurable sandbox roots.
 *
 * Usage:
 *   import { validateToolPath, assertToolPath } from "./validate-path.js"
 *
 *   // Synchronous check (no symlink detection)
 *   const { resolved } = validateToolPath({ filePath: input, cwd })
 *
 *   // Async check (with symlink detection)
 *   const { resolved } = await assertToolPath({ filePath: input, cwd })
 *
 * @module security/validate-path
 */

import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

// ---------------------------------------------------------------------------
// Unicode normalization
// ---------------------------------------------------------------------------

const UNICODE_SPACES = /[\u00A0\u2000-\u200A\u202F\u205F\u3000]/g

function normalizeUnicodeSpaces(str: string): string {
  return str.replace(UNICODE_SPACES, " ")
}

// ---------------------------------------------------------------------------
// Path expansion
// ---------------------------------------------------------------------------

function expandPath(filePath: string): string {
  const normalized = normalizeUnicodeSpaces(filePath)
  if (normalized === "~") return os.homedir()
  if (normalized.startsWith("~/")) return os.homedir() + normalized.slice(1)
  return normalized
}

function resolveToCwd(filePath: string, cwd: string): string {
  const expanded = expandPath(filePath)
  if (path.isAbsolute(expanded)) return expanded
  return path.resolve(cwd, expanded)
}

// ---------------------------------------------------------------------------
// Dangerous path patterns
// ---------------------------------------------------------------------------

/**
 * Paths that should never be accepted as tool input regardless of sandbox root.
 * These are sensitive system directories and credential stores.
 */
const BLOCKED_PREFIXES: readonly string[] = ["/etc/shadow", "/etc/passwd", "/etc/sudoers", "/proc/", "/sys/"]

/**
 * Sensitive directories within the user's home that require extra caution.
 * Tools should not read/write these unless explicitly allowed.
 */
const SENSITIVE_HOME_DIRS: readonly string[] = [".ssh", ".gnupg", ".config/gcloud", ".aws/credentials", ".netrc"]

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface PathValidationResult {
  /** Absolute resolved path */
  resolved: string
  /** Path relative to the sandbox root (empty string if path equals root) */
  relative: string
}

export interface PathValidationOptions {
  /** The file path provided by the user or agent */
  filePath: string
  /** Current working directory for resolving relative paths */
  cwd: string
  /**
   * Sandbox root directory. Paths must resolve within this directory.
   * Defaults to the user's home directory if not specified.
   */
  root?: string
  /**
   * Additional blocked path prefixes beyond the defaults.
   */
  blockedPrefixes?: string[]
  /**
   * If true, allow paths outside the sandbox root. Only block
   * absolute system-sensitive paths. Use for tools where the user
   * explicitly controls file selection.
   */
  permissive?: boolean
}

/**
 * Validates that a file path does not escape the sandbox root and does not
 * target sensitive system paths.
 *
 * Throws if the path is blocked or escapes the sandbox.
 */
export function validateToolPath(options: PathValidationOptions): PathValidationResult {
  const { filePath, cwd, root = os.homedir(), blockedPrefixes = [], permissive = false } = options

  if (!filePath || !filePath.trim()) {
    throw new PathValidationError("Empty file path")
  }

  const resolved = resolveToCwd(filePath, cwd)

  // Check absolute blocked paths (always enforced)
  const allBlocked = [...BLOCKED_PREFIXES, ...blockedPrefixes]
  for (const prefix of allBlocked) {
    if (resolved === prefix || resolved.startsWith(prefix)) {
      throw new PathValidationError(`Access denied: path targets a sensitive system location: ${filePath}`)
    }
  }

  // Check sensitive home directories
  const home = os.homedir()
  for (const dir of SENSITIVE_HOME_DIRS) {
    const sensitive = path.join(home, dir)
    if (resolved === sensitive || resolved.startsWith(sensitive + path.sep)) {
      throw new PathValidationError(`Access denied: path targets sensitive credentials: ${filePath}`)
    }
  }

  if (permissive) {
    return { resolved, relative: path.relative(root, resolved) }
  }

  // Sandbox enforcement: path must be within root
  const rootResolved = path.resolve(root)
  const relative = path.relative(rootResolved, resolved)

  if (!relative || relative === "") {
    return { resolved, relative: "" }
  }

  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new PathValidationError(`Path escapes sandbox root (${shortPath(rootResolved)}): ${filePath}`)
  }

  return { resolved, relative }
}

/**
 * Async version that also checks for symlink-based escape attacks.
 * Each path component is verified to not be a symlink that could
 * redirect to a location outside the sandbox.
 */
export async function assertToolPath(options: PathValidationOptions): Promise<PathValidationResult> {
  const result = validateToolPath(options)

  if (!options.permissive) {
    const rootResolved = path.resolve(options.root ?? os.homedir())
    await assertNoSymlinkEscape(result.relative, rootResolved)
  }

  return result
}

/**
 * Convenience validator for media URLs that may be file paths.
 * Returns null if the input is a remote URL (http/https), or validates
 * the path if it looks like a local file reference.
 */
export function validateMediaPath(
  mediaUrl: string,
  options: Omit<PathValidationOptions, "filePath">,
): PathValidationResult | null {
  const trimmed = mediaUrl.trim()
  if (!trimmed) return null

  // Remote URLs are not file paths
  if (/^https?:\/\//i.test(trimmed)) return null
  // Data URIs are not file paths
  if (trimmed.startsWith("data:")) return null

  // Treat as local file path
  return validateToolPath({ ...options, filePath: trimmed })
}

// ---------------------------------------------------------------------------
// Symlink detection
// ---------------------------------------------------------------------------

async function assertNoSymlinkEscape(relative: string, root: string): Promise<void> {
  if (!relative) return

  const parts = relative.split(path.sep).filter(Boolean)
  let current = root

  for (const part of parts) {
    current = path.join(current, part)
    try {
      const stat = await fs.lstat(current)
      if (stat.isSymbolicLink()) {
        throw new PathValidationError(`Symlink not allowed in sandbox path: ${current}`)
      }
    } catch (err) {
      if ((err as { code?: string }).code === "ENOENT") return
      throw err
    }
  }

  // Block hardlinked regular files to prevent alias escapes from outside the sandbox.
  try {
    const stat = await fs.lstat(current)
    if (stat.isFile() && stat.nlink > 1) {
      throw new PathValidationError(`Hardlink not allowed in sandbox path: ${current}`)
    }
  } catch (err) {
    if ((err as { code?: string }).code === "ENOENT") return
    throw err
  }
}

// ---------------------------------------------------------------------------
// Error type
// ---------------------------------------------------------------------------

export class PathValidationError extends Error {
  readonly code = "PATH_VALIDATION_ERROR"

  constructor(message: string) {
    super(message)
    this.name = "PathValidationError"
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function shortPath(value: string): string {
  const home = os.homedir()
  if (value.startsWith(home)) return `~${value.slice(home.length)}`
  return value
}
