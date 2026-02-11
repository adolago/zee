import { describe, expect, it } from "vitest";

import type { ConfigFileSnapshot } from "./types.js";
import {
  REDACTED_SENTINEL,
  redactConfigObject,
  redactConfigSnapshot,
  restoreRedactedValues,
} from "./redact-snapshot.js";

function makeSnapshot(config: Record<string, unknown>, raw?: string): ConfigFileSnapshot {
  return {
    path: "/home/user/.config/zee/config.json5",
    exists: true,
    raw: raw ?? JSON.stringify(config),
    parsed: config,
    valid: true,
    config: config as ConfigFileSnapshot["config"],
    hash: "abc123",
    issues: [],
    warnings: [],
    legacyIssues: [],
  };
}

describe("redactConfigObject", () => {
  it("redacts token/password/apiKey values but preserves env references and non-sensitive keys", () => {
    const input = {
      gateway: {
        auth: {
          token: "token-1",
          password: "${ZEE_GATEWAY_PASSWORD}",
        },
      },
      whatsapp: {
        tokenSource: "none",
      },
      apiKey: "api-key-1",
    };

    const out = redactConfigObject(input) as typeof input;
    expect(out.gateway.auth.token).toBe(REDACTED_SENTINEL);
    expect(out.gateway.auth.password).toBe("${ZEE_GATEWAY_PASSWORD}");
    expect(out.whatsapp.tokenSource).toBe("none");
    expect(out.apiKey).toBe(REDACTED_SENTINEL);
  });
});

describe("redactConfigSnapshot", () => {
  it("redacts top-level token fields", () => {
    const snapshot = makeSnapshot({
      gateway: { auth: { token: "my-super-secret-gateway-token-value" } },
    });
    const result = redactConfigSnapshot(snapshot);
    expect(result.config).toEqual({
      gateway: { auth: { token: REDACTED_SENTINEL } },
    });
  });

  it("redacts apiKey in model providers", () => {
    const snapshot = makeSnapshot({
      models: {
        providers: {
          openai: { apiKey: "sk-proj-abcdef1234567890ghij", baseUrl: "https://api.openai.com" },
        },
      },
    });
    const result = redactConfigSnapshot(snapshot);
    const models = result.config.models as Record<string, Record<string, Record<string, string>>>;
    expect(models.providers.openai.apiKey).toBe(REDACTED_SENTINEL);
    expect(models.providers.openai.baseUrl).toBe("https://api.openai.com");
  });

  it("redacts password fields", () => {
    const snapshot = makeSnapshot({
      gateway: { auth: { password: "super-secret-password-value-here" } },
    });
    const result = redactConfigSnapshot(snapshot);
    const gw = result.config.gateway as Record<string, Record<string, string>>;
    expect(gw.auth.password).toBe(REDACTED_SENTINEL);
  });

  it("redacts accessToken fields", () => {
    const snapshot = makeSnapshot({
      channels: {
        whatsapp: { accessToken: "whatsapp-access-token-value-here-1234" },
      },
    });
    const result = redactConfigSnapshot(snapshot);
    const channels = result.config.channels as Record<string, Record<string, string>>;
    expect(channels.whatsapp.accessToken).toBe(REDACTED_SENTINEL);
  });

  it("redacts short secrets with the same sentinel", () => {
    const snapshot = makeSnapshot({
      gateway: { auth: { token: "short" } },
    });
    const result = redactConfigSnapshot(snapshot);
    const gw = result.config.gateway as Record<string, Record<string, string>>;
    expect(gw.auth.token).toBe(REDACTED_SENTINEL);
  });

  it("preserves non-sensitive fields", () => {
    const snapshot = makeSnapshot({
      ui: { seamColor: "#0088cc" },
      gateway: { port: 18789 },
      models: { providers: { openai: { baseUrl: "https://api.openai.com" } } },
    });
    const result = redactConfigSnapshot(snapshot);
    expect(result.config).toEqual(snapshot.config);
  });

  it("preserves hash unchanged", () => {
    const snapshot = makeSnapshot({ gateway: { auth: { token: "secret-token-value-here" } } });
    const result = redactConfigSnapshot(snapshot);
    expect(result.hash).toBe("abc123");
  });

  it("redacts secrets in raw field", () => {
    const config = { token: "abcdef1234567890ghij" };
    const raw = '{ "token": "abcdef1234567890ghij" }';
    const snapshot = makeSnapshot(config, raw);
    const result = redactConfigSnapshot(snapshot);
    expect(result.raw).not.toContain("abcdef1234567890ghij");
    expect(result.raw).toContain(REDACTED_SENTINEL);
  });

  it("redacts parsed object as well", () => {
    const config = {
      channels: { whatsapp: { accessToken: "this-is-a-token" } },
    };
    const snapshot = makeSnapshot(config);
    const result = redactConfigSnapshot(snapshot);
    const parsed = result.parsed as Record<string, Record<string, Record<string, string>>>;
    expect(parsed.channels.whatsapp.accessToken).toBe(REDACTED_SENTINEL);
  });

  it("handles null raw gracefully", () => {
    const snapshot: ConfigFileSnapshot = {
      path: "/test",
      exists: false,
      raw: null,
      parsed: null,
      valid: false,
      config: {} as ConfigFileSnapshot["config"],
      issues: [],
      warnings: [],
      legacyIssues: [],
    };
    const result = redactConfigSnapshot(snapshot);
    expect(result.raw).toBeNull();
    expect(result.parsed).toBeNull();
  });

  it("redacts env vars that look like secrets", () => {
    const snapshot = makeSnapshot({
      env: {
        vars: {
          OPENAI_API_KEY: "sk-proj-1234567890abcdefghij",
          NODE_ENV: "production",
        },
      },
    });
    const result = redactConfigSnapshot(snapshot);
    const env = result.config.env as Record<string, Record<string, string>>;
    expect(env.vars.OPENAI_API_KEY).toBe(REDACTED_SENTINEL);
    // NODE_ENV is not sensitive, should be preserved
    expect(env.vars.NODE_ENV).toBe("production");
  });

  it("redacts raw by key pattern even when parsed config is empty", () => {
    const snapshot: ConfigFileSnapshot = {
      path: "/test",
      exists: true,
      raw: '{ token: \"raw-secret-1234567890\" }',
      parsed: {},
      valid: false,
      config: {} as ConfigFileSnapshot["config"],
      issues: [],
      warnings: [],
      legacyIssues: [],
    };
    const result = redactConfigSnapshot(snapshot);
    expect(result.raw).not.toContain("raw-secret-1234567890");
    expect(result.raw).toContain(REDACTED_SENTINEL);
  });
});

