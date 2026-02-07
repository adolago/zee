import { describe, expect, it } from "vitest";

import type { ZeeConfig } from "../../config/config.js";
import type { TemplateContext } from "../templating.js";
import { buildGroupIntro } from "./groups.js";

describe("buildGroupIntro", () => {
  it("keeps subject/members out of the trusted intro and wraps them as untrusted metadata", () => {
    const cfg = {} as ZeeConfig;
    const sessionCtx = {
      ChatType: "group",
      GroupSubject: "Family chat",
      GroupMembers: "Alice, Bob",
      From: "group:123@g.us",
    } as unknown as TemplateContext;

    const result = buildGroupIntro({
      cfg,
      sessionCtx,
      defaultActivation: "mention",
      silentToken: "NO_REPLY",
    });

    expect(result.trustedIntro).toContain("You are replying inside a group chat.");
    expect(result.trustedIntro).not.toContain("Family chat");
    expect(result.trustedIntro).not.toContain("Alice, Bob");

    const metadata = result.untrustedMetadata ?? "";
    expect(metadata).toContain("<<<EXTERNAL_UNTRUSTED_CONTENT>>>");
    expect(metadata).toContain("Source: Channel metadata");
    expect(metadata).toContain("subject: Family chat");
    expect(metadata).toContain("members: Alice, Bob");
  });
});

