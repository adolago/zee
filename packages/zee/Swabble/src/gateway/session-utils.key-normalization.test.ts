import { describe, expect, it, vi } from "vitest";

let mockStore: Record<string, unknown> = {};

vi.mock("../agents/agent-scope.js", () => ({
  resolveAgentWorkspaceDir: () => "/tmp/ops",
  resolveDefaultAgentId: () => "ops",
}));

vi.mock("../agents/context.js", () => ({
  lookupContextTokens: () => undefined,
}));

vi.mock("../agents/defaults.js", () => ({
  DEFAULT_CONTEXT_TOKENS: 8192,
  DEFAULT_MODEL: "gpt-4o-mini",
  DEFAULT_PROVIDER: "openai",
}));

vi.mock("../agents/model-selection.js", () => ({
  resolveConfiguredModelRef: () => ({ provider: "openai", model: "gpt-4o-mini" }),
}));

vi.mock("../config/config.js", () => ({
  loadConfig: () => ({}),
}));

vi.mock("../config/paths.js", () => ({
  resolveStateDir: () => "/tmp",
}));

vi.mock("../routing/session-key.js", () => ({
  normalizeAgentId: (value: string) => value.trim().toLowerCase(),
  normalizeMainKey: (value?: string) =>
    typeof value === "string" && value.trim() ? value.trim().toLowerCase() : "main",
  parseAgentSessionKey: (value: string) => {
    const parts = value.split(":");
    if (parts.length < 3 || parts[0] !== "agent") return null;
    return { agentId: parts[1], rest: parts.slice(2).join(":") };
  },
}));

vi.mock("../utils/delivery-context.js", () => ({
  normalizeSessionDeliveryFields: () => ({
    deliveryContext: undefined,
    lastChannel: undefined,
    lastTo: undefined,
    lastAccountId: undefined,
    lastThreadId: undefined,
  }),
}));

vi.mock("../config/sessions.js", () => ({
  buildGroupDisplayName: () => undefined,
  canonicalizeMainSessionAlias: ({
    cfg,
    agentId,
    sessionKey,
  }: {
    cfg: { session?: { mainKey?: string } };
    agentId: string;
    sessionKey: string;
  }) => {
    const lowered = sessionKey.toLowerCase();
    const mainKey = (cfg.session?.mainKey ?? "main").toLowerCase();
    if (lowered === `agent:${agentId}:main` || lowered === `agent:${agentId}:${mainKey}`) {
      return `agent:${agentId}:${mainKey}`;
    }
    return lowered;
  },
  loadSessionStore: () => mockStore,
  resolveMainSessionKey: (cfg: { session?: { mainKey?: string } }) =>
    `agent:ops:${(cfg.session?.mainKey ?? "main").toLowerCase()}`,
  resolveStorePath: (store?: string, opts?: { agentId?: string }) => {
    if (typeof store === "string" && store.trim()) {
      return store.replace("{agentId}", opts?.agentId ?? "ops");
    }
    return `/tmp/${opts?.agentId ?? "ops"}/sessions.json`;
  },
}));

vi.mock("./session-utils.fs.js", () => ({
  archiveFileOnDisk: vi.fn(),
  capArrayByJsonBytes: vi.fn(),
  readFirstUserMessageFromTranscript: () => null,
  readLastMessagePreviewFromTranscript: () => null,
  readSessionPreviewItemsFromTranscript: vi.fn(),
  readSessionMessages: vi.fn(),
  resolveSessionTranscriptCandidates: vi.fn(),
}));

import {
  findStoreKeysIgnoreCase,
  pruneLegacyStoreKeys,
  resolveGatewaySessionStoreTarget,
  resolveSessionStoreKey,
} from "./session-utils.js";

describe("session key normalization", () => {
  it("normalizes bare and prefixed keys to lowercase", () => {
    const cfg = { session: { mainKey: "main" }, agents: { list: [{ id: "ops", default: true }] } };
    expect(resolveSessionStoreKey({ cfg, sessionKey: "MySession" })).toBe("agent:ops:mysession");
    expect(resolveSessionStoreKey({ cfg, sessionKey: "agent:ops:CoP" })).toBe("agent:ops:cop");
  });

  it("resolves mixed-case main aliases", () => {
    const cfg = { session: { mainKey: "work" }, agents: { list: [{ id: "ops", default: true }] } };
    expect(resolveSessionStoreKey({ cfg, sessionKey: "MAIN" })).toBe("agent:ops:work");
    expect(resolveSessionStoreKey({ cfg, sessionKey: "agent:ops:MAIN" })).toBe("agent:ops:work");
  });

  it("includes legacy mixed-case keys in gateway target", () => {
    mockStore = {
      "agent:ops:MySession": { sessionId: "s1", updatedAt: 1 },
      "agent:ops:mysession": { sessionId: "s2", updatedAt: 2 },
    };
    const cfg = {
      session: { mainKey: "main", store: "/tmp/sessions.json" },
      agents: { list: [{ id: "ops", default: true }] },
    };

    const target = resolveGatewaySessionStoreTarget({ cfg, key: "agent:ops:mysession" });
    expect(target.canonicalKey).toBe("agent:ops:mysession");
    expect(target.storeKeys).toEqual(
      expect.arrayContaining(["agent:ops:mysession", "agent:ops:MySession"]),
    );
  });

  it("finds and prunes legacy key variants", () => {
    const store: Record<string, unknown> = {
      "agent:ops:mysession": { sessionId: "new" },
      "agent:ops:MySession": { sessionId: "old" },
      "agent:ops:MYSession": { sessionId: "older" },
    };

    expect(findStoreKeysIgnoreCase(store, "agent:ops:mysession")).toHaveLength(3);
    pruneLegacyStoreKeys({
      store,
      canonicalKey: "agent:ops:mysession",
      candidates: ["agent:ops:mysession", "agent:ops:MySession", "agent:ops:MYSession"],
    });

    expect(Object.keys(store)).toEqual(["agent:ops:mysession"]);
  });
});