describe("restoreRedactedValues", () => {
  it("restores sentinel values from original config", () => {
    const incoming = {
      gateway: { auth: { token: REDACTED_SENTINEL } },
    };
    const original = {
      gateway: { auth: { token: "real-secret-token-value" } },
    };
    const result = restoreRedactedValues(incoming, original) as typeof incoming;
    expect(result.gateway.auth.token).toBe("real-secret-token-value");
  });

  it("preserves explicitly changed sensitive values", () => {
    const incoming = {
      gateway: { auth: { token: "new-token-value-from-user" } },
    };
    const original = {
      gateway: { auth: { token: "old-token-value" } },
    };
    const result = restoreRedactedValues(incoming, original) as typeof incoming;
    expect(result.gateway.auth.token).toBe("new-token-value-from-user");
  });

  it("preserves non-sensitive fields unchanged", () => {
    const incoming = {
      ui: { seamColor: "#ff0000" },
      gateway: { port: 9999, auth: { token: REDACTED_SENTINEL } },
    };
    const original = {
      ui: { seamColor: "#0088cc" },
      gateway: { port: 18789, auth: { token: "real-secret" } },
    };
    const result = restoreRedactedValues(incoming, original) as typeof incoming;
    expect(result.ui.seamColor).toBe("#ff0000");
    expect(result.gateway.port).toBe(9999);
    expect(result.gateway.auth.token).toBe("real-secret");
  });

  it("handles deeply nested sentinel restoration", () => {
    const incoming = {
      channels: {
        whatsapp: {
          accounts: {
            acct1: { accessToken: REDACTED_SENTINEL },
            acct2: { accessToken: "user-typed-new-token-value" },
          },
        },
      },
    };
    const original = {
      channels: {
        whatsapp: {
          accounts: {
            acct1: { accessToken: "original-acct1-token-value" },
            acct2: { accessToken: "original-acct2-token-value" },
          },
        },
      },
    };
    const result = restoreRedactedValues(incoming, original) as typeof incoming;
    expect(result.channels.whatsapp.accounts.acct1.accessToken).toBe("original-acct1-token-value");
    expect(result.channels.whatsapp.accounts.acct2.accessToken).toBe("user-typed-new-token-value");
  });

  it("throws when base is missing a redacted value", () => {
    const incoming = {
      channels: { whatsapp: { accessToken: REDACTED_SENTINEL } },
    };
    const original = {};
    expect(() => restoreRedactedValues(incoming, original)).toThrow(/redacted/i);
  });

  it("handles null and undefined inputs", () => {
    expect(restoreRedactedValues(null, { token: "x" })).toBeNull();
    expect(restoreRedactedValues(undefined, { token: "x" })).toBeUndefined();
  });

  it("round-trips config through redact -> restore", () => {
    const originalConfig = {
      gateway: { auth: { token: "gateway-auth-secret-token-value" }, port: 18789 },
      channels: {
        whatsapp: { accessToken: "fake-whatsapp-access-token-value" },
      },
      models: {
        providers: {
          openai: {
            apiKey: "sk-proj-fake-openai-api-key-value",
            baseUrl: "https://api.openai.com",
          },
        },
      },
      ui: { seamColor: "#0088cc" },
    };
    const snapshot = makeSnapshot(originalConfig);

    // Redact (simulates config.get response)
    const redacted = redactConfigSnapshot(snapshot);

    // Restore (simulates config.set before write)
    const restored = restoreRedactedValues(redacted.config, snapshot.config);

    expect(restored).toEqual(originalConfig);
  });
});
