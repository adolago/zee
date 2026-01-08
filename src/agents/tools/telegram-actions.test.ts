import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ZeeConfig } from "../../config/config.js";
import {
  handleTelegramAction,
  readTelegramButtons,
} from "./telegram-actions.js";

const reactMessageTelegram = vi.fn(async () => ({ ok: true }));
const sendMessageTelegram = vi.fn(async () => ({
  messageId: "789",
  chatId: "123",
}));
const originalToken = process.env.TELEGRAM_BOT_TOKEN;

vi.mock("../../telegram/send.js", () => ({
  reactMessageTelegram: (...args: unknown[]) => reactMessageTelegram(...args),
  sendMessageTelegram: (...args: unknown[]) => sendMessageTelegram(...args),
}));

describe("handleTelegramAction", () => {
  beforeEach(() => {
    reactMessageTelegram.mockClear();
    sendMessageTelegram.mockClear();
    process.env.TELEGRAM_BOT_TOKEN = "tok";
  });

  afterEach(() => {
    if (originalToken === undefined) {
      delete process.env.TELEGRAM_BOT_TOKEN;
    } else {
      process.env.TELEGRAM_BOT_TOKEN = originalToken;
    }
  });

  it("adds reactions", async () => {
    const cfg = { telegram: { botToken: "tok" } } as ZeeConfig;
    await handleTelegramAction(
      {
        action: "react",
        chatId: "123",
        messageId: "456",
        emoji: "✅",
      },
      cfg,
    );
    expect(reactMessageTelegram).toHaveBeenCalledWith("123", 456, "✅", {
      token: "tok",
      remove: false,
    });
  });

  it("removes reactions on empty emoji", async () => {
    const cfg = { telegram: { botToken: "tok" } } as ZeeConfig;
    await handleTelegramAction(
      {
        action: "react",
        chatId: "123",
        messageId: "456",
        emoji: "",
      },
      cfg,
    );
    expect(reactMessageTelegram).toHaveBeenCalledWith("123", 456, "", {
      token: "tok",
      remove: false,
    });
  });

  it("removes reactions when remove flag set", async () => {
    const cfg = { telegram: { botToken: "tok" } } as ZeeConfig;
    await handleTelegramAction(
      {
        action: "react",
        chatId: "123",
        messageId: "456",
        emoji: "✅",
        remove: true,
      },
      cfg,
    );
    expect(reactMessageTelegram).toHaveBeenCalledWith("123", 456, "✅", {
      token: "tok",
      remove: true,
    });
  });

  it("respects reaction gating", async () => {
    const cfg = {
      telegram: { botToken: "tok", actions: { reactions: false } },
    } as ZeeConfig;
    await expect(
      handleTelegramAction(
        {
          action: "react",
          chatId: "123",
          messageId: "456",
          emoji: "✅",
        },
        cfg,
      ),
    ).rejects.toThrow(/Telegram reactions are disabled/);
  });

  it("sends a text message", async () => {
    const cfg = { telegram: { botToken: "tok" } } as ZeeConfig;
    const result = await handleTelegramAction(
      {
        action: "sendMessage",
        to: "@testchannel",
        content: "Hello, Telegram!",
      },
      cfg,
    );
    expect(sendMessageTelegram).toHaveBeenCalledWith(
      "@testchannel",
      "Hello, Telegram!",
      { token: "tok", mediaUrl: undefined },
    );
    expect(result.content).toContainEqual({
      type: "text",
      text: expect.stringContaining('"ok": true'),
    });
  });

  it("sends a message with media", async () => {
    const cfg = { telegram: { botToken: "tok" } } as ZeeConfig;
    await handleTelegramAction(
      {
        action: "sendMessage",
        to: "123456",
        content: "Check this image!",
        mediaUrl: "https://example.com/image.jpg",
      },
      cfg,
    );
    expect(sendMessageTelegram).toHaveBeenCalledWith(
      "123456",
      "Check this image!",
      { token: "tok", mediaUrl: "https://example.com/image.jpg" },
    );
  });

  it("respects sendMessage gating", async () => {
    const cfg = {
      telegram: { botToken: "tok", actions: { sendMessage: false } },
    } as ZeeConfig;
    await expect(
      handleTelegramAction(
        {
          action: "sendMessage",
          to: "@testchannel",
          content: "Hello!",
        },
        cfg,
      ),
    ).rejects.toThrow(/Telegram sendMessage is disabled/);
  });

  it("throws on missing bot token for sendMessage", async () => {
    delete process.env.TELEGRAM_BOT_TOKEN;
    const cfg = {} as ZeeConfig;
    await expect(
      handleTelegramAction(
        {
          action: "sendMessage",
          to: "@testchannel",
          content: "Hello!",
        },
        cfg,
      ),
    ).rejects.toThrow(/Telegram bot token missing/);
  });
});

describe("readTelegramButtons", () => {
  it("returns trimmed button rows for valid input", () => {
    const result = readTelegramButtons({
      buttons: [[{ text: "  Option A ", callback_data: " cmd:a " }]],
    });
    expect(result).toEqual([
      [{ text: "Option A", callback_data: "cmd:a" }],
    ]);
  });

  it("rejects non-array inputs", () => {
    expect(() => readTelegramButtons({ buttons: "nope" })).toThrow(
      /buttons must be an array/i,
    );
  });

  it("rejects non-array rows", () => {
    expect(() => readTelegramButtons({ buttons: [{}] })).toThrow(
      /buttons\[0\] must be an array/i,
    );
  });

  it("rejects invalid buttons", () => {
    expect(() =>
      readTelegramButtons({
        buttons: [[{ text: "Ok", callback_data: "" }]],
      }),
    ).toThrow(/requires text and callback_data/i);
    expect(() =>
      readTelegramButtons({
        buttons: [[{ text: "", callback_data: "cmd:ok" }]],
      }),
    ).toThrow(/requires text and callback_data/i);
    expect(() =>
      readTelegramButtons({
        buttons: [[null]],
      }),
    ).toThrow(/must be an object/i);
  });
});
