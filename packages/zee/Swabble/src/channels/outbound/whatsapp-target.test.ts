import { describe, expect, it } from "vitest";

import { normalizeWhatsAppTarget, resolveWhatsAppOutboundTarget } from "./whatsapp-target.js";

describe("normalizeWhatsAppTarget", () => {
  it("normalizes direct targets to E.164 format", () => {
    expect(normalizeWhatsAppTarget(" (555) 123-4567 ")).toBe("+5551234567");
    expect(normalizeWhatsAppTarget("whatsapp:5551234567@s.whatsapp.net")).toBe("+5551234567");
  });

  it("keeps group JIDs and normalizes casing", () => {
    expect(normalizeWhatsAppTarget("120363401234567890@g.us")).toBe("120363401234567890@g.us");
    expect(normalizeWhatsAppTarget(" WhatsApp:120363401234567890@G.US ")).toBe(
      "120363401234567890@g.us",
    );
  });
});

describe("resolveWhatsAppOutboundTarget", () => {
  it("accepts explicit valid targets", () => {
    const result = resolveWhatsAppOutboundTarget({
      mode: "explicit",
      to: "(555) 123-4567",
      allowFrom: ["+11111111111"],
    });
    expect(result).toEqual({ ok: true, to: "+5551234567" });
  });

  it("accepts implicit targets when wildcard is configured", () => {
    const result = resolveWhatsAppOutboundTarget({
      mode: "implicit",
      to: "+15551234567",
      allowFrom: ["*"],
    });
    expect(result).toEqual({ ok: true, to: "+15551234567" });
  });

  it("accepts implicit targets when they are in allowlist", () => {
    const result = resolveWhatsAppOutboundTarget({
      mode: "implicit",
      to: "+15551234567",
      allowFrom: ["+15551234567"],
    });
    expect(result).toEqual({ ok: true, to: "+15551234567" });
  });

  it("allows group JIDs regardless of allowlist", () => {
    const result = resolveWhatsAppOutboundTarget({
      mode: "implicit",
      to: "120363401234567890@g.us",
      allowFrom: ["+15551234567"],
    });
    expect(result).toEqual({ ok: true, to: "120363401234567890@g.us" });
  });

  it("fails closed for implicit targets not in allowlist", () => {
    const result = resolveWhatsAppOutboundTarget({
      mode: "implicit",
      to: "+15550000000",
      allowFrom: ["+15551234567"],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain("WhatsApp");
    }
  });

  it("fails closed for invalid target even when allowlist exists (no allowList[0] fallback)", () => {
    const result = resolveWhatsAppOutboundTarget({
      mode: "implicit",
      to: "invalid-target",
      allowFrom: ["+15551234567"],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain("WhatsApp");
    }
  });

  it("fails closed for empty target even when allowlist exists (no allowList[0] fallback)", () => {
    const result = resolveWhatsAppOutboundTarget({
      mode: "implicit",
      to: " ",
      allowFrom: ["+15551234567"],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain("WhatsApp");
    }
  });
});
