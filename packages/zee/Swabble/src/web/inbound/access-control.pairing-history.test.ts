import { beforeEach, describe, expect, it, vi } from "vitest";

import { checkInboundAccessControl } from "./access-control.js";

let config: Record<string, unknown> = {};

vi.mock("../../config/config.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../config/config.js")>();
  return {
    ...actual,
    loadConfig: () => config,
  };
});

beforeEach(() => {
  config = {
    channels: {
      whatsapp: {},
    },
  };
});

describe("checkInboundAccessControl", () => {
  it("blocks unauthorized senders by default", async () => {
    const result = await checkInboundAccessControl({
      accountId: "default",
      from: "+15550001111",
      selfE164: "+15550009999",
      senderE164: "+15550001111",
      group: false,
      pushName: "Sam",
      isFromMe: false,
      remoteJid: "15550001111@s.whatsapp.net",
    });

    expect(result.allowed).toBe(false);
    expect(result.shouldMarkRead).toBe(false);
  });

  it("allows senders in allowFrom when policy is allowlist", async () => {
    config = {
      channels: {
        whatsapp: {
          allowFrom: ["+15550001111"],
        },
      },
    };

    const result = await checkInboundAccessControl({
      accountId: "default",
      from: "+15550001111",
      selfE164: "+15550009999",
      senderE164: "+15550001111",
      group: false,
      pushName: "Sam",
      isFromMe: false,
      remoteJid: "15550001111@s.whatsapp.net",
    });

    expect(result.allowed).toBe(true);
    expect(result.shouldMarkRead).toBe(true);
  });

  it("allows same-phone senders even when not allowlisted", async () => {
    const result = await checkInboundAccessControl({
      accountId: "default",
      from: "+15550009999",
      selfE164: "+15550009999",
      senderE164: "+15550009999",
      group: false,
      pushName: "Sam",
      isFromMe: false,
      remoteJid: "15550001111@s.whatsapp.net",
    });

    expect(result.allowed).toBe(true);
    expect(result.shouldMarkRead).toBe(true);
  });

  it("uses allowlist when dmPolicy is unset but allowFrom is configured", async () => {
    config = {
      channels: {
        whatsapp: {
          allowFrom: ["+15550001111"],
        },
      },
    };

    const result = await checkInboundAccessControl({
      accountId: "default",
      from: "+15550001111",
      selfE164: "+15550009999",
      senderE164: "+15550001111",
      group: false,
      pushName: "Sam",
      isFromMe: false,
      remoteJid: "15550001111@s.whatsapp.net",
    });

    expect(result.allowed).toBe(true);
    expect(result.shouldMarkRead).toBe(true);
  });
});
