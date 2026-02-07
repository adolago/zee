import { realpathSync } from "fs"
import { realpath } from "fs/promises"
import { dirname, join, relative } from "path"

export namespace Filesystem {
  export const sanitizePath = (value: string) => value.replace(/\0/g, "")
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
    try {
      // Resolve both paths to their real locations (following symlinks)
      const resolvedParent = await realpath(parent).catch(() => parent)
      const resolvedChild = await realpath(child).catch(async () => {
        // If the path doesn't exist yet (common for writes), resolve the parent directory
        // to prevent symlink escapes via directory symlinks.
        const dir = dirname(child)
        return await realpath(dir).catch(() => dir)
      })
      return !relative(resolvedParent, resolvedChild).startsWith("..")
    } catch {
      // If realpath fails (file doesn't exist yet), fall back to lexical check
      return contains(parent, child)
    }
  }

  /**
   * Synchronous version of containsResolved for cases where async isn't possible.
   */
  export function containsResolvedSync(parent: string, child: string): boolean {
    parent = sanitizePath(parent)
    child = sanitizePath(child)
    try {
      const resolvedParent = realpathSync(parent)
      const resolvedChild = (() => {
        try {
          return realpathSync(child)
        } catch {
          const dir = dirname(child)
          try {
            return realpathSync(dir)
          } catch {
            return child
          }
        }
      })()
      return !relative(resolvedParent, resolvedChild).startsWith("..")
    } catch {
      return contains(parent, child)
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
    const relA = relative(a, b)
    const relB = relative(b, a)
    return !relA || !relA.startsWith("..") || !relB || !relB.startsWith("..")
  }

  export function contains(parent: string, child: string) {
    parent = sanitizePath(parent)
    child = sanitizePath(child)
    return !relative(parent, child).startsWith("..")
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
