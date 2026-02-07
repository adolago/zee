import { wrapExternalContent } from "./external-content.js";

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function truncate(value: string, maxLength: number): string {
  const limit = Math.max(0, Math.floor(maxLength));
  if (value.length <= limit) return value;
  if (limit <= 3) return value.slice(0, limit);
  return `${value.slice(0, limit - 3)}...`;
}

export function buildUntrustedChannelMetadata(params: {
  channel: string;
  fields: Record<string, unknown>;
  maxFieldLength?: number;
  maxTotalLength?: number;
}): string {
  const maxFieldLength = params.maxFieldLength ?? 400;
  const maxTotalLength = params.maxTotalLength ?? 800;

  const lines: string[] = [];
  const seen = new Set<string>();

  const channel = normalizeWhitespace(params.channel ?? "");
  if (channel) {
    const line = truncate(`Channel: ${channel}`, maxFieldLength);
    if (!seen.has(line)) {
      lines.push(line);
      seen.add(line);
    }
  }

  const keys = Object.keys(params.fields ?? {}).toSorted();
  for (const keyRaw of keys) {
    const key = normalizeWhitespace(keyRaw);
    if (!key) continue;
    const valueRaw = params.fields[keyRaw];
    const value =
      typeof valueRaw === "string"
        ? normalizeWhitespace(valueRaw)
        : typeof valueRaw === "number" || typeof valueRaw === "boolean"
          ? normalizeWhitespace(String(valueRaw))
          : "";
    if (!value) continue;

    const line = truncate(`${key}: ${value}`, maxFieldLength);
    if (seen.has(line)) continue;
    lines.push(line);
    seen.add(line);
  }

  if (lines.length === 0) return "";

  const metadata = truncate(lines.join("\n"), maxTotalLength);
  return wrapExternalContent(metadata, { source: "channel_metadata", includeWarning: false });
}

