import type { ChannelOutboundAdapter } from "../types.js";

type TelegramSendResult = {
  messageId: string;
  chatId?: string;
  [key: string]: unknown;
};

/**
 * Lightweight outbound adapter for Telegram-like channels.
 *
 * Zee does not bundle a Telegram implementation by default; this adapter is
 * intended for channel plugins and tests that provide `deps.sendTelegram`.
 */
export const telegramOutbound: ChannelOutboundAdapter = {
  deliveryMode: "direct",
  sendText: async ({ to, text, deps }) => {
    const send = deps?.sendTelegram;
    if (!send) {
      throw new Error("Telegram outbound adapter requires deps.sendTelegram");
    }
    const res = (await send(to, text, { verbose: false })) as TelegramSendResult;
    return { channel: "telegram", ...res };
  },
  sendMedia: async ({ to, text, mediaUrl, deps }) => {
    const send = deps?.sendTelegram;
    if (!send) {
      throw new Error("Telegram outbound adapter requires deps.sendTelegram");
    }
    const res = (await send(to, text, { verbose: false, mediaUrl })) as TelegramSendResult;
    return { channel: "telegram", ...res };
  },
};

