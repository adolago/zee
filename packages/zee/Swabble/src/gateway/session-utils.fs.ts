import fs from "node:fs";
import path from "node:path";

import {
  resolveSessionFilePath,
  resolveSessionFilePathOptions,
  resolveSessionTranscriptPath,
} from "../config/sessions/paths.js";

export type ArchiveFileReason = "bak" | "reset" | "deleted";

function uniqueAbsolutePaths(paths: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const candidate of paths) {
    const trimmed = typeof candidate === "string" ? candidate.trim() : "";
    if (!trimmed) continue;
    const absolute = path.resolve(trimmed);
    if (seen.has(absolute)) continue;
    seen.add(absolute);
    result.push(absolute);
  }
  return result;
}

export function resolveSessionTranscriptCandidates(
  sessionId: string,
  storePath?: string,
  sessionFile?: string,
  agentId?: string,
): string[] {
  const candidates: string[] = [];

  const trimmedSessionFile = typeof sessionFile === "string" ? sessionFile.trim() : "";
  if (trimmedSessionFile.length > 0) {
    candidates.push(path.resolve(trimmedSessionFile));
  }

  const options = resolveSessionFilePathOptions({ storePath, agentId });
  candidates.push(resolveSessionFilePath(sessionId, agentId, options));

  if (typeof agentId === "string" && agentId.trim().length > 0) {
    candidates.push(resolveSessionTranscriptPath(sessionId, agentId));
  }

  return uniqueAbsolutePaths(candidates);
}

export function archiveFileOnDisk(filePath: string, reason: ArchiveFileReason): string {
  const ts = new Date().toISOString().replaceAll(":", "-");
  const archivedPath = `${filePath}.${reason}.${ts}`;
  fs.renameSync(filePath, archivedPath);
  return archivedPath;
}

/**
 * Best-effort archival for old transcripts when sessions rotate.
 * Missing/unreadable paths are ignored so reset/new flows do not fail.
 */
export function archiveSessionTranscripts(opts: {
  sessionId: string;
  storePath?: string;
  sessionFile?: string;
  agentId?: string;
  reason: "reset" | "deleted";
}): string[] {
  const archived: string[] = [];
  const candidates = resolveSessionTranscriptCandidates(
    opts.sessionId,
    opts.storePath,
    opts.sessionFile,
    opts.agentId,
  );
  for (const candidate of candidates) {
    if (!fs.existsSync(candidate)) continue;
    try {
      archived.push(archiveFileOnDisk(candidate, opts.reason));
    } catch {
      // Best-effort by design.
    }
  }
  return archived;
}
