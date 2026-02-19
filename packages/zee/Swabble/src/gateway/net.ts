function normalizeIp(raw: string | undefined): string | undefined {
  if (typeof raw !== "string") return undefined;
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  const unwrapped = trimmed.startsWith("[") && trimmed.endsWith("]") ? trimmed.slice(1, -1) : trimmed;
  const lowered = unwrapped.toLowerCase();
  if (!lowered) return undefined;
  return lowered.startsWith("::ffff:") ? lowered.slice("::ffff:".length) : lowered;
}

function parseForwardedList(value: string | undefined): string[] {
  if (typeof value !== "string") return [];
  return value
    .split(",")
    .map((entry) => normalizeIp(entry))
    .filter((entry): entry is string => Boolean(entry));
}

function isTrustedProxy(remoteIp: string, trustedProxies: string[] | undefined): boolean {
  if (!Array.isArray(trustedProxies) || trustedProxies.length === 0) return false;
  const normalized = normalizeIp(remoteIp);
  if (!normalized) return false;
  for (const candidate of trustedProxies) {
    if (candidate === "*") return true;
    const trusted = normalizeIp(candidate);
    if (trusted && trusted === normalized) return true;
  }
  return false;
}

export function resolveGatewayClientIp(params: {
  remoteAddr: string;
  forwardedFor?: string;
  realIp?: string;
  trustedProxies?: string[];
}): string | undefined {
  const remoteIp = normalizeIp(params.remoteAddr);
  if (!remoteIp) return undefined;

  if (!isTrustedProxy(remoteIp, params.trustedProxies)) {
    return remoteIp;
  }

  const forwardedList = parseForwardedList(params.forwardedFor);
  if (forwardedList.length > 0) return forwardedList[0];

  const realIp = normalizeIp(params.realIp);
  if (realIp) return realIp;

  return remoteIp;
}

