export type OriginCheckResult = { ok: true } | { ok: false; reason: string };

export function normalizeHostHeader(hostHeader: string | undefined): string | undefined {
  if (typeof hostHeader !== "string") return undefined;
  const trimmed = hostHeader.trim();
  if (!trimmed) return undefined;
  // Defensive: some proxies may produce comma-delimited host headers.
  return trimmed.split(",")[0]!.trim().toLowerCase();
}

export function resolveHostName(hostOrUrl: string | undefined): string | undefined {
  if (typeof hostOrUrl !== "string") return undefined;
  const raw = hostOrUrl.trim();
  if (!raw) return undefined;

  if (raw.includes("://")) {
    try {
      return new URL(raw).hostname.trim().toLowerCase();
    } catch {
      // Fall through to host:port parsing.
    }
  }

  if (raw.startsWith("[")) {
    const end = raw.indexOf("]");
    if (end > 1) return raw.slice(1, end).trim().toLowerCase();
  }

  const host = raw.includes(":") ? raw.split(":", 1)[0]! : raw;
  return host.trim().toLowerCase();
}

export function parseOrigin(origin: string): URL | null {
  const trimmed = origin.trim();
  if (!trimmed || trimmed === "null") return null;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url;
  } catch {
    return null;
  }
}

export function isLoopbackHost(hostname: string): boolean {
  const host = hostname.trim().toLowerCase();
  if (!host) return false;
  if (host === "localhost") return true;
  if (host === "::1") return true;
  if (host === "0:0:0:0:0:0:0:1") return true;
  if (/^127(?:\.\d{1,3}){3}$/.test(host)) return true;
  return false;
}

function isAllowlisted(originUrl: URL, allowlist?: string[]): boolean {
  if (!Array.isArray(allowlist) || allowlist.length === 0) return false;

  for (const entry of allowlist) {
    if (typeof entry !== "string") continue;
    const trimmed = entry.trim();
    if (!trimmed) continue;

    if (trimmed.includes("://")) {
      try {
        const allowedUrl = new URL(trimmed);
        if (allowedUrl.origin === originUrl.origin) return true;
      } catch {
        // Ignore invalid allowlist entries.
      }
      continue;
    }

    const allowedHost = resolveHostName(trimmed);
    if (allowedHost && allowedHost === originUrl.hostname.trim().toLowerCase()) {
      return true;
    }
  }

  return false;
}

export function checkBrowserOrigin(params: {
  origin: string | undefined;
  hostHeader: string | undefined;
  allowlist?: string[];
}): OriginCheckResult {
  const originRaw = typeof params.origin === "string" ? params.origin.trim() : "";
  if (!originRaw) {
    // Non-browser WebSocket clients commonly omit Origin.
    return { ok: true };
  }

  const parsedOrigin = parseOrigin(originRaw);
  if (!parsedOrigin) {
    return { ok: false, reason: "invalid-origin" };
  }

  if (isAllowlisted(parsedOrigin, params.allowlist)) {
    return { ok: true };
  }

  const normalizedHostHeader = normalizeHostHeader(params.hostHeader);
  const requestHost = resolveHostName(normalizedHostHeader);
  if (!requestHost) {
    return { ok: false, reason: "missing-host" };
  }

  const originHost = parsedOrigin.hostname.trim().toLowerCase();
  if (originHost === requestHost) {
    return { ok: true };
  }

  if (isLoopbackHost(originHost) && isLoopbackHost(requestHost)) {
    return { ok: true };
  }

  return { ok: false, reason: "origin-mismatch" };
}

