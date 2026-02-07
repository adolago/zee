import { describe, expect, it } from "vitest";

import { buildUntrustedChannelMetadata } from "./channel-metadata.js";

describe("channel-metadata", () => {
  it("wraps channel metadata", () => {
    const result = buildUntrustedChannelMetadata({
      channel: "whatsapp",
      fields: {
        Sender: "Alice",
        Topic: "Hello",
      },
    });

    expect(result).toContain("<<<EXTERNAL_UNTRUSTED_CONTENT>>>");
    expect(result).toContain("Source: Channel metadata");
    expect(result).toContain("Channel: whatsapp");
    expect(result).toContain("Sender: Alice");
    expect(result).toContain("Topic: Hello");
    expect(result).toContain("<<<END_EXTERNAL_UNTRUSTED_CONTENT>>>");
  });

  it("truncates long field values", () => {
    const long = "x".repeat(1000);
    const result = buildUntrustedChannelMetadata({
      channel: "whatsapp",
      fields: { Long: long },
      maxFieldLength: 50,
    });

    expect(result).not.toContain(long);
    expect(result).toContain("Long:");
  });

  it("deduplicates normalized entries", () => {
    const result = buildUntrustedChannelMetadata({
      channel: "whatsapp",
      fields: {
        A: "x",
        "A ": "x",
      },
    });

    expect(result.match(/A: x/g)?.length ?? 0).toBe(1);
  });

  it("returns empty string when no metadata can be built", () => {
    const result = buildUntrustedChannelMetadata({
      channel: "  ",
      fields: { A: " " },
    });

    expect(result).toBe("");
  });
});

