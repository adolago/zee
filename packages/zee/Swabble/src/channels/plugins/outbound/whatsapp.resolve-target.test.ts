import { describe, expect, it } from "vitest";
import { whatsappOutbound } from "./whatsapp.js";

describe("whatsapp outbound target resolution", () => {
  it("rejects empty target even when allowFrom is configured", () => {
    const res = whatsappOutbound.resolveTarget({
      to: "",
      allowFrom: ["+1555"],
      mode: "explicit",
    });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.message).toContain("WhatsApp");
      expect(res.error.message).toContain("<E.164|group JID>");
    }
  });

  it("rejects invalid explicit target instead of falling back to allowFrom", () => {
    const res = whatsappOutbound.resolveTarget({
      to: "invalid target",
      allowFrom: ["+1555"],
      mode: "explicit",
    });
    expect(res.ok).toBe(false);
  });

  it("rejects implicit target not present in allowFrom", () => {
    const res = whatsappOutbound.resolveTarget({
      to: "+1666",
      allowFrom: ["+1555"],
      mode: "implicit",
    });
    expect(res.ok).toBe(false);
  });

  it("allows implicit target when wildcard allowFrom is set", () => {
    const res = whatsappOutbound.resolveTarget({
      to: "+1666",
      allowFrom: ["*"],
      mode: "implicit",
    });
    expect(res).toEqual({ ok: true, to: "+1666" });
  });

  it("accepts explicit group jid targets", () => {
    const res = whatsappOutbound.resolveTarget({
      to: "120363401234567890@g.us",
      allowFrom: ["+1555"],
      mode: "explicit",
    });
    expect(res).toEqual({ ok: true, to: "120363401234567890@g.us" });
  });
});
