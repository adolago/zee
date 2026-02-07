import { describe, expect, it } from "vitest";
import { buildUntrustedChannelMetadata } from "./channel-metadata.js";

describe("channel-metadata", () => {
  it("returns undefined when no entries are present", () => {
    expect(
      buildUntrustedChannelMetadata({
        source: "test",
        label: "Test",
        entries: [null, undefined, ""],
      }),
    ).toBeUndefined();
  });

  it("wraps metadata as untrusted external content", () => {
    const result = buildUntrustedChannelMetadata({
      source: "whatsapp",
      label: "Group",
      entries: ["Subject: Test Group", "Members: Alice, Bob"],
    });

    expect(result).toContain("<<<EXTERNAL_UNTRUSTED_CONTENT>>>");
    expect(result).toContain("<<<END_EXTERNAL_UNTRUSTED_CONTENT>>>");
    expect(result).toContain("UNTRUSTED channel metadata (whatsapp)");
    expect(result).toContain("Group:");
    expect(result).toContain("Subject: Test Group");
    expect(result).toContain("Members: Alice, Bob");
    expect(result).not.toContain("SECURITY NOTICE");
  });
});

