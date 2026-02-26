/**
 * Path Validation and Sandbox Enforcement (MCP)
 *
 * Prevents path traversal attacks in MCP tools that accept file paths.
 * Enforces that paths resolve within a sandbox root, blocks sensitive system
 * locations, and guards against symlink-based sandbox escapes.
 */

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

// ---------------------------------------------------------------------------
// Unicode normalization
// ---------------------------------------------------------------------------

const UNICODE_SPACES = /[\u00A0\u2000-\u200A\u202F\u205F\u3000]/g;

function normalizeUnicodeSpaces(str: string): string {
  return str.replace(UNICODE_SPACES, ' ');
}

// ---------------------------------------------------------------------------
// Path expansion + resolution
// ---------------------------------------------------------------------------

function expandPath(filePath: string): string {
  const normalized = normalizeUnicodeSpaces(filePath);
  if (normalized === '~') return os.homedir();
  if (normalized.startsWith('~/')) return os.homedir() + normalized.slice(1);
  return normalized;
}

function resolveToCwd(filePath: string, cwd: string): string {
  const expanded = expandPath(filePath);
  if (path.isAbsolute(expanded)) return expanded;
  return path.resolve(cwd, expanded);
}

// ---------------------------------------------------------------------------
// Dangerous path patterns
// ---------------------------------------------------------------------------

/**
 * Paths that should never be accepted as tool input regardless of sandbox root.
 * These are sensitive system directories and credential stores.
 */
const BLOCKED_PREFIXES: readonly string[] = [
  '/etc/shadow',
  '/etc/passwd',
  '/etc/sudoers',
  '/proc/',
  '/sys/',
];

/**
 * Sensitive directories within the user's home that require extra caution.
 */
const SENSITIVE_HOME_DIRS: readonly string[] = [
  '.ssh',
  '.gnupg',
  '.config/gcloud',
  '.aws/credentials',
  '.netrc',
];

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface PathValidationResult {
  /** Absolute resolved path */
  resolved: string;
  /** Path relative to the sandbox root (empty string if path equals root) */
  relative: string;
}

export interface PathValidationOptions {
  /** The file path provided by the user or agent */
  filePath: string;
  /** Current working directory for resolving relative paths */
  cwd: string;
  /**
   * Sandbox root directory. Paths must resolve within this directory.
   * Defaults to `cwd` if not specified.
   */
  root?: string;
  /** Additional blocked path prefixes beyond the defaults */
  blockedPrefixes?: string[];
  /**
   * If true, allow paths outside the sandbox root. Only block absolute
   * system-sensitive paths. Use only when the user explicitly selects a path.
   */
  permissive?: boolean;
}

export class PathValidationError extends Error {
  readonly code = 'PATH_VALIDATION_ERROR';

  constructor(message: string) {
    super(message);
    this.name = 'PathValidationError';
  }
}

/**
 * Validate that a tool path does not escape the sandbox root and does not
 * target sensitive system paths.
 *
 * This is a synchronous, lexical check. For symlink-aware enforcement, use
 * `assertToolPath`.
 */
export function validateToolPath(options: PathValidationOptions): PathValidationResult {
  const { filePath, cwd, root = cwd, blockedPrefixes = [], permissive = false } = options;

  if (!filePath || !filePath.trim()) {
    throw new PathValidationError('Empty file path');
  }

  const resolved = resolveToCwd(filePath, cwd);

  // Check absolute blocked paths (always enforced)
  const allBlocked = [...BLOCKED_PREFIXES, ...blockedPrefixes];
  for (const prefix of allBlocked) {
    if (resolved === prefix || resolved.startsWith(prefix)) {
      throw new PathValidationError(`Access denied: path targets a sensitive system location: ${filePath}`);
    }
  }

  // Check sensitive home directories
  const home = os.homedir();
  for (const dir of SENSITIVE_HOME_DIRS) {
    const sensitive = path.join(home, dir);
    if (resolved === sensitive || resolved.startsWith(sensitive + path.sep)) {
      throw new PathValidationError(`Access denied: path targets sensitive credentials: ${filePath}`);
    }
  }

  const rootResolved = path.resolve(root);
  const relative = path.relative(rootResolved, resolved);

  if (permissive) {
    return { resolved, relative };
  }

  if (!relative || relative === '') {
    return { resolved, relative: '' };
  }

  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new PathValidationError(`Path escapes sandbox root (${shortPath(rootResolved)}): ${filePath}`);
  }

  return { resolved, relative };
}

/**
 * Async version that also checks for symlink-based escape attacks.
 *
 * For non-existent paths (common for writes), the closest existing ancestor is
 * realpath-checked to ensure no existing symlink redirects outside the root.
 */
export async function assertToolPath(options: PathValidationOptions): Promise<PathValidationResult> {
  const result = validateToolPath(options);

  if (!options.permissive) {
    const rootResolved = path.resolve(options.root ?? options.cwd);
    await assertNoSymlinkEscape(result.resolved, rootResolved);
    await assertNoHardlinkAlias(result.resolved);
  }

  return result;
}

// ---------------------------------------------------------------------------
// Symlink escape detection
// ---------------------------------------------------------------------------

async function assertNoSymlinkEscape(targetPath: string, rootResolved: string): Promise<void> {
  const rootReal = await fs.realpath(rootResolved).catch(() => rootResolved);

  const existing = await closestExistingAncestor(targetPath);
  const existingReal = await fs.realpath(existing).catch(() => existing);

  const rel = path.relative(rootReal, existingReal);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new PathValidationError(
      `Path resolves outside sandbox root (${shortPath(rootReal)}): ${targetPath}`,
    );
  }
}

async function assertNoHardlinkAlias(targetPath: string): Promise<void> {
  const stat = await fs.lstat(targetPath).catch((err) => {
    if ((err as { code?: string }).code === "ENOENT") return undefined;
    throw err;
  });
  if (!stat) return;
  if (stat.isFile() && stat.nlink > 1) {
    throw new PathValidationError(`Hardlink not allowed in sandbox path: ${targetPath}`);
  }
}

async function closestExistingAncestor(p: string): Promise<string> {
  let current = p;
  for (;;) {
    try {
      await fs.lstat(current);
      return current;
    } catch (err) {
      if ((err as { code?: string }).code !== 'ENOENT') throw err;
    }

    const parent = path.dirname(current);
    if (parent === current) return current;
    current = parent;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function shortPath(value: string): string {
  const home = os.homedir();
  if (value.startsWith(home)) return `~${value.slice(home.length)}`;
  return value;
}
