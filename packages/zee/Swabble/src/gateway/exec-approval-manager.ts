import { randomUUID } from "node:crypto";

import type { ExecApprovalDecision } from "../infra/exec-approvals.js";

// Grace period to keep resolved entries for late awaitDecision calls.
const RESOLVED_ENTRY_GRACE_MS = 15_000;

export type ExecApprovalRequestPayload = {
  command: string;
  cwd?: string | null;
  host?: string | null;
  security?: string | null;
  ask?: string | null;
  agentId?: string | null;
  resolvedPath?: string | null;
  sessionKey?: string | null;
};

export type ExecApprovalRecord = {
  id: string;
  request: ExecApprovalRequestPayload;
  createdAtMs: number;
  expiresAtMs: number;
  resolvedAtMs?: number;
  decision?: ExecApprovalDecision;
  resolvedBy?: string | null;
};

type PendingEntry = {
  record: ExecApprovalRecord;
  resolve: (decision: ExecApprovalDecision | null) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
  promise: Promise<ExecApprovalDecision | null>;
};

export class ExecApprovalManager {
  private pending = new Map<string, PendingEntry>();

  create(
    request: ExecApprovalRequestPayload,
    timeoutMs: number,
    id?: string | null,
  ): ExecApprovalRecord {
    const now = Date.now();
    const resolvedId = id && id.trim().length > 0 ? id.trim() : randomUUID();
    const record: ExecApprovalRecord = {
      id: resolvedId,
      request,
      createdAtMs: now,
      expiresAtMs: now + timeoutMs,
    };
    return record;
  }

  /**
   * Register an approval record and return a promise that resolves when the
   * decision is made.
   */
  register(record: ExecApprovalRecord, timeoutMs: number): Promise<ExecApprovalDecision | null> {
    const existing = this.pending.get(record.id);
    if (existing) {
      // Idempotent while still pending; reject re-registration after resolve.
      if (existing.record.resolvedAtMs === undefined) {
        return existing.promise;
      }
      throw new Error(`approval id '${record.id}' already resolved`);
    }

    let resolvePromise: (decision: ExecApprovalDecision | null) => void;
    let rejectPromise: (err: Error) => void;
    const promise = new Promise<ExecApprovalDecision | null>((resolve, reject) => {
      resolvePromise = resolve;
      rejectPromise = reject;
    });

    // Capture the entry in the timeout closure so identity checks stay stable.
    const entry: PendingEntry = {
      record,
      resolve: resolvePromise!,
      reject: rejectPromise!,
      timer: null as unknown as ReturnType<typeof setTimeout>,
      promise,
    };
    entry.timer = setTimeout(() => {
      record.resolvedAtMs = Date.now();
      record.decision = undefined;
      record.resolvedBy = null;
      resolvePromise(null);
      setTimeout(() => {
        if (this.pending.get(record.id) === entry) {
          this.pending.delete(record.id);
        }
      }, RESOLVED_ENTRY_GRACE_MS);
    }, timeoutMs);

    this.pending.set(record.id, entry);
    return promise;
  }

  /**
   * @deprecated Use register() to separate registration from waiting.
   */
  async waitForDecision(
    record: ExecApprovalRecord,
    timeoutMs: number,
  ): Promise<ExecApprovalDecision | null> {
    return this.register(record, timeoutMs);
  }

  resolve(recordId: string, decision: ExecApprovalDecision, resolvedBy?: string | null): boolean {
    const pending = this.pending.get(recordId);
    if (!pending) {
      return false;
    }
    if (pending.record.resolvedAtMs !== undefined) {
      return false;
    }
    clearTimeout(pending.timer);
    pending.record.resolvedAtMs = Date.now();
    pending.record.decision = decision;
    pending.record.resolvedBy = resolvedBy ?? null;
    pending.resolve(decision);
    setTimeout(() => {
      if (this.pending.get(recordId) === pending) {
        this.pending.delete(recordId);
      }
    }, RESOLVED_ENTRY_GRACE_MS);
    return true;
  }

  getSnapshot(recordId: string): ExecApprovalRecord | null {
    const entry = this.pending.get(recordId);
    return entry?.record ?? null;
  }

  awaitDecision(recordId: string): Promise<ExecApprovalDecision | null> | null {
    const entry = this.pending.get(recordId);
    return entry?.promise ?? null;
  }

  listPending(): ExecApprovalRecord[] {
    return [...this.pending.values()]
      .filter((entry) => entry.record.resolvedAtMs === undefined)
      .map((entry) => ({
        ...entry.record,
        request: { ...entry.record.request },
      }))
      .sort((a, b) => a.createdAtMs - b.createdAtMs);
  }
}
