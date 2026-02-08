import fs from "node:fs";
import type { CronJob } from "../types.js";
import type { CronServiceState } from "./state.js";
import { parseAbsoluteTimeMs } from "../parse.js";
import { migrateLegacyCronPayload } from "../payload-migration.js";
import { loadCronStore, saveCronStore } from "../store.js";
import { recomputeNextRuns } from "./jobs.js";
import { inferLegacyName, normalizeOptionalText } from "./normalize.js";

function hasLegacyDeliveryHints(payload: Record<string, unknown>) {
  if (typeof payload.deliver === "boolean") {
    return true;
  }
  if (typeof payload.bestEffortDeliver === "boolean") {
    return true;
  }
  if (typeof payload.to === "string" && payload.to.trim()) {
    return true;
  }
  return false;
}

function buildDeliveryFromLegacyPayload(payload: Record<string, unknown>) {
  const deliver = payload.deliver;
  const mode = deliver === false ? "none" : "announce";
  const channelRaw =
    typeof payload.channel === "string" ? payload.channel.trim().toLowerCase() : "";
  const toRaw = typeof payload.to === "string" ? payload.to.trim() : "";
  const next: Record<string, unknown> = { mode };
  if (channelRaw) {
    next.channel = channelRaw;
  }
  if (toRaw) {
    next.to = toRaw;
  }
  if (typeof payload.bestEffortDeliver === "boolean") {
    next.bestEffort = payload.bestEffortDeliver;
  }
  return next;
}

function buildDeliveryPatchFromLegacyPayload(payload: Record<string, unknown>) {
  const deliver = payload.deliver;
  const channelRaw =
    typeof payload.channel === "string" ? payload.channel.trim().toLowerCase() : "";
  const toRaw = typeof payload.to === "string" ? payload.to.trim() : "";
  const next: Record<string, unknown> = {};
  let hasPatch = false;

  if (deliver === false) {
    next.mode = "none";
    hasPatch = true;
  } else if (deliver === true || toRaw) {
    next.mode = "announce";
    hasPatch = true;
  }
  if (channelRaw) {
    next.channel = channelRaw;
    hasPatch = true;
  }
  if (toRaw) {
    next.to = toRaw;
    hasPatch = true;
  }
  if (typeof payload.bestEffortDeliver === "boolean") {
    next.bestEffort = payload.bestEffortDeliver;
    hasPatch = true;
  }

  return hasPatch ? next : null;
}

function mergeLegacyDeliveryInto(
  delivery: Record<string, unknown>,
  payload: Record<string, unknown>,
) {
  const patch = buildDeliveryPatchFromLegacyPayload(payload);
  if (!patch) {
    return { delivery, mutated: false };
  }

  const next = { ...delivery };
  let mutated = false;

  if ("mode" in patch && patch.mode !== next.mode) {
    next.mode = patch.mode;
    mutated = true;
  }
  if ("channel" in patch && patch.channel !== next.channel) {
    next.channel = patch.channel;
    mutated = true;
  }
  if ("to" in patch && patch.to !== next.to) {
    next.to = patch.to;
    mutated = true;
  }
  if ("bestEffort" in patch && patch.bestEffort !== next.bestEffort) {
    next.bestEffort = patch.bestEffort;
    mutated = true;
  }

  return { delivery: next, mutated };
}

function stripLegacyDeliveryFields(payload: Record<string, unknown>) {
  if ("deliver" in payload) {
    delete payload.deliver;
  }
  if ("channel" in payload) {
    delete payload.channel;
  }
  if ("to" in payload) {
    delete payload.to;
  }
  if ("bestEffortDeliver" in payload) {
    delete payload.bestEffortDeliver;
  }
}

function normalizePayloadKind(payload: Record<string, unknown>) {
  const raw = typeof payload.kind === "string" ? payload.kind.trim().toLowerCase() : "";
  if (raw === "agentturn") {
    payload.kind = "agentTurn";
    return true;
  }
  if (raw === "systemevent") {
    payload.kind = "systemEvent";
    return true;
  }
  return false;
}

