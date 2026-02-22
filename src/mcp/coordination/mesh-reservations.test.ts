import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  findMeshConflicts,
  listMeshPeers,
  listMeshReservations,
  releaseMeshPaths,
  reserveMeshPaths,
  upsertMeshPeer,
} from "./mesh-reservations";

const ORIGINAL_STATE_DIR = process.env.ZEE_STATE_DIR;
let tempStateDir = "";

beforeEach(async () => {
  tempStateDir = await mkdtemp(join(tmpdir(), "zee-mesh-test-"));
  process.env.ZEE_STATE_DIR = tempStateDir;
});

afterEach(async () => {
  if (ORIGINAL_STATE_DIR === undefined) {
    delete process.env.ZEE_STATE_DIR;
  } else {
    process.env.ZEE_STATE_DIR = ORIGINAL_STATE_DIR;
  }
  if (tempStateDir) {
    await rm(tempStateDir, { recursive: true, force: true });
  }
});

describe("mesh reservations", () => {
  test("blocks conflicting reservations from another session", async () => {
    const first = await reserveMeshPaths({
      sessionId: "session-a",
      paths: ["src/demo.ts"],
      hardBlock: true,
      ttlMs: 60_000,
    });
    expect(first.ok).toBe(true);
    expect(first.reserved.length).toBe(1);

    const second = await reserveMeshPaths({
      sessionId: "session-b",
      paths: ["src/demo.ts"],
      hardBlock: true,
      ttlMs: 60_000,
    });
    expect(second.ok).toBe(false);
    expect(second.conflicts.length).toBe(1);

    const conflicts = await findMeshConflicts({
      requestedPath: "src/demo.ts",
      sessionId: "session-b",
    });
    expect(conflicts.length).toBe(1);
    expect(conflicts[0]?.ownerSessionId).toBe("session-a");
  });

  test("release enables another session to reserve the same path", async () => {
    await reserveMeshPaths({
      sessionId: "session-a",
      paths: ["src/demo.ts"],
      hardBlock: true,
      ttlMs: 60_000,
    });

    const released = await releaseMeshPaths({
      sessionId: "session-a",
      releaseAll: true,
    });
    expect(released.length).toBe(1);

    const second = await reserveMeshPaths({
      sessionId: "session-b",
      paths: ["src/demo.ts"],
      hardBlock: true,
      ttlMs: 60_000,
    });
    expect(second.ok).toBe(true);
    expect(second.reserved.length).toBe(1);

    const reservations = await listMeshReservations();
    expect(reservations.length).toBe(1);
    expect(reservations[0]?.ownerSessionId).toBe("session-b");
  });

  test("tracks mesh peers via heartbeat", async () => {
    const peer = await upsertMeshPeer({
      peerId: "peer-1",
      label: "Peer One",
      capabilities: ["edit", "review"],
      ttlMs: 120_000,
    });
    expect(peer.id).toBe("peer-1");

    const peers = await listMeshPeers();
    expect(peers.length).toBe(1);
    expect(peers[0]?.capabilities).toEqual(["edit", "review"]);
  });
});
