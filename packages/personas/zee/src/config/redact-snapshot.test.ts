import { describe, expect, it } from "vitest";
import {
  REDACTED_SENTINEL,
  redactConfigObject,
  redactConfigSnapshot,
  restoreRedactedValues,
} from "./redact-snapshot.js";

describe("config redaction", () => {
  it("redacts token/password values but preserves env references", () => {
    const input = {
      gateway: {
        auth: {
          token: "token-1",
          password: "${ZEE_GATEWAY_PASSWORD}",
        },
      },
      matrix: {
        tokenSource: "none",
      },
      apiKey: "api-key-1",
    };

    const out = redactConfigObject(input);
    expect(out.gateway.auth.token).toBe(REDACTED_SENTINEL);
    expect(out.gateway.auth.password).toBe("${ZEE_GATEWAY_PASSWORD}");
    expect(out.matrix.tokenSource).toBe("none");
    expect(out.apiKey).toBe(REDACTED_SENTINEL);
  });

  it("redacts raw snapshots and restores sentinel values from base", () => {
    const snapshot = {
      raw: '{ "gateway": { "auth": { "token": "token-1" } } }',
      parsed: { gateway: { auth: { token: "token-1" } } },
      config: { gateway: { auth: { token: "token-1" } } },
    };
    const redacted = redactConfigSnapshot(snapshot);
    expect(redacted.raw).toContain(REDACTED_SENTINEL);
    expect(redacted.raw).not.toContain("token-1");

    const next = JSON.parse(redacted.raw ?? "{}") as unknown;
    const restored = restoreRedactedValues(next, snapshot.parsed) as {
      gateway?: { auth?: { token?: string } };
    };
    expect(restored.gateway?.auth?.token).toBe("token-1");
  });

  it("throws when restoring sentinel values without a base", () => {
    expect(() =>
      restoreRedactedValues(
        {
          gateway: { auth: { token: REDACTED_SENTINEL } },
        },
        {},
      ),
    ).toThrow(/missing base value/i);
  });
});

