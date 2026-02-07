import { describe, expect, it } from "vitest";
import { checkBrowserOrigin } from "./origin-check.js";

describe("checkBrowserOrigin", () => {
  it("allows missing Origin (non-browser clients)", () => {
    expect(
      checkBrowserOrigin({
        origin: undefined,
        hostHeader: "127.0.0.1:18789",
        allowlist: [],
      }),
    ).toBe(true);
  });

  it("rejects Origin: null", () => {
    expect(
      checkBrowserOrigin({
        origin: "null",
        hostHeader: "127.0.0.1:18789",
        allowlist: [],
      }),
    ).toBe(false);
  });

  it("rejects non-http(s) origins", () => {
    expect(
      checkBrowserOrigin({
        origin: "chrome-extension://abc123",
        hostHeader: "127.0.0.1:18789",
        allowlist: [],
      }),
    ).toBe(false);
  });

  it("allows exact host+port match", () => {
    expect(
      checkBrowserOrigin({
        origin: "http://127.0.0.1:18789",
        hostHeader: "127.0.0.1:18789",
        allowlist: [],
      }),
    ).toBe(true);
  });

  it("treats localhost and 127.0.0.1 as equivalent loopback", () => {
    expect(
      checkBrowserOrigin({
        origin: "http://localhost:18789",
        hostHeader: "127.0.0.1:18789",
        allowlist: [],
      }),
    ).toBe(true);
  });

  it("rejects different ports unless allowlisted", () => {
    expect(
      checkBrowserOrigin({
        origin: "http://localhost:5173",
        hostHeader: "127.0.0.1:18789",
        allowlist: [],
      }),
    ).toBe(false);
  });

  it("allows allowlisted origins", () => {
    expect(
      checkBrowserOrigin({
        origin: "https://evil.example",
        hostHeader: "127.0.0.1:18789",
        allowlist: ["https://evil.example"],
      }),
    ).toBe(true);
  });
});

