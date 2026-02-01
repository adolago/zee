/**
 * Matrix Outbound Message Sending
 *
 * Send text and media messages to Matrix rooms via the bot SDK.
 * Supports plain text, formatted (HTML) messages, and media uploads.
 */

import type { MatrixClient } from "matrix-bot-sdk";
import { buildThreadRelation } from "./threads.js";
import { uploadMediaFromUrl, buildMediaMessageContent } from "./media.js";

export interface MatrixSendResult {
  eventId: string;
  roomId: string;
}

/**
 * Send a text message to a Matrix room.
 */
export async function sendText(
  client: MatrixClient,
  roomId: string,
  text: string,
  opts?: {
    threadRootEventId?: string;
    replyToEventId?: string;
    html?: string;
  },
): Promise<MatrixSendResult> {
  const content: Record<string, unknown> = {
    msgtype: "m.text",
    body: text,
  };

  if (opts?.html) {
    content.format = "org.matrix.custom.html";
    content.formatted_body = opts.html;
  }

  if (opts?.threadRootEventId) {
    content["m.relates_to"] = buildThreadRelation(
      opts.threadRootEventId,
      opts.replyToEventId,
    );
  } else if (opts?.replyToEventId) {
    content["m.relates_to"] = {
      "m.in_reply_to": { event_id: opts.replyToEventId },
    };
  }

  const eventId = await client.sendMessage(roomId, content);
  return { eventId, roomId };
}

/**
 * Send a media message to a Matrix room.
 */
export async function sendMedia(
  client: MatrixClient,
  roomId: string,
  mediaUrl: string,
  opts?: {
    text?: string;
    filename?: string;
    threadRootEventId?: string;
    replyToEventId?: string;
  },
): Promise<MatrixSendResult> {
  const upload = await uploadMediaFromUrl(client, mediaUrl, opts?.filename);
  const content = buildMediaMessageContent(
    upload,
    opts?.filename ?? "file",
    opts?.text,
  );

  if (opts?.threadRootEventId) {
    content["m.relates_to"] = buildThreadRelation(
      opts.threadRootEventId,
      opts.replyToEventId,
    );
  } else if (opts?.replyToEventId) {
    content["m.relates_to"] = {
      "m.in_reply_to": { event_id: opts.replyToEventId },
    };
  }

  const eventId = await client.sendMessage(roomId, content);
  return { eventId, roomId };
}

/**
 * Send a notice (non-interactive message) to a Matrix room.
 * Used for status updates, bot messages, etc.
 */
export async function sendNotice(
  client: MatrixClient,
  roomId: string,
  text: string,
): Promise<MatrixSendResult> {
  const eventId = await client.sendMessage(roomId, {
    msgtype: "m.notice",
    body: text,
  });
  return { eventId, roomId };
}
