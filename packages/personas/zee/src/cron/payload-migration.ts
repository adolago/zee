type UnknownRecord = Record<string, unknown>;

function readString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  return value;
}

function normalizeChannel(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!normalized) return "";
  // Zee cron delivery currently supports WhatsApp only.
  return "whatsapp";
}

export function migrateLegacyCronPayload(payload: UnknownRecord): boolean {
  let mutated = false;

  const channelValue = readString(payload.channel);
  const providerValue = readString(payload.provider);

  const sourceChannel =
    typeof channelValue === "string" && channelValue.trim().length > 0
      ? channelValue
      : typeof providerValue === "string" && providerValue.trim().length > 0
        ? providerValue
        : "";

  const nextChannel = sourceChannel
    ? normalizeChannel(sourceChannel)
    : "";

  if (nextChannel) {
    if (channelValue !== nextChannel) {
      payload.channel = nextChannel;
      mutated = true;
    }
  }

  if ("provider" in payload) {
    delete payload.provider;
    mutated = true;
  }

  return mutated;
}
