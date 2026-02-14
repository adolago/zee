import { describe, expect, it } from "vitest";

import { normalizeCredentialInput } from "./credential-input.js";

describe("normalizeCredentialInput", () => {
  it("returns undefined for non-string values", () => {
    expect(normalizeCredentialInput(undefined)).toBeUndefined();
    expect(normalizeCredentialInput(null)).toBeUndefined();
    expect(normalizeCredentialInput(123)).toBeUndefined();
    expect(normalizeCredentialInput({ key: "value" })).toBeUndefined();
  });

  it("returns undefined for blank values", () => {
    expect(normalizeCredentialInput("")).toBeUndefined();
    expect(normalizeCredentialInput("   ")).toBeUndefined();
  });

  it("returns undefined for literal undefined/null strings", () => {
    expect(normalizeCredentialInput("undefined")).toBeUndefined();
    expect(normalizeCredentialInput("  undefined  ")).toBeUndefined();
    expect(normalizeCredentialInput("null")).toBeUndefined();
    expect(normalizeCredentialInput(" NULL ")).toBeUndefined();
  });

  it("returns normalized value for valid input", () => {
    expect(normalizeCredentialInput(" token ")).toBe("token");
    expect(normalizeCredentialInput("sk-test")).toBe("sk-test");
  });
});
