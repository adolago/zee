import { describe, expect, it } from "vitest";

import { slackPlugin } from "./channel.js";

describe("slack channel plugin", () => {
  it("uses account-scoped DM policy paths for multi-account configs", () => {
    const cfg = {
      channels: {
        slack: {
          accounts: {
            work: {
              enabled: true,
              botToken: "xoxb-token",
              dmPolicy: "allowlist",
              allowFrom: ["U123"],
            },
          },
        },
      },
    } as any;

    const account = slackPlugin.config.resolveAccount(cfg, "work");
    const dmPolicy = slackPlugin.security?.resolveDmPolicy?.({
      cfg,
      accountId: "work",
      account,
    });

    expect(dmPolicy?.policyPath).toBe("channels.slack.accounts.work.dmPolicy");
    expect(dmPolicy?.allowFromPath).toBe("channels.slack.accounts.work.");
  });

  it("surfaces risky open-group configuration as a security warning", async () => {
    const cfg = {
      channels: {
        slack: {
          botToken: "xoxb-token",
          dmPolicy: "allowlist",
          allowFrom: ["U123"],
          groupPolicy: "open",
          requireMention: false,
        },
      },
    } as any;

    const account = slackPlugin.config.resolveAccount(cfg, "default");
    const warnings = await slackPlugin.security?.collectWarnings?.({
      cfg,
      accountId: "default",
      account,
    });

    expect(warnings?.some((entry) => entry.includes("requireMention=false"))).toBe(true);
  });

  it("reports missing token in status issues", async () => {
    const cfg = {
      channels: {
        slack: {
          dmPolicy: "pairing",
        },
      },
    } as any;

    const account = slackPlugin.config.resolveAccount(cfg, "default");
    const snapshot = await slackPlugin.status?.buildAccountSnapshot?.({
      cfg,
      account,
    });
    const issues = slackPlugin.status?.collectStatusIssues?.([snapshot ?? { accountId: "default" }]);

    expect(issues?.some((issue) => issue.message.includes("token is missing"))).toBe(true);
  });
});
