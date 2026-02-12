import { describe, expect, it } from "vitest";

import { telegramPlugin } from "./channel.js";

describe("telegram channel plugin", () => {
  it("uses account-scoped DM policy paths for multi-account configs", () => {
    const cfg = {
      channels: {
        telegram: {
          accounts: {
            personal: {
              enabled: true,
              botToken: "token-1",
              dmPolicy: "allowlist",
              allowFrom: ["12345"],
            },
          },
        },
      },
    } as any;

    const account = telegramPlugin.config.resolveAccount(cfg, "personal");
    const dmPolicy = telegramPlugin.security?.resolveDmPolicy?.({
      cfg,
      accountId: "personal",
      account,
    });

    expect(dmPolicy?.policyPath).toBe("channels.telegram.accounts.personal.dmPolicy");
    expect(dmPolicy?.allowFromPath).toBe("channels.telegram.accounts.personal.");
  });

  it("surfaces risky open-group configuration as a security warning", async () => {
    const cfg = {
      channels: {
        telegram: {
          botToken: "token-1",
          dmPolicy: "allowlist",
          allowFrom: ["12345"],
          groupPolicy: "open",
          requireMention: false,
        },
      },
    } as any;

    const account = telegramPlugin.config.resolveAccount(cfg, "default");
    const warnings = await telegramPlugin.security?.collectWarnings?.({
      cfg,
      accountId: "default",
      account,
    });

    expect(warnings?.some((entry) => entry.includes("requireMention=false"))).toBe(true);
  });

  it("reports missing token in status issues", async () => {
    const cfg = {
      channels: {
        telegram: {
          dmPolicy: "pairing",
        },
      },
    } as any;

    const account = telegramPlugin.config.resolveAccount(cfg, "default");
    const snapshot = await telegramPlugin.status?.buildAccountSnapshot?.({
      cfg,
      account,
    });
    const issues = telegramPlugin.status?.collectStatusIssues?.([snapshot ?? { accountId: "default" }]);

    expect(issues?.some((issue) => issue.message.includes("token is missing"))).toBe(true);
  });
});
