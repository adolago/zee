function normalizeHost(rawHost: string): string {
  const host = rawHost.trim().toLowerCase();
  if (!host) return "";
  if (host === "localhost") return "loopback";
  if (host === "::1") return "loopback";
  if (host.startsWith("127.")) return "loopback";
  if (host.startsWith("::ffff:127.")) return "loopback";
  return host;
}

function resolvePort(url: URL): string {
  if (url.port) return url.port;
  return url.protocol === "https:" ? "443" : "80";
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

export function checkBrowserOrigin(params: {
  origin: string | undefined;
  hostHeader: string | undefined;
  allowlist?: string[] | undefined;
}): boolean {
  const originRaw = params.origin?.trim();
  if (!originRaw) return true;
  if (originRaw === "null") return false;

  let originUrl: URL;
  try {
    originUrl = new URL(originRaw);
  } catch {
    return false;
  }
  if (originUrl.protocol !== "http:" && originUrl.protocol !== "https:") {
    return false;
  }

  const originKey = `${normalizeHost(originUrl.hostname)}:${resolvePort(originUrl)}`;

  const host = parseHostHeader(params.hostHeader ?? "");
  if (host && host.port) {
    const requestKey = `${normalizeHost(host.hostname)}:${host.port}`;
    if (requestKey === originKey) {
      return true;
    }
  }

  const allowlist = params.allowlist ?? [];
  for (const allowed of allowlist) {
    const allowedRaw = allowed.trim();
    if (!allowedRaw) continue;
    try {
      const url = new URL(allowedRaw);
      if (url.protocol !== "http:" && url.protocol !== "https:") continue;
      const allowedKey = `${normalizeHost(url.hostname)}:${resolvePort(url)}`;
      if (allowedKey === originKey) {
        return true;
      }
    } catch {
      continue;
    }
  }

  return false;
}

