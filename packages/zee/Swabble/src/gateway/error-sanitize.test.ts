import { describe, expect, it } from "vitest";

import { sanitizeGatewayErrorMessage, sanitizeGatewayUnavailableMessage } from "./error-sanitize.js";

describe("gateway error sanitization", () => {
  it("redacts filesystem paths in public messages", () => {
    const err = new Error("open /home/user/.config/zee/token.json failed");
    const out = sanitizeGatewayErrorMessage(err);
    expect(out).toContain("<path>");
    expect(out).not.toContain("/home/user/.config/zee/token.json");
  });

  it("maps internal failures to generic unavailable text", () => {
    expect(sanitizeGatewayUnavailableMessage(new Error("EACCES: permission denied"))).toBe(
      "request unavailable",
    );
    expect(sanitizeGatewayUnavailableMessage(new Error("operation timeout after 30000ms"))).toBe(
      "request timed out",
    );
  });
});
