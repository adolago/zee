import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resolveMessageChannelSelection: vi.fn(),
  resolveChannelTarget: vi.fn(),
  executeSendAction: vi.fn(),
  resolveOutboundSessionRoute: vi.fn(),
  ensureOutboundSessionEntry: vi.fn(),
}));

vi.mock("./channel-selection.js", async () => {
  const actual = await vi.importActual<typeof import("./channel-selection.js")>(
    "./channel-selection.js",
  );
  return {
    ...actual,
    resolveMessageChannelSelection: mocks.resolveMessageChannelSelection,
  };
});

vi.mock("./target-resolver.js", async () => {
  const actual = await vi.importActual<typeof import("./target-resolver.js")>("./target-resolver.js");
  return {
    ...actual,
    resolveChannelTarget: mocks.resolveChannelTarget,
  };
});

vi.mock("./outbound-send-service.js", async () => {
  const actual = await vi.importActual<typeof import("./outbound-send-service.js")>(
    "./outbound-send-service.js",
  );
  return {
    ...actual,
    executeSendAction: mocks.executeSendAction,
  };
});

vi.mock("./outbound-session.js", async () => {
  const actual = await vi.importActual<typeof import("./outbound-session.js")>(
    "./outbound-session.js",
  );
  return {
    ...actual,
    resolveOutboundSessionRoute: mocks.resolveOutboundSessionRoute,
    ensureOutboundSessionEntry: mocks.ensureOutboundSessionEntry,
  };
});

import { runMessageAction } from "./message-action-runner.js";

describe("runMessageAction thread context fallback", () => {
  beforeEach(() => {
    mocks.resolveMessageChannelSelection.mockReset();
    mocks.resolveChannelTarget.mockReset();
    mocks.executeSendAction.mockReset();
    mocks.resolveOutboundSessionRoute.mockReset();
    mocks.ensureOutboundSessionEntry.mockReset();

    mocks.resolveMessageChannelSelection.mockResolvedValue({ channel: "slack" });
    mocks.resolveChannelTarget.mockResolvedValue({
      ok: true,
      target: {
        id: "C123",
        to: "C123",
        kind: "group",
      },
    });
    mocks.executeSendAction.mockResolvedValue({
      handledBy: "plugin",
      payload: { ok: true },
      sendResult: {
        channel: "slack",
        messageId: "m-1",
        channelId: "C123",
      },
    });
    mocks.resolveOutboundSessionRoute.mockResolvedValue(null);
  });

  it("uses toolContext.currentThreadTs when params.threadId is missing", async () => {
    await runMessageAction({
      cfg: {} as never,
      action: "send",
      params: {
        channel: "slack",
        target: "C123",
        message: "hello from thread context",
      },
      agentId: "agent-main",
      toolContext: {
        currentChannelProvider: "slack",
        currentChannelId: "C123",
        currentThreadTs: "1700000000.111",
      },
    });

    expect(mocks.resolveOutboundSessionRoute).toHaveBeenCalledTimes(1);
    const routeArgs = mocks.resolveOutboundSessionRoute.mock.calls[0]?.[0];
    expect(routeArgs?.threadId).toBe("1700000000.111");

    const sendArgs = mocks.executeSendAction.mock.calls[0]?.[0];
    expect(sendArgs?.ctx?.params?.threadId).toBe("1700000000.111");
  });

  it("prefers explicit params.threadId over toolContext.currentThreadTs", async () => {
    await runMessageAction({
      cfg: {} as never,
      action: "send",
      params: {
        channel: "slack",
        target: "C123",
        message: "hello explicit thread",
        threadId: "manual-thread-id",
      },
      agentId: "agent-main",
      toolContext: {
        currentChannelProvider: "slack",
        currentChannelId: "C123",
        currentThreadTs: "1700000000.222",
      },
    });

    expect(mocks.resolveOutboundSessionRoute).toHaveBeenCalledTimes(1);
    const routeArgs = mocks.resolveOutboundSessionRoute.mock.calls[0]?.[0];
    expect(routeArgs?.threadId).toBe("manual-thread-id");

    const sendArgs = mocks.executeSendAction.mock.calls[0]?.[0];
    expect(sendArgs?.ctx?.params?.threadId).toBe("manual-thread-id");
  });
});
