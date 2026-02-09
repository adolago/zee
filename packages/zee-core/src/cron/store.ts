// JSON file store for cron jobs.

import fs from "fs/promises"
import path from "path"
import os from "os"
import type { CronStoreFile } from "./types"
import { Global } from "../global"

export const DEFAULT_CRON_DIR = path.join(Global.Path.config, "cron")
export const DEFAULT_CRON_STORE_PATH = path.join(DEFAULT_CRON_DIR, "jobs.json")

export function resolveCronStorePath(storePath?: string): string {
  if (storePath?.trim()) {
    const raw = storePath.trim()
    if (raw.startsWith("~")) {
      return path.resolve(raw.replace("~", os.homedir()))
    }
    return path.resolve(raw)
  }
  return DEFAULT_CRON_STORE_PATH
}

export async function loadCronStore(storePath: string): Promise<CronStoreFile> {
  try {
    const raw = await fs.readFile(storePath, "utf-8")
    const parsed = JSON.parse(raw)
    const jobs = Array.isArray(parsed?.jobs) ? parsed.jobs : []
    return {
      version: 1,
      jobs: jobs.filter(Boolean),
    }
  } catch {
    return { version: 1, jobs: [] }
  }
}

export async function saveCronStore(storePath: string, store: CronStoreFile): Promise<void> {
  await fs.mkdir(path.dirname(storePath), { recursive: true })
  const tmp = `${storePath}.${process.pid}.${Math.random().toString(16).slice(2)}.tmp`
  const json = JSON.stringify(store, null, 2)
  await fs.writeFile(tmp, json, "utf-8")
  await fs.rename(tmp, storePath)
  try {
    await fs.copyFile(storePath, `${storePath}.bak`)
  } catch {
    // best-effort backup
  }
}