function inferPayloadIfMissing(raw: Record<string, unknown>) {
  const message = typeof raw.message === "string" ? raw.message.trim() : "";
  const text = typeof raw.text === "string" ? raw.text.trim() : "";
  if (message) {
    raw.payload = { kind: "agentTurn", message };
    return true;
  }
  if (text) {
    raw.payload = { kind: "systemEvent", text };
    return true;
  }
  return false;
}

function copyTopLevelAgentTurnFields(
  raw: Record<string, unknown>,
  payload: Record<string, unknown>,
) {
  let mutated = false;

  const copyTrimmedString = (field: "model" | "thinking") => {
    const existing = payload[field];
    if (typeof existing === "string" && existing.trim()) {
      return;
    }
    const value = raw[field];
    if (typeof value === "string" && value.trim()) {
      payload[field] = value.trim();
      mutated = true;
    }
  };
  copyTrimmedString("model");
  copyTrimmedString("thinking");

  if (
    typeof payload.timeoutSeconds !== "number" &&
    typeof raw.timeoutSeconds === "number" &&
    Number.isFinite(raw.timeoutSeconds)
  ) {
    payload.timeoutSeconds = Math.max(1, Math.floor(raw.timeoutSeconds));
    mutated = true;
  }

  if (
    typeof payload.allowUnsafeExternalContent !== "boolean" &&
    typeof raw.allowUnsafeExternalContent === "boolean"
  ) {
    payload.allowUnsafeExternalContent = raw.allowUnsafeExternalContent;
    mutated = true;
  }

  if (typeof payload.deliver !== "boolean" && typeof raw.deliver === "boolean") {
    payload.deliver = raw.deliver;
    mutated = true;
  }
  if (
    typeof payload.channel !== "string" &&
    typeof raw.channel === "string" &&
    raw.channel.trim()
  ) {
    payload.channel = raw.channel.trim();
    mutated = true;
  }
  if (typeof payload.to !== "string" && typeof raw.to === "string" && raw.to.trim()) {
    payload.to = raw.to.trim();
    mutated = true;
  }
  if (
    typeof payload.bestEffortDeliver !== "boolean" &&
    typeof raw.bestEffortDeliver === "boolean"
  ) {
    payload.bestEffortDeliver = raw.bestEffortDeliver;
    mutated = true;
  }
  if (
    typeof payload.provider !== "string" &&
    typeof raw.provider === "string" &&
    raw.provider.trim()
  ) {
    payload.provider = raw.provider.trim();
    mutated = true;
  }

  return mutated;
}

function stripLegacyTopLevelFields(raw: Record<string, unknown>) {
  if ("model" in raw) {
    delete raw.model;
  }
  if ("thinking" in raw) {
    delete raw.thinking;
  }
  if ("timeoutSeconds" in raw) {
    delete raw.timeoutSeconds;
  }
  if ("allowUnsafeExternalContent" in raw) {
    delete raw.allowUnsafeExternalContent;
  }
  if ("message" in raw) {
    delete raw.message;
  }
  if ("text" in raw) {
    delete raw.text;
  }
  if ("deliver" in raw) {
    delete raw.deliver;
  }
  if ("channel" in raw) {
    delete raw.channel;
  }
  if ("to" in raw) {
    delete raw.to;
  }
  if ("bestEffortDeliver" in raw) {
    delete raw.bestEffortDeliver;
  }
  if ("provider" in raw) {
    delete raw.provider;
  }
}

async function getFileMtimeMs(path: string): Promise<number | null> {
  try {
    const stats = await fs.promises.stat(path);
    return stats.mtimeMs;
  } catch {
    return null;
  }
}

