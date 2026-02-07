import fs from "node:fs";
import { migrateLegacyCronPayload } from "../payload-migration.js";
import * as cronStoreFile from "../store.js";
import type { CronJob } from "../types.js";
import { recomputeNextRuns } from "./jobs.js";
import { inferLegacyName, normalizeOptionalText } from "./normalize.js";
import type { CronServiceState } from "./state.js";

type EnsureLoadedOptions = {
  forceReload?: boolean;
  skipRecompute?: boolean;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getStoreMtimeMs(storePath: string): number | undefined {
  try {
    const st = fs.statSync(storePath);
    return st.mtimeMs;
  } catch {
    return undefined;
  }
}

export async function ensureLoaded(state: CronServiceState, opts?: EnsureLoadedOptions) {
  const forceReload = opts?.forceReload === true;
  const skipRecompute = opts?.skipRecompute === true;

  const mtimeMs = getStoreMtimeMs(state.deps.storePath);

  if (state.store) {
    // Even when forceReload is requested, avoid re-reading the store if it hasn't changed on disk.
    if (typeof state.lastLoadedMtimeMs === "number" && mtimeMs === state.lastLoadedMtimeMs) {
      return;
    }
    if (state.lastLoadedMtimeMs === undefined && mtimeMs === undefined) {
      return;
    }
  }

  const loaded = await cronStoreFile.loadCronStore(state.deps.storePath);
  const jobs = (loaded.jobs ?? []) as unknown as Array<Record<string, unknown>>;
  let mutated = false;
  for (const raw of jobs) {
    // Back-compat: older cron store files may omit the state object.
    if (!isRecord(raw.state)) {
      raw.state = {};
      mutated = true;
    }

    const nameRaw = raw.name;
    if (typeof nameRaw !== "string" || nameRaw.trim().length === 0) {
      raw.name = inferLegacyName({
        schedule: raw.schedule as never,
        payload: raw.payload as never,
      });
      mutated = true;
    } else {
      raw.name = nameRaw.trim();
    }

    const desc = normalizeOptionalText(raw.description);
    if (raw.description !== desc) {
      raw.description = desc;
      mutated = true;
    }

    const payload = raw.payload;
    if (payload && typeof payload === "object" && !Array.isArray(payload)) {
      if (migrateLegacyCronPayload(payload as Record<string, unknown>)) {
        mutated = true;
      }
    }

    // Normalize schedules coming from JSON/JSON5.
    const schedule = raw.schedule;
    if (isRecord(schedule)) {
      const kind = typeof schedule.kind === "string" ? schedule.kind : "";
      if (kind === "at") {
        const atMsRaw = schedule.atMs;
        if (typeof atMsRaw === "string") {
          const parsed = Number(atMsRaw);
          if (Number.isFinite(parsed)) {
            schedule.atMs = parsed;
            mutated = true;
          }
        }
      }
      if (kind === "every") {
        const anchorRaw = schedule.anchorMs;
        if (typeof anchorRaw !== "number") {
          const createdAtMs = typeof raw.createdAtMs === "number" ? raw.createdAtMs : undefined;
          const updatedAtMs = typeof raw.updatedAtMs === "number" ? raw.updatedAtMs : undefined;
          const inferred = createdAtMs ?? updatedAtMs;
          if (typeof inferred === "number" && Number.isFinite(inferred)) {
            schedule.anchorMs = inferred;
            mutated = true;
          }
        }
      }
    }

    // Back-compat: older job specs had delivery fields at the job root.
    const legacyDeliver = raw.deliver;
    const legacyChannel = raw.channel;
    const legacyTo = raw.to;
    if (legacyDeliver !== undefined || legacyChannel !== undefined || legacyTo !== undefined) {
      const delivery = isRecord(raw.delivery) ? { ...raw.delivery } : {};
      if (legacyDeliver !== undefined && delivery.deliver === undefined) delivery.deliver = legacyDeliver;
      if (legacyChannel !== undefined && delivery.channel === undefined) delivery.channel = legacyChannel;
      if (legacyTo !== undefined && delivery.to === undefined) delivery.to = legacyTo;
      raw.delivery = delivery;
      delete raw.deliver;
      delete raw.channel;
      delete raw.to;
      mutated = true;
    }
  }
  state.store = { version: 1, jobs: jobs as unknown as CronJob[] };
  state.lastLoadedMtimeMs = getStoreMtimeMs(state.deps.storePath);

  if (!skipRecompute) {
    recomputeNextRuns(state);
  }

  if (mutated) {
    await persist(state);
  }
}

export function warnIfDisabled(state: CronServiceState, action: string) {
  if (state.deps.cronEnabled) return;
  if (state.warnedDisabled) return;
  state.warnedDisabled = true;
  state.deps.log.warn(
    { enabled: false, action, storePath: state.deps.storePath },
    "cron: scheduler disabled; jobs will not run automatically",
  );
}

export async function persist(state: CronServiceState) {
  if (!state.store) return;
  await cronStoreFile.saveCronStore(state.deps.storePath, state.store);
  state.lastLoadedMtimeMs = getStoreMtimeMs(state.deps.storePath);
}
