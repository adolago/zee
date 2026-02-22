import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";

const DEFAULT_RESERVATION_TTL_MS = 30 * 60 * 1000;
const DEFAULT_PEER_TTL_MS = 10 * 60 * 1000;

export interface MeshReservation {
  id: string;
  path: string;
  ownerSessionId: string;
  ownerAgent?: string;
  reason?: string;
  hardBlock: boolean;
  createdAt: number;
  updatedAt: number;
  expiresAt: number;
}

export interface MeshPeer {
  id: string;
  label?: string;
  capabilities: string[];
  metadata?: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
  expiresAt: number;
}

interface MeshStateV1 {
  version: 1;
  updatedAt: number;
  reservations: MeshReservation[];
  peers: MeshPeer[];
}

export interface MeshConflict {
  requestedPath: string;
  reservationId: string;
  reservedPath: string;
  ownerSessionId: string;
  ownerAgent?: string;
  reason?: string;
  expiresAt: number;
}

export interface ReserveMeshPathsInput {
  sessionId: string;
  paths: string[];
  agent?: string;
  reason?: string;
  ttlMs?: number;
  hardBlock?: boolean;
  cwd?: string;
}

export interface ReserveMeshPathsResult {
  ok: boolean;
  reserved: MeshReservation[];
  conflicts: MeshConflict[];
}

export interface ReleaseMeshPathsInput {
  sessionId: string;
  paths?: string[];
  releaseAll?: boolean;
  cwd?: string;
}

export interface UpsertMeshPeerInput {
  peerId: string;
  label?: string;
  capabilities?: string[];
  metadata?: Record<string, unknown>;
  ttlMs?: number;
}

let stateMutex: Promise<void> = Promise.resolve();

function getStateRoot(): string {
  const configured = process.env.ZEE_STATE_DIR?.trim();
  if (configured) return path.resolve(configured);
  return path.join(os.homedir(), ".local", "state", "zee");
}

function getMeshStatePath(): string {
  return path.join(getStateRoot(), "mesh", "state.json");
}

function createEmptyState(now = Date.now()): MeshStateV1 {
  return {
    version: 1,
    updatedAt: now,
    reservations: [],
    peers: [],
  };
}

function normalizePathValue(input: string, cwd: string): string {
  return path.resolve(cwd, input);
}

function pathWithSep(value: string): string {
  return value.endsWith(path.sep) ? value : `${value}${path.sep}`;
}

function pathsOverlap(a: string, b: string): boolean {
  if (a === b) return true;
  return pathWithSep(a).startsWith(pathWithSep(b)) || pathWithSep(b).startsWith(pathWithSep(a));
}

function normalizeReservations(input: unknown): MeshReservation[] {
  if (!Array.isArray(input)) return [];
  const now = Date.now();
  const items: MeshReservation[] = [];

  for (const raw of input) {
    if (!raw || typeof raw !== "object") continue;
    const item = raw as Record<string, unknown>;
    const id = typeof item.id === "string" && item.id ? item.id : randomUUID();
    const filePath = typeof item.path === "string" && item.path ? item.path : undefined;
    const ownerSessionId =
      typeof item.ownerSessionId === "string" && item.ownerSessionId ? item.ownerSessionId : undefined;
    if (!filePath || !ownerSessionId) continue;

    const createdAt = typeof item.createdAt === "number" ? item.createdAt : now;
    const updatedAt = typeof item.updatedAt === "number" ? item.updatedAt : createdAt;
    const expiresAt =
      typeof item.expiresAt === "number" && Number.isFinite(item.expiresAt)
        ? item.expiresAt
        : createdAt + DEFAULT_RESERVATION_TTL_MS;

    items.push({
      id,
      path: path.resolve(filePath),
      ownerSessionId,
      ownerAgent: typeof item.ownerAgent === "string" ? item.ownerAgent : undefined,
      reason: typeof item.reason === "string" ? item.reason : undefined,
      hardBlock: item.hardBlock !== false,
      createdAt,
      updatedAt,
      expiresAt,
    });
  }

  return items;
}

