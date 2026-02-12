import { afterEach, describe, expect, it, vi } from "vitest";

import { discordPlugin } from "./channel.js";

describe("discord channel plugin", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    vi.unstubAllGlobals();
    globalThis.fetch = originalFetch;
  });

  it("uses account-scoped DM policy paths for multi-account configs", () => {
    const cfg = {
      channels: {
        discord: {
          accounts: {
            guild: {
              enabled: true,
              botToken: "discord-token",
              dmPolicy: "allowlist",
              allowFrom: ["12345"],
            },
          },
        },
      },
    } as any;

    const account = discordPlugin.config.resolveAccount(cfg, "guild");
    const dmPolicy = discordPlugin.security?.resolveDmPolicy?.({
      cfg,
      accountId: "guild",
      account,
    });

    expect(dmPolicy?.policyPath).toBe("channels.discord.accounts.guild.dmPolicy");
    expect(dmPolicy?.allowFromPath).toBe("channels.discord.accounts.guild.");
  });

  it("lists action pack entries with policy gating", () => {
    const cfg = {
      channels: {
        discord: {
          botToken: "discord-token",
          actions: {
            pins: false,
            channelInfo: false,
          },
        },
      },
    } as any;

    const actions = discordPlugin.actions?.listActions?.({ cfg }) ?? [];
    expect(actions).toContain("react");
    expect(actions).not.toContain("pin");
    expect(actions).not.toContain("unpin");
    expect(actions).not.toContain("channel-info");
  });

  it("executes react action via discord api", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchSpy);

    const cfg = {
      channels: {
        discord: {
          botToken: "discord-token",
        },
      },
    } as any;

    const result = await discordPlugin.actions?.handleAction?.({
      channel: "discord",
      action: "react",
      cfg,
      params: {
        channel: "123456789012345678",
        messageId: "998877665544332211",
        emoji: "<:wave:1234>",
      },
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy.mock.calls[0]?.[0]).toBe(
      "https://discord.com/api/v10/channels/123456789012345678/messages/998877665544332211/reactions/wave%3A1234/@me",
    );
    expect((fetchSpy.mock.calls[0]?.[1] as RequestInit).method).toBe("PUT");
    expect((result as any)?.details).toMatchObject({
      ok: true,
      action: "react",
      channel: "123456789012345678",
      messageId: "998877665544332211",
      emoji: "wave:1234",
    });
  });

  it("blocks disabled actions by policy", async () => {
    const cfg = {
      channels: {
        discord: {
          botToken: "discord-token",
          actions: {
            reactions: false,
          },
        },
      },
    } as any;

    await expect(
      discordPlugin.actions?.handleAction?.({
        channel: "discord",
        action: "react",
        cfg,
        params: {
          channel: "123456789012345678",
          messageId: "998877665544332211",
          emoji: "wave",
        },
      }),
    ).rejects.toThrow("disabled by channels.discord.actions policy");
  });

  it("surfaces risky open-group configuration as a security warning", async () => {
    const cfg = {
      channels: {
        discord: {
          botToken: "discord-token",
          dmPolicy: "allowlist",
          allowFrom: ["12345"],
          groupPolicy: "open",
          requireMention: false,
        },
      },
    } as any;

    const account = discordPlugin.config.resolveAccount(cfg, "default");
    const warnings = await discordPlugin.security?.collectWarnings?.({
      cfg,
      accountId: "default",
      account,
    });

    expect(warnings?.some((entry) => entry.includes("requireMention=false"))).toBe(true);
  });

  it("surfaces DM open + wildcard + action surface warning", async () => {
    const cfg = {
      channels: {
        discord: {
          botToken: "discord-token",
          dmPolicy: "open",
          allowFrom: ["*"],
          groupPolicy: "allowlist",
          requireMention: true,
        },
      },
    } as any;

    const account = discordPlugin.config.resolveAccount(cfg, "default");
    const warnings = await discordPlugin.security?.collectWarnings?.({
      cfg,
      accountId: "default",
      account,
    });

    expect(warnings?.some((entry) => entry.includes("native actions are enabled"))).toBe(true);
  });

  it("reports missing token in status issues", async () => {
    const cfg = {
      channels: {
        discord: {
          dmPolicy: "pairing",
        },
      },
    } as any;

    const account = discordPlugin.config.resolveAccount(cfg, "default");
    const snapshot = await discordPlugin.status?.buildAccountSnapshot?.({
      cfg,
      account,
    });
    const issues = discordPlugin.status?.collectStatusIssues?.([snapshot ?? { accountId: "default" }]);

    expect(issues?.some((issue) => issue.message.includes("token is missing"))).toBe(true);
  });

  it("reports action-surface status issue when dm open is wide", () => {
    const issues = discordPlugin.status?.collectStatusIssues?.([
      {
        accountId: "default",
        enabled: true,
        configured: true,
        dmPolicy: "open",
        allowFrom: ["*"],
        mode: "allowlist",
        allowUnmentionedGroups: false,
        actions: {
          reactions: true,
        },
      },
    ]);
    expect(issues?.some((issue) => issue.message.includes("Action surface is enabled"))).toBe(true);
  });
});
