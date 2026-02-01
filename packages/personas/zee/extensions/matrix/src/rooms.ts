/**
 * Matrix Room and DM Handling
 *
 * Manages room creation, DM detection, space hierarchy resolution,
 * and room invite approval flows for Matrix channel operations.
 */

import type { MatrixClient } from "matrix-bot-sdk";

export interface RoomInfo {
  roomId: string;
  name?: string;
  topic?: string;
  isDm: boolean;
  isEncrypted: boolean;
  memberCount: number;
}

/**
 * Determine if a room is a DM (direct message) room.
 * Matrix does not have a native DM type; we check the m.direct account data.
 */
export async function isDmRoom(client: MatrixClient, roomId: string): Promise<boolean> {
  try {
    const directRooms = await client.getAccountData("m.direct").catch(() => ({}));
    for (const rooms of Object.values(directRooms as Record<string, string[]>)) {
      if (Array.isArray(rooms) && rooms.includes(roomId)) return true;
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Get room information including encryption state and membership.
 */
export async function getRoomInfo(client: MatrixClient, roomId: string): Promise<RoomInfo> {
  const state = await client.getRoomState(roomId);

  const nameEvent = state.find(
    (e: Record<string, unknown>) => e.type === "m.room.name",
  );
  const topicEvent = state.find(
    (e: Record<string, unknown>) => e.type === "m.room.topic",
  );
  const encryptionEvent = state.find(
    (e: Record<string, unknown>) => e.type === "m.room.encryption",
  );
  const members = state.filter(
    (e: Record<string, unknown>) =>
      e.type === "m.room.member" &&
      (e.content as Record<string, unknown>)?.membership === "join",
  );

  return {
    roomId,
    name: (nameEvent?.content as Record<string, unknown>)?.name as string | undefined,
    topic: (topicEvent?.content as Record<string, unknown>)?.topic as string | undefined,
    isDm: await isDmRoom(client, roomId),
    isEncrypted: Boolean(encryptionEvent),
    memberCount: members.length,
  };
}

/**
 * Create or find a DM room with the given user.
 */
export async function ensureDmRoom(
  client: MatrixClient,
  userId: string,
  encrypt?: boolean,
): Promise<string> {
  // Check if we already have a DM with this user
  try {
    const directRooms = await client.getAccountData("m.direct").catch(() => ({}));
    const existing = (directRooms as Record<string, string[]>)[userId];
    if (Array.isArray(existing) && existing.length > 0) {
      return existing[0];
    }
  } catch {
    // No existing DM
  }

  // Create a new DM room
  const roomParams: Record<string, unknown> = {
    invite: [userId],
    is_direct: true,
    preset: encrypt ? "trusted_private_chat" : "private_chat",
  };

  if (encrypt) {
    roomParams.initial_state = [
      {
        type: "m.room.encryption",
        state_key: "",
        content: { algorithm: "m.megolm.v1.aes-sha2" },
      },
    ];
  }

  const roomId = await client.createRoom(roomParams);

  // Update m.direct account data
  try {
    const directRooms = await client.getAccountData("m.direct").catch(() => ({}));
    const rooms = (directRooms as Record<string, string[]>)[userId] ?? [];
    rooms.push(roomId);
    await client.setAccountData("m.direct", {
      ...(directRooms as Record<string, string[]>),
      [userId]: rooms,
    });
  } catch {
    // Non-fatal: DM will work but may not be tagged as direct
  }

  return roomId;
}

/**
 * List all joined rooms with basic info.
 */
export async function listJoinedRooms(client: MatrixClient): Promise<RoomInfo[]> {
  const roomIds = await client.getJoinedRooms();
  const results: RoomInfo[] = [];

  for (const roomId of roomIds) {
    try {
      results.push(await getRoomInfo(client, roomId));
    } catch {
      results.push({
        roomId,
        isDm: false,
        isEncrypted: false,
        memberCount: 0,
      });
    }
  }

  return results;
}
