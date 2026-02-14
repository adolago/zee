import fs from "node:fs/promises"
import path from "node:path"
import { resolveStateDir } from "../global/dirs"

export const RUN_MODES = ["plan", "build", "review"] as const
export type RunMode = (typeof RUN_MODES)[number]

const RUN_MODE_FILE = path.join(resolveStateDir(), "run-mode.json")

function isRunMode(value: unknown): value is RunMode {
  return typeof value === "string" && (RUN_MODES as readonly string[]).includes(value)
}

export function parseRunMode(value: unknown): RunMode | undefined {
  if (!isRunMode(value)) return undefined
  return value
}

export function defaultRunMode(): RunMode {
  return "build"
}

export async function getSavedRunMode(): Promise<RunMode | undefined> {
  try {
    const raw = await fs.readFile(RUN_MODE_FILE, "utf-8")
    const parsed = JSON.parse(raw) as { mode?: unknown }
    return parseRunMode(parsed.mode)
  } catch {
    return undefined
  }
}

export async function setSavedRunMode(mode: RunMode): Promise<string> {
  const payload = {
    mode,
    updatedAt: new Date().toISOString(),
  }
  await fs.mkdir(path.dirname(RUN_MODE_FILE), { recursive: true })
  await fs.writeFile(RUN_MODE_FILE, JSON.stringify(payload, null, 2) + "\n", "utf-8")
  return RUN_MODE_FILE
}

export async function resolveRunMode(explicitMode?: string): Promise<RunMode> {
  if (explicitMode !== undefined) {
    const parsed = parseRunMode(explicitMode)
    if (!parsed) {
      throw new Error(`Invalid run mode \"${explicitMode}\" (use: ${RUN_MODES.join("|")})`)
    }
    return parsed
  }

  return (await getSavedRunMode()) ?? defaultRunMode()
}
