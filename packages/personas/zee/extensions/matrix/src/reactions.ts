/**
 * Matrix Reaction Events
 *
 * Send and interpret m.reaction events (emoji reactions on messages).
 */

import type { MatrixClient } from "matrix-bot-sdk";

/**
 * Send a reaction to a message.
 */
export async function sendReaction(
  client: MatrixClient,
  roomId: string,
  eventId: string,
  emoji: string,
): Promise<string> {
  return await client.sendEvent(roomId, "m.reaction", {
    "m.relates_to": {
      rel_type: "m.annotation",
      event_id: eventId,
      key: emoji,
    },
  });
}

/**
 * Check if an event is a reaction.
 */
export function isReactionEvent(event: Record<string, unknown>): boolean {
  return event.type === "m.reaction";
}

/**
 * Extract reaction info from a reaction event.
 */
export function parseReactionEvent(event: Record<string, unknown>): {
  targetEventId: string;
  emoji: string;
} | null {
  const content = event.content as Record<string, unknown> | undefined;
  if (!content) return null;
  const relation = content["m.relates_to"] as Record<string, unknown> | undefined;
  if (!relation || relation.rel_type !== "m.annotation") return null;
  const eventId = relation.event_id as string | undefined;
  const key = relation.key as string | undefined;
  if (!eventId || !key) return null;
  return { targetEventId: eventId, emoji: key };
}
