import { describe, expect, it } from "vitest";

import { discordPlugin } from "./channel.js";

describe("discord channel plugin", () => {
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
});
