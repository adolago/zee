import { describe, expect, it } from "vitest";

import { checkBrowserOrigin } from "./origin-check.js";

describe("checkBrowserOrigin", () => {
  it("allows missing Origin (non-browser clients)", () => {
    const res = checkBrowserOrigin({ origin: undefined, hostHeader: "127.0.0.1:18789", allowlist: [] });
    expect(res.ok).toBe(true);
  });

  it("rejects Origin: null", () => {
    const res = checkBrowserOrigin({ origin: "null", hostHeader: "127.0.0.1:18789", allowlist: [] });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.reason).toBe("invalid-origin");
    }
  });

  it("rejects non-http(s) origins", () => {
    const res = checkBrowserOrigin({
      origin: "chrome-extension://abc123",
      hostHeader: "127.0.0.1:18789",
      allowlist: [],
    });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.reason).toBe("invalid-origin");
    }
  });

  it("allows exact host+port match", () => {
    const res = checkBrowserOrigin({
      origin: "http://127.0.0.1:18789",
      hostHeader: "127.0.0.1:18789",
      allowlist: [],
    });
    expect(res.ok).toBe(true);
  });

  it("treats localhost and 127.0.0.1 as equivalent loopback but still enforces port", () => {
    const ok = checkBrowserOrigin({
      origin: "http://localhost:18789",
      hostHeader: "127.0.0.1:18789",
      allowlist: [],
    });
    expect(ok.ok).toBe(true);

    const mismatch = checkBrowserOrigin({
      origin: "http://localhost:5173",
      hostHeader: "127.0.0.1:18789",
      allowlist: [],
    });
    expect(mismatch.ok).toBe(false);
    if (!mismatch.ok) {
      expect(mismatch.reason).toBe("origin-mismatch");
    }
  });

  it("allows allowlisted origins", () => {
    const res = checkBrowserOrigin({
      origin: "https://evil.example",
      hostHeader: "127.0.0.1:18789",
      allowlist: ["https://evil.example"],
    });
    expect(res.ok).toBe(true);
  });
});

