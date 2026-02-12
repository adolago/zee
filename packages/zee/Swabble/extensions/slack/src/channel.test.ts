import { afterEach, describe, expect, it, vi } from "vitest";

import { slackPlugin } from "./channel.js";

describe("slack channel plugin", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    vi.unstubAllGlobals();
    globalThis.fetch = originalFetch;
  });

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

  it("lists action pack entries with policy gating", () => {
    const cfg = {
      channels: {
        slack: {
          botToken: "xoxb-token",
          actions: {
            pins: false,
            channelInfo: false,
          },
        },
      },
    } as any;

    const actions = slackPlugin.actions?.listActions?.({ cfg }) ?? [];
    expect(actions).toContain("react");
    expect(actions).not.toContain("pin");
    expect(actions).not.toContain("unpin");
    expect(actions).not.toContain("channel-info");
  });

  it("executes react action via slack api", async () => {
    const fetchSpy = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetchSpy);

    const cfg = {
      channels: {
        slack: {
          botToken: "xoxb-token",
        },
      },
    } as any;

    const result = await slackPlugin.actions?.handleAction?.({
      channel: "slack",
      action: "react",
      cfg,
      params: {
        channel: "C12345678",
        messageId: "1739137646.001",
        emoji: ":thumbsup:",
      },
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy.mock.calls[0]?.[0]).toBe("https://slack.com/api/reactions.add");
    const request = fetchSpy.mock.calls[0]?.[1] as RequestInit;
    const body = JSON.parse(String(request.body));
    expect(body).toMatchObject({
      channel: "C12345678",
      timestamp: "1739137646.001",
      name: "thumbsup",
    });
    expect((result as any)?.details).toMatchObject({
      ok: true,
      action: "react",
      channel: "C12345678",
    });
  });

  it("blocks disabled actions by policy", async () => {
    const cfg = {
      channels: {
        slack: {
          botToken: "xoxb-token",
          actions: {
            reactions: false,
          },
        },
      },
    } as any;

    await expect(
      slackPlugin.actions?.handleAction?.({
        channel: "slack",
        action: "react",
        cfg,
        params: {
          channel: "C12345678",
          messageId: "1739137646.001",
          emoji: "ok_hand",
        },
      }),
    ).rejects.toThrow("disabled by channels.slack.actions policy");
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

  it("surfaces DM open + wildcard + action surface warning", async () => {
    const cfg = {
      channels: {
        slack: {
          botToken: "xoxb-token",
          dmPolicy: "open",
          allowFrom: ["*"],
          groupPolicy: "allowlist",
          requireMention: true,
        },
      },
    } as any;

    const account = slackPlugin.config.resolveAccount(cfg, "default");
    const warnings = await slackPlugin.security?.collectWarnings?.({
      cfg,
      accountId: "default",
      account,
    });

    expect(warnings?.some((entry) => entry.includes("native actions are enabled"))).toBe(true);
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

  it("reports action-surface status issue when dm open is wide", () => {
    const issues = slackPlugin.status?.collectStatusIssues?.([
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
