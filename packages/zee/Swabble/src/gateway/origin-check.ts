export type OriginCheckResult = { ok: true } | { ok: false; reason: string };

function normalizeHost(rawHost: string): string {
  const host = rawHost.trim().toLowerCase();
  if (!host) return "";
  if (host === "localhost") return "loopback";
  if (host === "::1") return "loopback";
  if (host === "0:0:0:0:0:0:0:1") return "loopback";
  if (host.startsWith("127.")) return "loopback";
  if (host.startsWith("::ffff:127.")) return "loopback";
  return host;
}

function resolvePortFromProtocol(protocol: string): string {
  return protocol === "https:" ? "443" : "80";
}

function resolvePort(url: URL): string {
  return url.port || resolvePortFromProtocol(url.protocol);
}

function normalizeHostHeader(hostHeader: string | undefined): string | undefined {
  if (typeof hostHeader !== "string") return undefined;
  const trimmed = hostHeader.trim();
  if (!trimmed) return undefined;
  // Defensive: some proxies may produce comma-delimited host headers.
  return trimmed.split(",")[0]!.trim();
}

function parseHostHeader(value: string): { hostname: string; port: string | null } | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    const parsed = new URL(`http://${trimmed}`);
    return { hostname: parsed.hostname, port: parsed.port || null };
  } catch {
    return null;
  }
}

function parseOrigin(origin: string): URL | null {
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

function isAllowlisted(originKey: string, allowlist?: string[]): boolean {
  if (!Array.isArray(allowlist) || allowlist.length === 0) return false;

  for (const entry of allowlist) {
    if (typeof entry !== "string") continue;
    const trimmed = entry.trim();
    if (!trimmed) continue;
    try {
      const url = new URL(trimmed);
      if (url.protocol !== "http:" && url.protocol !== "https:") continue;
      const allowedKey = `${normalizeHost(url.hostname)}:${resolvePort(url)}`;
      if (allowedKey === originKey) return true;
    } catch {
      // Ignore invalid allowlist entries.
      continue;
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

  const originUrl = parseOrigin(originRaw);
  if (!originUrl) {
    return { ok: false, reason: "invalid-origin" };
  }

  const originKey = `${normalizeHost(originUrl.hostname)}:${resolvePort(originUrl)}`;

  if (isAllowlisted(originKey, params.allowlist)) {
    return { ok: true };
  }

  const normalizedHostHeader = normalizeHostHeader(params.hostHeader);
  const host = normalizedHostHeader ? parseHostHeader(normalizedHostHeader) : null;
  if (!host) {
    return { ok: false, reason: "missing-host" };
  }

  const requestPort = host.port ?? resolvePortFromProtocol(originUrl.protocol);
  const requestKey = `${normalizeHost(host.hostname)}:${requestPort}`;
  if (requestKey === originKey) {
    return { ok: true };
  }

  return { ok: false, reason: "origin-mismatch" };
}

