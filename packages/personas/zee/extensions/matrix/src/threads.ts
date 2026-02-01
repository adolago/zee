/**
 * Matrix Thread Support
 *
 * Handles Matrix thread relations (m.thread) for threaded conversations.
 * Matrix threads use relation events to group messages under a root event.
 */

/**
 * Build an m.thread relation object for a message.
 */
export function buildThreadRelation(threadRootEventId: string, replyToEventId?: string) {
  const relation: Record<string, unknown> = {
    rel_type: "m.thread",
    event_id: threadRootEventId,
  };

  // If replying to a specific message within the thread, add in-thread reply
  if (replyToEventId && replyToEventId !== threadRootEventId) {
    relation.is_falling_back = false;
    relation["m.in_reply_to"] = { event_id: replyToEventId };
  } else {
    relation.is_falling_back = true;
    relation["m.in_reply_to"] = { event_id: threadRootEventId };
  }

  return relation;
}

/**
 * Check if an event is part of a thread.
 */
export function isThreadEvent(event: Record<string, unknown>): boolean {
  const content = event.content as Record<string, unknown> | undefined;
  if (!content) return false;
  const relation = content["m.relates_to"] as Record<string, unknown> | undefined;
  return relation?.rel_type === "m.thread";
}

/**
 * Extract the thread root event ID from a thread event.
 */
export function getThreadRootId(event: Record<string, unknown>): string | null {
  const content = event.content as Record<string, unknown> | undefined;
  if (!content) return null;
  const relation = content["m.relates_to"] as Record<string, unknown> | undefined;
  if (relation?.rel_type !== "m.thread") return null;
  return (relation.event_id as string) ?? null;
}