export async function ensureLoaded(
  state: CronServiceState,
  opts?: {
    forceReload?: boolean;
    /** Skip recomputing nextRunAtMs after load so the caller can run due
     *  jobs against the persisted values first (see onTimer). */
    skipRecompute?: boolean;
  },
) {
  // Fast path: store is already in memory. Other callers (add, list, run, …)
  // trust the in-memory copy to avoid a stat syscall on every operation.
  if (state.store && !opts?.forceReload) {
    return;
  }
  // Force reload always re-reads the file to avoid missing cross-service
  // edits on filesystems with coarse mtime resolution.

  const fileMtimeMs = await getFileMtimeMs(state.deps.storePath);
  const loaded = await loadCronStore(state.deps.storePath);
  const jobs = (loaded.jobs ?? []) as unknown as Array<Record<string, unknown>>;
  let mutated = false;
  const skippedJobIndices: number[] = [];
  for (let i = 0; i < jobs.length; i++) {
    const raw = jobs[i]!;
    try {
    const nowMs = state.deps.nowMs();

    const jobState = raw.state;
    if (!jobState || typeof jobState !== "object" || Array.isArray(jobState)) {
      raw.state = {};
      mutated = true;
    }

    const idRaw = raw.id;
    const jobIdRaw = raw.jobId;
    if (typeof idRaw !== "string" || idRaw.trim().length === 0) {
      if (typeof jobIdRaw === "string" && jobIdRaw.trim()) {
        raw.id = jobIdRaw.trim();
        mutated = true;
      }
    } else if (idRaw !== idRaw.trim()) {
      raw.id = idRaw.trim();
      mutated = true;
    }
    if ("jobId" in raw) {
      delete raw.jobId;
      mutated = true;
    }

    const createdAtRaw = raw.createdAtMs;
    if (typeof createdAtRaw !== "number" || !Number.isFinite(createdAtRaw) || createdAtRaw < 0) {
      raw.createdAtMs = nowMs;
      mutated = true;
    } else {
      const normalized = Math.max(0, Math.floor(createdAtRaw));
      if (createdAtRaw !== normalized) {
        raw.createdAtMs = normalized;
        mutated = true;
      }
    }

    const updatedAtRaw = raw.updatedAtMs;
    if (typeof updatedAtRaw !== "number" || !Number.isFinite(updatedAtRaw) || updatedAtRaw < 0) {
      raw.updatedAtMs = raw.createdAtMs;
      mutated = true;
    } else {
      const normalized = Math.max(0, Math.floor(updatedAtRaw));
      if (updatedAtRaw !== normalized) {
        raw.updatedAtMs = normalized;
        mutated = true;
      }
    }

    const wakeModeRaw = raw.wakeMode;
    const wakeMode = typeof wakeModeRaw === "string" ? wakeModeRaw.trim().toLowerCase() : "";
    if (wakeMode === "now" || wakeMode === "next-heartbeat") {
      if (wakeModeRaw !== wakeMode) {
        raw.wakeMode = wakeMode;
        mutated = true;
      }
    } else {
      raw.wakeMode = "next-heartbeat";
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

    if (typeof raw.enabled !== "boolean") {
      raw.enabled = true;
      mutated = true;
    }

    const payload = raw.payload;
    if (
      (!payload || typeof payload !== "object" || Array.isArray(payload)) &&
      inferPayloadIfMissing(raw)
    ) {
      mutated = true;
    }

    const payloadRecord =
      raw.payload && typeof raw.payload === "object" && !Array.isArray(raw.payload)
        ? (raw.payload as Record<string, unknown>)
        : null;

    if (payloadRecord) {
      if (normalizePayloadKind(payloadRecord)) {
        mutated = true;
      }
      if (!payloadRecord.kind) {
        if (typeof payloadRecord.message === "string" && payloadRecord.message.trim()) {
          payloadRecord.kind = "agentTurn";
          mutated = true;
        } else if (typeof payloadRecord.text === "string" && payloadRecord.text.trim()) {
          payloadRecord.kind = "systemEvent";
          mutated = true;
        }
      }
      if (payloadRecord.kind === "agentTurn") {
        if (copyTopLevelAgentTurnFields(raw, payloadRecord)) {
          mutated = true;
        }
      }
    }

    const hadLegacyTopLevelFields =
      "model" in raw ||
      "thinking" in raw ||
      "timeoutSeconds" in raw ||
      "allowUnsafeExternalContent" in raw ||
      "message" in raw ||
      "text" in raw ||
      "deliver" in raw ||
      "channel" in raw ||
      "to" in raw ||
      "bestEffortDeliver" in raw ||
      "provider" in raw;
    if (hadLegacyTopLevelFields) {
      stripLegacyTopLevelFields(raw);
      mutated = true;
    }

    if (payloadRecord) {
      if (migrateLegacyCronPayload(payloadRecord)) {
        mutated = true;
      }
    }

    const schedule = raw.schedule;
    if (schedule && typeof schedule === "object" && !Array.isArray(schedule)) {
      const sched = schedule as Record<string, unknown>;
      let kind = typeof sched.kind === "string" ? sched.kind.trim().toLowerCase() : "";
      if (kind === "at" || kind === "every" || kind === "cron") {
        if (sched.kind !== kind) {
          sched.kind = kind;
          mutated = true;
        }
      } else {
        kind = "";
      }

      if (!kind) {
        if ("at" in sched || "atMs" in sched) {
          sched.kind = "at";
          kind = "at";
          mutated = true;
        } else if (typeof sched.everyMs === "number") {
          sched.kind = "every";
          kind = "every";
          mutated = true;
        } else if (typeof sched.expr === "string" || typeof sched.cron === "string") {
          sched.kind = "cron";
          kind = "cron";
          mutated = true;
        }
      }

      const atRaw = typeof sched.at === "string" ? sched.at.trim() : "";
      const atMsRaw = sched.atMs;
      const parsedAtMs =
        typeof atMsRaw === "number"
          ? atMsRaw
          : typeof atMsRaw === "string"
            ? parseAbsoluteTimeMs(atMsRaw)
            : atRaw
              ? parseAbsoluteTimeMs(atRaw)
              : null;
      if (parsedAtMs !== null) {
        sched.at = new Date(parsedAtMs).toISOString();
        if ("atMs" in sched) {
          delete sched.atMs;
        }
        mutated = true;
      }

      const everyMsRaw = sched.everyMs;
      const everyMs =
        typeof everyMsRaw === "number" && Number.isFinite(everyMsRaw)
          ? Math.floor(everyMsRaw)
          : null;
      if (kind === "every" && everyMs !== null) {
        const anchorRaw = sched.anchorMs;
        const normalizedAnchor =
          typeof anchorRaw === "number" && Number.isFinite(anchorRaw)
            ? Math.max(0, Math.floor(anchorRaw))
            : typeof raw.createdAtMs === "number" && Number.isFinite(raw.createdAtMs)
              ? Math.max(0, Math.floor(raw.createdAtMs))
              : typeof raw.updatedAtMs === "number" && Number.isFinite(raw.updatedAtMs)
                ? Math.max(0, Math.floor(raw.updatedAtMs))
                : null;
        if (normalizedAnchor !== null && anchorRaw !== normalizedAnchor) {
          sched.anchorMs = normalizedAnchor;
          mutated = true;
        }
      }

      if (kind === "cron") {
        const exprRaw = typeof sched.expr === "string" ? sched.expr.trim() : "";
        const cronRaw = typeof sched.cron === "string" ? sched.cron.trim() : "";
        const nextExpr = exprRaw || cronRaw;
        if (nextExpr) {
          if (sched.expr !== nextExpr) {
            sched.expr = nextExpr;
            mutated = true;
          }
        } else if ("expr" in sched) {
          delete sched.expr;
          mutated = true;
        }
        if ("cron" in sched) {
          delete sched.cron;
          mutated = true;
        }

        const tzRaw = typeof sched.tz === "string" ? sched.tz.trim() : "";
        const timezoneRaw = typeof sched.timezone === "string" ? sched.timezone.trim() : "";
        const nextTz = tzRaw || timezoneRaw;
        if (nextTz) {
          if (sched.tz !== nextTz) {
            sched.tz = nextTz;
            mutated = true;
          }
        } else if ("tz" in sched) {
          delete sched.tz;
          mutated = true;
        }
        if ("timezone" in sched) {
          delete sched.timezone;
          mutated = true;
        }
      }
    }

    const delivery = raw.delivery;
    if (delivery && typeof delivery === "object" && !Array.isArray(delivery)) {
      const modeRaw = (delivery as { mode?: unknown }).mode;
      if (typeof modeRaw === "string") {
        const lowered = modeRaw.trim().toLowerCase();
        if (lowered === "deliver") {
          (delivery as { mode?: unknown }).mode = "announce";
          mutated = true;
        }
      } else if (modeRaw === undefined || modeRaw === null) {
        // Explicitly persist the default so existing jobs don't silently
        // change behaviour when the runtime default shifts.
        (delivery as { mode?: unknown }).mode = "announce";
        mutated = true;
      }
    }

    const isolation = raw.isolation;
    if (isolation && typeof isolation === "object" && !Array.isArray(isolation)) {
      delete raw.isolation;
      mutated = true;
    }

    const payloadKind =
      payloadRecord && typeof payloadRecord.kind === "string" ? payloadRecord.kind : "";
    const sessionTarget =
      typeof raw.sessionTarget === "string" ? raw.sessionTarget.trim().toLowerCase() : "";
    const normalizedSessionTarget =
      sessionTarget === "main" || sessionTarget === "isolated"
        ? sessionTarget
        : payloadKind === "agentTurn"
          ? "isolated"
          : "main";
    if (raw.sessionTarget !== normalizedSessionTarget) {
      raw.sessionTarget = normalizedSessionTarget;
      mutated = true;
    }
    // normalizedSessionTarget is always "main" or "isolated" after normalization above.
    const isIsolatedAgentTurn = normalizedSessionTarget === "isolated";
    const hasDelivery = delivery && typeof delivery === "object" && !Array.isArray(delivery);
    const hasLegacyDelivery = payloadRecord ? hasLegacyDeliveryHints(payloadRecord) : false;

    if (isIsolatedAgentTurn && payloadKind === "agentTurn") {
      if (!hasDelivery) {
        raw.delivery =
          payloadRecord && hasLegacyDelivery
            ? buildDeliveryFromLegacyPayload(payloadRecord)
            : { mode: "announce" };
        mutated = true;
      }
      if (payloadRecord && hasLegacyDelivery) {
        if (hasDelivery) {
          const merged = mergeLegacyDeliveryInto(
            delivery as Record<string, unknown>,
            payloadRecord,
          );
          if (merged.mutated) {
            raw.delivery = merged.delivery;
            mutated = true;
          }
        }
        stripLegacyDeliveryFields(payloadRecord);
        mutated = true;
      }
    }
    } catch (err) {
      const jobId = typeof raw.id === "string" ? raw.id : typeof raw.jobId === "string" ? raw.jobId : `index-${i}`;
      state.deps.log.error(
        { jobId, err: String(err), stack: err instanceof Error ? err.stack : undefined },
        "cron: failed to migrate job; disabling it",
      );
      raw.enabled = false;
      if (!raw.state || typeof raw.state !== "object" || Array.isArray(raw.state)) {
        raw.state = {};
      }
      mutated = true;
    }
  }
  state.store = { version: 1, jobs: jobs as unknown as CronJob[] };
  state.storeLoadedAtMs = state.deps.nowMs();
  state.storeFileMtimeMs = fileMtimeMs;

  if (!opts?.skipRecompute) {
    recomputeNextRuns(state);
  }

  if (mutated) {
    await persist(state);
  }
}

export function warnIfDisabled(state: CronServiceState, action: string) {
  if (state.deps.cronEnabled) {
    return;
  }
  if (state.warnedDisabled) {
    return;
  }
  state.warnedDisabled = true;
  state.deps.log.warn(
    { enabled: false, action, storePath: state.deps.storePath },
    "cron: scheduler disabled; jobs will not run automatically",
  );
}

export async function persist(state: CronServiceState) {
  if (!state.store) {
    return;
  }
  await saveCronStore(state.deps.storePath, state.store);
  // Update file mtime after save to prevent immediate reload
  state.storeFileMtimeMs = await getFileMtimeMs(state.deps.storePath);
}
