import { realpathSync } from "fs"
import { realpath } from "fs/promises"
import { dirname, isAbsolute, join, relative, sep, win32 } from "path"

export namespace Filesystem {
  const isContainedByRelative = (parent: string, child: string): boolean => {
    const rel = relative(parent, child)
    if (!rel) return true

    // On Windows, relative() returns an absolute path when the drives differ.
    // On non-Windows platforms, win32.isAbsolute still detects Windows-style absolute paths.
    if (isAbsolute(rel) || win32.isAbsolute(rel)) return false

    if (rel === "..") return false
    // Only treat ".." as a path segment; allow names like "..foo".
    if (rel.startsWith(`..${sep}`) || rel.startsWith("../") || rel.startsWith("..\\")) return false

    return true
  }

  export const sanitizePath = (value: string) => (value.includes("\0") ? value.replace(/\0/g, "") : value)
  export const exists = async (p: string) => {
    p = sanitizePath(p)
    const file = Bun.file(p)
    // check if it's a file (fast & async)
    // note: file.exists() returns false for directories
    if (await file.exists()) return true
    // fallback to stat for directories or to confirm non-existence
    return file
      .stat()
      .then(() => true)
      .catch(() => false)
  }

  export const isDir = (p: string) =>
    Bun.file(sanitizePath(p))
      .stat()
      .then((s) => s.isDirectory())
      .catch(() => false)
  /**
   * Check if child path is contained within parent, resolving symlinks.
   * This prevents symlink escape attacks where a symlink inside the project
   * points to a location outside the project directory.
   *
   * @returns true if the resolved child path is within the resolved parent
   */
  export async function containsResolved(parent: string, child: string): Promise<boolean> {
    parent = sanitizePath(parent)
    child = sanitizePath(child)

    // Recursively resolve realpath, walking up to the nearest existing ancestor
    const resolve = async (p: string): Promise<string> => {
      try {
        return await realpath(p)
      } catch {
        const parentDir = dirname(p)
        if (parentDir === p) return p
        const resolvedParent = await resolve(parentDir)
        return join(resolvedParent, relative(parentDir, p))
      }
    }

    try {
      const resolvedParent = await resolve(parent)
      const resolvedChild = await resolve(child)
      return isContainedByRelative(resolvedParent, resolvedChild)
    } catch {
      return false
    }
  }

  /**
   * Synchronous version of containsResolved for cases where async isn't possible.
   */
  export function containsResolvedSync(parent: string, child: string): boolean {
    parent = sanitizePath(parent)
    child = sanitizePath(child)

    const resolve = (p: string): string => {
      try {
        return realpathSync(p)
      } catch {
        const parentDir = dirname(p)
        if (parentDir === p) return p
        const resolvedParent = resolve(parentDir)
        return join(resolvedParent, relative(parentDir, p))
      }
    }

    try {
      const resolvedParent = resolve(parent)
      const resolvedChild = resolve(child)
      return isContainedByRelative(resolvedParent, resolvedChild)
    } catch {
      return false
    }
  }
  /**
   * On Windows, normalize a path to its canonical casing using the filesystem.
   * This is needed because Windows paths are case-insensitive but LSP servers
   * may return paths with different casing than what we send them.
   */
  export function normalizePath(p: string): string {
    p = sanitizePath(p)
    if (process.platform !== "win32") return p
    try {
      return realpathSync.native(p)
    } catch {
      return p
    }
  }
  export function overlaps(a: string, b: string) {
    a = sanitizePath(a)
    b = sanitizePath(b)
    return isContainedByRelative(a, b) || isContainedByRelative(b, a)
  }

  export function contains(parent: string, child: string) {
    parent = sanitizePath(parent)
    child = sanitizePath(child)
    return isContainedByRelative(parent, child)
  }

  export async function findUp(target: string, start: string, stop?: string) {
    let current = sanitizePath(start)
    const sanitizedStop = stop ? sanitizePath(stop) : undefined
    target = sanitizePath(target)
    const result = []
    while (true) {
      const search = join(current, target)
      if (await exists(search)) result.push(search)
      if (sanitizedStop === current) break
      const parent = dirname(current)
      if (parent === current) break
      current = parent
    }
    return result
  }

  export async function findFirstUp(target: string, start: string, stop?: string): Promise<string | undefined> {
    let current = sanitizePath(start)
    const sanitizedStop = stop ? sanitizePath(stop) : undefined
    target = sanitizePath(target)
    while (true) {
      const search = join(current, target)
      if (await exists(search)) return search
      if (sanitizedStop === current) break
      const parent = dirname(current)
      if (parent === current) break
      current = parent
    }
    return undefined
  }

  export async function* up(options: { targets: string[]; start: string; stop?: string }) {
    const { targets, start, stop } = options
    let current = sanitizePath(start)
    const sanitizedStop = stop ? sanitizePath(stop) : undefined
    const sanitizedTargets = targets.map((target) => sanitizePath(target))
    while (true) {
      for (const target of sanitizedTargets) {
        const search = join(current, target)
        if (await exists(search)) yield search
      }
      if (sanitizedStop === current) break
      const parent = dirname(current)
      if (parent === current) break
      current = parent
    }
  }

  export async function globUp(pattern: string, start: string, stop?: string) {
    let current = sanitizePath(start)
    const sanitizedStop = stop ? sanitizePath(stop) : undefined
    pattern = sanitizePath(pattern)
    const result = []
    while (true) {
      try {
        const glob = new Bun.Glob(pattern)
        for await (const match of glob.scan({
          cwd: current,
          absolute: true,
          onlyFiles: true,
          followSymlinks: true,
          dot: true,
        })) {
          result.push(match)
        }
      } catch {
        // Skip invalid glob patterns
      }
      if (sanitizedStop === current) break
      const parent = dirname(current)
      if (parent === current) break
      current = parent
    }
    return result
  }
}
