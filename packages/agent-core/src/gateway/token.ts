import fs from "node:fs/promises"
import path from "node:path"
import { Global } from "@/global"
import { Filesystem } from "@/util/filesystem"

type Logger = {
  warn: (message: string, extra?: Record<string, unknown>) => void
}

const DEFAULT_TOKEN_FILENAME = "zee_gateway_token"

function resolveDefaultTokenPath(): string {
  return path.join(Global.Path.state, DEFAULT_TOKEN_FILENAME)
}

function isPosix(): boolean {
  return process.platform !== "win32"
}

function isSafeTokenMode(mode: number): boolean {
  // Allow 0600 or 0400. Disallow any group/other permissions.
  const perms = mode & 0o777
  if (perms === 0o600) return true
  if (perms === 0o400) return true
  return false
}

async function readTokenFileIfSafe(filepath: string, options?: { log?: Logger }): Promise<string | undefined> {
  const safe = Filesystem.sanitizePath(filepath)
  const absolute = path.resolve(safe)

  let lst: import("node:fs").Stats
  try {
    lst = await fs.lstat(absolute)
  } catch {
    return undefined
  }

  if (lst.isSymbolicLink()) {
    options?.log?.warn("Ignoring Zee gateway token file because it is a symlink.", { path: absolute })
    return undefined
  }
  if (!lst.isFile()) return undefined

  if (isPosix()) {
    const uid = typeof process.getuid === "function" ? process.getuid() : undefined
    if (uid !== undefined && lst.uid !== uid) {
      options?.log?.warn("Ignoring Zee gateway token file because it is not owned by the current user.", {
        path: absolute,
        uid: lst.uid,
      })
      return undefined
    }

    if (!isSafeTokenMode(lst.mode)) {
      options?.log?.warn("Ignoring Zee gateway token file because it has unsafe permissions (expected 0600).", {
        path: absolute,
        mode: (lst.mode & 0o777).toString(8),
      })
      return undefined
    }
  }

  const text = await fs.readFile(absolute, "utf-8").catch(() => "")
  const token = text.trim()
  return token.length > 0 ? token : undefined
}

export async function readZeeGatewayTokenFromFile(options?: {
  env?: NodeJS.ProcessEnv
  log?: Logger
}): Promise<string | undefined> {
  const env = options?.env ?? process.env
  const override = env.ZEE_GATEWAY_TOKEN_FILE?.trim()
  const candidates = override ? [override] : [resolveDefaultTokenPath()]

  for (const candidate of candidates) {
    const token = await readTokenFileIfSafe(candidate, { log: options?.log })
    if (token) return token
  }

  return undefined
}
