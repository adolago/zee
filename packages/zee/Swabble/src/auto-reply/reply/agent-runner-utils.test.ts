import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getChannelDock: vi.fn(),
}));

vi.mock("../../channels/dock.js", () => ({
  getChannelDock: mocks.getChannelDock,
}));

import { buildThreadingToolContext } from "./agent-runner-utils.js";

describe("buildThreadingToolContext", () => {
  beforeEach(() => {
    mocks.getChannelDock.mockReset();
  });

  it("falls back to session MessageThreadId when channel dock has no threading adapter", () => {
    mocks.getChannelDock.mockReturnValue(undefined);
    const hasRepliedRef = { value: false };

    const context = buildThreadingToolContext({
      sessionCtx: {
        Provider: "slack",
        To: "C12345",
        MessageThreadId: "1700000000.001",
      } as never,
      config: {} as never,
      hasRepliedRef,
    });

    expect(context).toMatchObject({
      currentChannelId: "C12345",
      currentChannelProvider: "slack",
      currentThreadTs: "1700000000.001",
      hasRepliedRef,
    });
  });

  it("applies MessageThreadId fallback when dock context omits currentThreadTs", () => {
    mocks.getChannelDock.mockReturnValue({
      threading: {
        buildToolContext: () => ({
          currentChannelId: "C-threaded",
        }),
      },
    });

    const context = buildThreadingToolContext({
      sessionCtx: {
        Provider: "whatsapp",
        To: "C12345",
        MessageThreadId: "1700000000.002",
      } as never,
      config: {} as never,
      hasRepliedRef: { value: false },
    });

    expect(context.currentChannelId).toBe("C-threaded");
    expect(context.currentThreadTs).toBe("1700000000.002");
  });

  it("keeps dock-provided currentThreadTs when present", () => {
    mocks.getChannelDock.mockReturnValue({
      threading: {
        buildToolContext: () => ({
          currentChannelId: "C-threaded",
          currentThreadTs: "dock-thread",
        }),
      },
    });

    const context = buildThreadingToolContext({
      sessionCtx: {
        Provider: "whatsapp",
        To: "C12345",
        MessageThreadId: "1700000000.003",
      } as never,
      config: {} as never,
      hasRepliedRef: { value: false },
    });

    expect(context.currentThreadTs).toBe("dock-thread");
  });
});