function normalizePeers(input: unknown): MeshPeer[] {
  if (!Array.isArray(input)) return [];
  const now = Date.now();
  const items: MeshPeer[] = [];

  for (const raw of input) {
    if (!raw || typeof raw !== "object") continue;
    const item = raw as Record<string, unknown>;
    const id = typeof item.id === "string" && item.id ? item.id : undefined;
    if (!id) continue;

    const createdAt = typeof item.createdAt === "number" ? item.createdAt : now;
    const updatedAt = typeof item.updatedAt === "number" ? item.updatedAt : createdAt;
    const expiresAt =
      typeof item.expiresAt === "number" && Number.isFinite(item.expiresAt)
        ? item.expiresAt
        : updatedAt + DEFAULT_PEER_TTL_MS;
    const capabilities = Array.isArray(item.capabilities)
      ? item.capabilities.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
      : [];

    items.push({
      id,
      label: typeof item.label === "string" ? item.label : undefined,
      capabilities,
      metadata: item.metadata && typeof item.metadata === "object" ? (item.metadata as Record<string, unknown>) : undefined,
      createdAt,
      updatedAt,
      expiresAt,
    });
  }

  return items;
}

function normalizeState(input: unknown): MeshStateV1 {
  if (!input || typeof input !== "object") return createEmptyState();
  const raw = input as Record<string, unknown>;
  const now = Date.now();
  return {
    version: 1,
    updatedAt: typeof raw.updatedAt === "number" ? raw.updatedAt : now,
    reservations: normalizeReservations(raw.reservations),
    peers: normalizePeers(raw.peers),
  };
}

function pruneExpired(state: MeshStateV1, now = Date.now()): boolean {
  const reservationCount = state.reservations.length;
  const peerCount = state.peers.length;
  state.reservations = state.reservations.filter((item) => item.expiresAt > now);
  state.peers = state.peers.filter((item) => item.expiresAt > now);
  return reservationCount !== state.reservations.length || peerCount !== state.peers.length;
}

async function withStateMutex<T>(fn: () => Promise<T>): Promise<T> {
  const previous = stateMutex;
  let release: () => void = () => {};
  stateMutex = new Promise<void>((resolve) => {
    release = resolve;
  });
  await previous;
  try {
    return await fn();
  } finally {
    release();
  }
}

async function loadStateUnsafe(): Promise<MeshStateV1> {
  const statePath = getMeshStatePath();
  try {
    const raw = await fs.readFile(statePath, "utf-8");
    return normalizeState(JSON.parse(raw));
  } catch {
    return createEmptyState();
  }
}

async function saveStateUnsafe(state: MeshStateV1): Promise<void> {
  const statePath = getMeshStatePath();
  await fs.mkdir(path.dirname(statePath), { recursive: true });
  const tempPath = `${statePath}.tmp.${Date.now()}`;
  state.updatedAt = Date.now();
  await fs.writeFile(tempPath, JSON.stringify(state, null, 2), "utf-8");
  await fs.rename(tempPath, statePath);
}

function buildConflict(requestedPath: string, reservation: MeshReservation): MeshConflict {
  return {
    requestedPath,
    reservationId: reservation.id,
    reservedPath: reservation.path,
    ownerSessionId: reservation.ownerSessionId,
    ownerAgent: reservation.ownerAgent,
    reason: reservation.reason,
    expiresAt: reservation.expiresAt,
  };
}

export async function listMeshReservations(filter?: { sessionId?: string }): Promise<MeshReservation[]> {
  return withStateMutex(async () => {
    const state = await loadStateUnsafe();
    const changed = pruneExpired(state);
    if (changed) {
      await saveStateUnsafe(state);
    }
    const items = filter?.sessionId
      ? state.reservations.filter((item) => item.ownerSessionId === filter.sessionId)
      : state.reservations;
    return items.sort((a, b) => a.path.localeCompare(b.path));
  });
}

export async function listMeshPeers(): Promise<MeshPeer[]> {
  return withStateMutex(async () => {
    const state = await loadStateUnsafe();
    const changed = pruneExpired(state);
    if (changed) {
      await saveStateUnsafe(state);
    }
    return state.peers.sort((a, b) => a.id.localeCompare(b.id));
  });
}

export async function upsertMeshPeer(input: UpsertMeshPeerInput): Promise<MeshPeer> {
  return withStateMutex(async () => {
    const now = Date.now();
    const ttlMs = Math.max(1_000, input.ttlMs ?? DEFAULT_PEER_TTL_MS);
    const state = await loadStateUnsafe();
    pruneExpired(state, now);

    const existing = state.peers.find((peer) => peer.id === input.peerId);
    if (existing) {
      existing.label = input.label ?? existing.label;
      existing.capabilities = input.capabilities ?? existing.capabilities;
      existing.metadata = input.metadata ?? existing.metadata;
      existing.updatedAt = now;
      existing.expiresAt = now + ttlMs;
      await saveStateUnsafe(state);
      return existing;
    }

    const created: MeshPeer = {
      id: input.peerId,
      label: input.label,
      capabilities: input.capabilities ?? [],
      metadata: input.metadata,
      createdAt: now,
      updatedAt: now,
      expiresAt: now + ttlMs,
    };
    state.peers.push(created);
    await saveStateUnsafe(state);
    return created;
  });
}

