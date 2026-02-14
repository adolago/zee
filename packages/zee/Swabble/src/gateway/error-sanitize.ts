import { formatForLog } from "./ws-log.js";

const MAX_PUBLIC_ERROR_LENGTH = 180;
const FILESYSTEM_PATH_RE = /(?:[A-Za-z]:\\|\/)[^\s"'`)\]}]+/g;

function normalizeErrorMessage(value: string): string {
  return value
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(FILESYSTEM_PATH_RE, "<path>")
    .replace(/^error:\s*/i, "")
    .trim();
}

export function sanitizeGatewayErrorMessage(
  err: unknown,
  opts?: { fallback?: string; maxLength?: number },
): string {
  const fallback = opts?.fallback ?? "request failed";
  const raw = normalizeErrorMessage(formatForLog(err));
  if (!raw) return fallback;
  const maxLength = opts?.maxLength ?? MAX_PUBLIC_ERROR_LENGTH;
  if (raw.length <= maxLength) return raw;
  return `${raw.slice(0, maxLength)}...`;
}

export function sanitizeGatewayUnavailableMessage(err: unknown): string {
  const safe = sanitizeGatewayErrorMessage(err, { fallback: "request unavailable", maxLength: 120 });
  const lowered = safe.toLowerCase();
  if (lowered.includes("timeout")) return "request timed out";
  if (lowered.includes("aborted")) return "request aborted";
  return "request unavailable";
}
