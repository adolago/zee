/**
 * Matrix Media Handling
 *
 * Upload and download media via MXC URIs (mxc://server/media-id).
 * Handles image, audio, video, and file attachments.
 */

import type { MatrixClient } from "matrix-bot-sdk";
import fs from "node:fs";
import path from "node:path";

export interface MediaUploadResult {
  mxcUri: string;
  contentType: string;
  size: number;
}

const MIME_MAP: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".ogg": "audio/ogg",
  ".mp3": "audio/mpeg",
  ".pdf": "application/pdf",
};

function guessMimeType(filename: string): string {
  const ext = path.extname(filename).toLowerCase();
  return MIME_MAP[ext] ?? "application/octet-stream";
}

/**
 * Upload a file to the Matrix media repository.
 */
export async function uploadMedia(
  client: MatrixClient,
  filePath: string,
  filename?: string,
): Promise<MediaUploadResult> {
  const resolvedFilename = filename ?? path.basename(filePath);
  const contentType = guessMimeType(resolvedFilename);
  const data = fs.readFileSync(filePath);

  const mxcUri = await client.uploadContent(data, contentType, resolvedFilename);

  return {
    mxcUri,
    contentType,
    size: data.length,
  };
}

/**
 * Upload media from a Buffer.
 */
export async function uploadMediaBuffer(
  client: MatrixClient,
  buffer: Buffer,
  filename: string,
  contentType?: string,
): Promise<MediaUploadResult> {
  const resolvedType = contentType ?? guessMimeType(filename);
  const mxcUri = await client.uploadContent(buffer, resolvedType, filename);

  return {
    mxcUri,
    contentType: resolvedType,
    size: buffer.length,
  };
}

/**
 * Upload media from a URL by first downloading it.
 */
export async function uploadMediaFromUrl(
  client: MatrixClient,
  url: string,
  filename?: string,
): Promise<MediaUploadResult> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download media: ${response.status}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  const resolvedFilename = filename ?? new URL(url).pathname.split("/").pop() ?? "file";
  const contentType = response.headers.get("content-type") ?? guessMimeType(resolvedFilename);

  const mxcUri = await client.uploadContent(buffer, contentType, resolvedFilename);

  return {
    mxcUri,
    contentType,
    size: buffer.length,
  };
}

/**
 * Build the m.room.message content for a media attachment.
 */
export function buildMediaMessageContent(
  upload: MediaUploadResult,
  filename: string,
  body?: string,
): Record<string, unknown> {
  const isImage = upload.contentType.startsWith("image/");
  const isVideo = upload.contentType.startsWith("video/");
  const isAudio = upload.contentType.startsWith("audio/");

  const msgtype = isImage
    ? "m.image"
    : isVideo
      ? "m.video"
      : isAudio
        ? "m.audio"
        : "m.file";

  return {
    msgtype,
    body: body ?? filename,
    url: upload.mxcUri,
    info: {
      mimetype: upload.contentType,
      size: upload.size,
    },
  };
}
