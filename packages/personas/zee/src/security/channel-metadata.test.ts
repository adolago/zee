import { describe, expect, it } from "vitest";

import { buildUntrustedChannelMetadata } from "./channel-metadata.js";

describe("channel-metadata", () => {
  it("wraps untrusted channel metadata", () => {
    const result = buildUntrustedChannelMetadata({
      channel: "whatsapp",
      fields: {
        subject: "Family chat",
        members: "Alice, Bob",
      },
    });

    expect(result).toContain("<<<EXTERNAL_UNTRUSTED_CONTENT>>>");
    expect(result).toContain("<<<END_EXTERNAL_UNTRUSTED_CONTENT>>>");
    expect(result).toContain("Source: Channel metadata");
    expect(result).toContain("Channel: whatsapp");
    expect(result).toContain("subject: Family chat");
    expect(result).toContain("members: Alice, Bob");
  });

  it("truncates individual fields", () => {
    const result = buildUntrustedChannelMetadata({
      channel: "whatsapp",
      fields: { topic: "a".repeat(200) },
      maxFieldLength: 20,
    });

    expect(result).toContain("topic: aaaaaaaaaa...");
  });

  it("deduplicates entries after normalization", () => {
    const result = buildUntrustedChannelMetadata({
      channel: "whatsapp",
      fields: {
        topic: "Hello",
        " topic ": "Hello",
      },
    });

    expect((result.match(/topic: Hello/g) ?? []).length).toBe(1);
  });

  it("handles empty fields", () => {
    const result = buildUntrustedChannelMetadata({
      channel: "whatsapp",
      fields: {},
    });

    expect(result).toContain("Channel: whatsapp");
    expect(result).toContain("<<<EXTERNAL_UNTRUSTED_CONTENT>>>");
  });
});

