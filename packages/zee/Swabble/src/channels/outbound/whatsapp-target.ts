export type OutboundMode = "explicit" | "implicit" | "heartbeat";

export type ResolveTargetResult =
  | { ok: true; to: string }
  | { ok: false; error: Error };

function missingTargetError(): Error {
  return new Error("Delivering to WhatsApp requires target <E.164|group JID>.");
}

function isWhatsAppGroupJid(value: string): boolean {
  return /^\d+(?::\d+)?@g\.us$/i.test(value);
}

export function normalizeWhatsAppTarget(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const withoutPrefix = trimmed.replace(/^whatsapp:/i, "").trim();
  if (!withoutPrefix) return null;

  const lowered = withoutPrefix.toLowerCase();
  if (isWhatsAppGroupJid(lowered)) return lowered;

  const jidMatch = /^(\+?\d+)(?::\d+)?@(?:s\.whatsapp\.net|c\.us)$/i.exec(withoutPrefix);
  if (jidMatch?.[1]) {
    const digits = jidMatch[1].replace(/\D/g, "");
    if (digits.length >= 7 && digits.length <= 15) return `+${digits}`;
    return null;
  }

  if (/^\+\d{7,15}$/.test(withoutPrefix)) return withoutPrefix;

  const digits = withoutPrefix.replace(/\D/g, "");
  if (digits.length >= 7 && digits.length <= 15) return `+${digits}`;

  return null;
}

export function resolveWhatsAppOutboundTarget(params: {
  to?: string;
  allowFrom?: string[];
  mode: OutboundMode;
}): ResolveTargetResult {
  const trimmed = params.to?.trim() ?? "";
  const allowListRaw = (params.allowFrom ?? []).map((entry) => String(entry).trim()).filter(Boolean);
  const hasWildcard = allowListRaw.includes("*");
  const allowList = allowListRaw
    .filter((entry) => entry !== "*")
    .map((entry) => normalizeWhatsAppTarget(entry))
    .filter((entry): entry is string => Boolean(entry));

  if (trimmed) {
    const normalizedTo = normalizeWhatsAppTarget(trimmed);
    if (!normalizedTo) {
      return { ok: false, error: missingTargetError() };
    }
    if (isWhatsAppGroupJid(normalizedTo)) {
      return { ok: true, to: normalizedTo };
    }
    if (params.mode === "implicit" || params.mode === "heartbeat") {
      if (hasWildcard || allowList.length === 0) {
        return { ok: true, to: normalizedTo };
      }
      if (allowList.includes(normalizedTo)) {
        return { ok: true, to: normalizedTo };
      }
      return { ok: false, error: missingTargetError() };
    }
    return { ok: true, to: normalizedTo };
  }

  return { ok: false, error: missingTargetError() };
}
