import { describe, expect, it } from "vitest";

import { checkBrowserOrigin } from "./origin-check.js";

describe("origin-check", () => {
  it("allows missing origin (non-browser clients)", () => {
    const res = checkBrowserOrigin({ origin: undefined, hostHeader: "example.com:18789" });
    expect(res.ok).toBe(true);
  });

  it("allows same-host origin", () => {
    const res = checkBrowserOrigin({
      origin: "https://example.com",
      hostHeader: "example.com:18789",
    });
    expect(res.ok).toBe(true);
  });

  it("allows loopback host mismatches (localhost vs 127.0.0.1)", () => {
    const res = checkBrowserOrigin({
      origin: "http://localhost:3000",
      hostHeader: "127.0.0.1:18789",
    });
    expect(res.ok).toBe(true);
  });

  it("allows allowlisted origins", () => {
    const res = checkBrowserOrigin({
      origin: "https://allowed.example",
      hostHeader: "gateway.local:18789",
      allowlist: ["https://allowed.example"],
    });
    expect(res.ok).toBe(true);
  });

  it("rejects mismatched origins", () => {
    const res = checkBrowserOrigin({
      origin: "https://evil.example",
      hostHeader: "gateway.local:18789",
    });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.reason).toBe("origin-mismatch");
    }
  });
});

