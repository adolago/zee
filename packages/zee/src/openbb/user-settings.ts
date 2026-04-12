import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { Global } from "../global"
import type { ZeeWindowsScope } from "../global/dirs"

export type OpenBBCredentialWrite = {
  key: string
  value: string
}

export function resolveOpenBBUserSettingsPath(scope: ZeeWindowsScope = "user"): string {
  if (process.platform === "win32" && scope === "machine") {
    return path.join(Global.Path.data, "openbb", "user_settings.json")
  }
  return path.join(os.homedir(), ".openbb_platform", "user_settings.json")
}

export async function writeOpenBBCredentials(
  credentials: OpenBBCredentialWrite[],
  options: {
    scope?: ZeeWindowsScope
    dryRun?: boolean
  } = {},
): Promise<{ path: string; keys: string[]; written: boolean }> {
  const filePath = resolveOpenBBUserSettingsPath(options.scope ?? "user")
  const keys = credentials.map((credential) => credential.key)
  if (options.dryRun || credentials.length === 0) {
    return { path: filePath, keys, written: false }
  }

  let data: Record<string, unknown> = {}
  try {
    data = JSON.parse(await fs.readFile(filePath, "utf-8")) as Record<string, unknown>
  } catch {
    data = {}
  }

  const existingCredentials =
    typeof data.credentials === "object" && data.credentials !== null
      ? (data.credentials as Record<string, unknown>)
      : {}

  const nextCredentials = { ...existingCredentials }
  for (const credential of credentials) {
    nextCredentials[credential.key] = credential.value
  }

  const next = {
    ...data,
    credentials: nextCredentials,
  }

  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, JSON.stringify(next, null, 2) + "\n", "utf-8")
  await fs.chmod(filePath, 0o600).catch(() => {})
  return { path: filePath, keys, written: true }
}
