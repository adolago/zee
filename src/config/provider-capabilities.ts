import { normalizeAccountId } from "../routing/session-key.js";
import type { ClawdbotConfig } from "./config.js";

function normalizeCapabilities(
  capabilities: string[] | undefined,
): string[] | undefined {
  if (!capabilities) return undefined;
  return capabilities.map((entry) => entry.trim()).filter(Boolean);
}

export function resolveProviderCapabilities(params: {
  cfg?: ClawdbotConfig;
  provider?: string | null;
  accountId?: string | null;
}): string[] | undefined {
  const cfg = params.cfg;
  const provider = params.provider?.trim().toLowerCase();
  if (!cfg || !provider) return undefined;

  const accountId = normalizeAccountId(params.accountId);

  switch (provider) {
    case "whatsapp":
      return normalizeCapabilities(
        cfg.whatsapp?.accounts?.[accountId]?.capabilities ??
          cfg.whatsapp?.capabilities,
      );
    case "telegram":
      return normalizeCapabilities(
        cfg.telegram?.accounts?.[accountId]?.capabilities ??
          cfg.telegram?.capabilities,
      );
    case "discord":
      return normalizeCapabilities(
        cfg.discord?.accounts?.[accountId]?.capabilities ??
          cfg.discord?.capabilities,
      );
    case "slack":
      return normalizeCapabilities(
        cfg.slack?.accounts?.[accountId]?.capabilities ?? cfg.slack?.capabilities,
      );
    case "signal":
      return normalizeCapabilities(
        cfg.signal?.accounts?.[accountId]?.capabilities ??
          cfg.signal?.capabilities,
      );
    case "imessage":
      return normalizeCapabilities(
        cfg.imessage?.accounts?.[accountId]?.capabilities ??
          cfg.imessage?.capabilities,
      );
    default:
      return undefined;
  }
}