export async function findMeshConflicts(input: {
  requestedPath: string;
  sessionId: string;
  cwd?: string;
}): Promise<MeshConflict[]> {
  const cwd = input.cwd ? path.resolve(input.cwd) : process.cwd();
  const requestedPath = normalizePathValue(input.requestedPath, cwd);
  const reservations = await listMeshReservations();
  return reservations
    .filter((reservation) => reservation.ownerSessionId !== input.sessionId)
    .filter((reservation) => reservation.hardBlock)
    .filter((reservation) => pathsOverlap(reservation.path, requestedPath))
    .map((reservation) => buildConflict(requestedPath, reservation));
}

export async function reserveMeshPaths(input: ReserveMeshPathsInput): Promise<ReserveMeshPathsResult> {
  return withStateMutex(async () => {
    const cwd = input.cwd ? path.resolve(input.cwd) : process.cwd();
    const now = Date.now();
    const ttlMs = Math.max(1_000, input.ttlMs ?? DEFAULT_RESERVATION_TTL_MS);
    const hardBlock = input.hardBlock !== false;
    const normalizedPaths = Array.from(
      new Set(
        input.paths
          .map((value) => value.trim())
          .filter((value) => value.length > 0)
          .map((value) => normalizePathValue(value, cwd)),
      ),
    );

    const state = await loadStateUnsafe();
    pruneExpired(state, now);

    const conflicts: MeshConflict[] = [];
    for (const requestedPath of normalizedPaths) {
      for (const reservation of state.reservations) {
        if (!reservation.hardBlock) continue;
        if (reservation.ownerSessionId === input.sessionId) continue;
        if (!pathsOverlap(requestedPath, reservation.path)) continue;
        conflicts.push(buildConflict(requestedPath, reservation));
      }
    }

    if (conflicts.length > 0) {
      await saveStateUnsafe(state);
      return { ok: false, reserved: [], conflicts };
    }

    const reserved: MeshReservation[] = [];
    for (const requestedPath of normalizedPaths) {
      const existing = state.reservations.find(
        (item) => item.ownerSessionId === input.sessionId && item.path === requestedPath,
      );
      if (existing) {
        existing.ownerAgent = input.agent ?? existing.ownerAgent;
        existing.reason = input.reason ?? existing.reason;
        existing.hardBlock = hardBlock;
        existing.updatedAt = now;
        existing.expiresAt = now + ttlMs;
        reserved.push(existing);
        continue;
      }

      const created: MeshReservation = {
        id: randomUUID(),
        path: requestedPath,
        ownerSessionId: input.sessionId,
        ownerAgent: input.agent,
        reason: input.reason,
        hardBlock,
        createdAt: now,
        updatedAt: now,
        expiresAt: now + ttlMs,
      };
      state.reservations.push(created);
      reserved.push(created);
    }

    await saveStateUnsafe(state);
    return { ok: true, reserved, conflicts: [] };
  });
}

export async function releaseMeshPaths(input: ReleaseMeshPathsInput): Promise<MeshReservation[]> {
  return withStateMutex(async () => {
    const cwd = input.cwd ? path.resolve(input.cwd) : process.cwd();
    const normalizedPaths = Array.from(
      new Set(
        (input.paths ?? [])
          .map((value) => value.trim())
          .filter((value) => value.length > 0)
          .map((value) => normalizePathValue(value, cwd)),
      ),
    );

    const state = await loadStateUnsafe();
    pruneExpired(state);
    const removed: MeshReservation[] = [];
    const keep = state.reservations.filter((reservation) => {
      const isOwner = reservation.ownerSessionId === input.sessionId;
      if (!isOwner) return true;
      if (input.releaseAll || normalizedPaths.length === 0) {
        removed.push(reservation);
        return false;
      }
      if (normalizedPaths.some((reservedPath) => reservedPath === reservation.path)) {
        removed.push(reservation);
        return false;
      }
      return true;
    });

    state.reservations = keep;
    await saveStateUnsafe(state);
    return removed.sort((a, b) => a.path.localeCompare(b.path));
  });
}
