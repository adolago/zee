// Cron job store loading and persistence (service-level).

import type { CronJob } from "../types"
import type { CronServiceState } from "./state"
import { loadCronStore, saveCronStore } from "../store"
import { inferLegacyName, normalizeOptionalText } from "../normalize"

const storeCache = new Map<string, { version: 1; jobs: CronJob[] }>()

export async function ensureLoaded(state: CronServiceState) {
  if (state.store) {
    return
  }
  const cached = storeCache.get(state.deps.storePath)
  if (cached) {
    state.store = cached
    return
  }
  const loaded = await loadCronStore(state.deps.storePath)
  const jobs = (loaded.jobs ?? []) as unknown as Array<Record<string, unknown>>
  let mutated = false
  for (const raw of jobs) {
    const nameRaw = raw.name
    if (typeof nameRaw !== "string" || nameRaw.trim().length === 0) {
      raw.name = inferLegacyName({
        schedule: raw.schedule as never,
        payload: raw.payload as never,
      })
      mutated = true
    } else {
      raw.name = nameRaw.trim()
    }

    const desc = normalizeOptionalText(raw.description)
    if (raw.description !== desc) {
      raw.description = desc
      mutated = true
    }
  }
  state.store = { version: 1, jobs: jobs as unknown as CronJob[] }
  storeCache.set(state.deps.storePath, state.store)
  if (mutated) {
    await persist(state)
  }
}

export function warnIfDisabled(state: CronServiceState, action: string) {
  if (state.deps.cronEnabled) {
    return
  }
  if (state.warnedDisabled) {
    return
  }
  state.warnedDisabled = true
  state.deps.log.warn("cron: scheduler disabled; jobs will not run automatically", {
    enabled: false,
    action,
    storePath: state.deps.storePath,
  })
}

export async function persist(state: CronServiceState) {
  if (!state.store) {
    return
  }
  await saveCronStore(state.deps.storePath, state.store)
}
