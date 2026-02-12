import { describe, expect, it } from "vitest";

import { resolveChannelGroupToolsPolicy, resolveToolsBySender } from "./group-policy.js";

describe("group policy tool resolution", () => {
  describe("resolveToolsBySender", () => {
    it("matches sender entries case-insensitively and without leading @", () => {
      const resolved = resolveToolsBySender({
        toolsBySender: {
          "@Alice": { allow: ["read"] },
        },
        senderName: "alice",
      });

      expect(resolved).toEqual({ allow: ["read"] });
    });

    it("prefers senderId over other identifiers when multiple match", () => {
      const resolved = resolveToolsBySender({
        toolsBySender: {
          "user-1": { deny: ["exec"] },
          alice: { allow: ["exec"] },
        },
        senderId: "user-1",
        senderName: "alice",
      });

      expect(resolved).toEqual({ deny: ["exec"] });
    });

    it("falls back to wildcard when no sender matches", () => {
      const resolved = resolveToolsBySender({
        toolsBySender: {
          "*": { deny: ["*"] },
        },
        senderUsername: "unknown",
      });

      expect(resolved).toEqual({ deny: ["*"] });
    });
  });

  describe("resolveChannelGroupToolsPolicy", () => {
    it("prefers group sender policy > group tools > default sender policy > default tools", () => {
      const cfg = {
        channels: {
          whatsapp: {
            groups: {
              "*": {
                tools: { allow: ["read"], deny: ["exec"] },
                toolsBySender: {
                  bob: { allow: ["exec"] },
                },
              },
              g1: {
                tools: { allow: ["write"] },
                toolsBySender: {
                  alice: { deny: ["write"] },
                },
              },
            },
          },
        },
      } as any;

      // 1) group sender override
      expect(
        resolveChannelGroupToolsPolicy({
          cfg,
          channel: "whatsapp",
          groupId: "g1",
          senderName: "alice",
        }),
      ).toEqual({ deny: ["write"] });

      // 2) group tools
      expect(
        resolveChannelGroupToolsPolicy({
          cfg,
          channel: "whatsapp",
          groupId: "g1",
          senderName: "carol",
        }),
      ).toEqual({ allow: ["write"] });

      // 3) default sender override
      expect(
        resolveChannelGroupToolsPolicy({
          cfg,
          channel: "whatsapp",
          groupId: "g2",
          senderName: "bob",
        }),
      ).toEqual({ allow: ["exec"] });

      // 4) default tools
      expect(
        resolveChannelGroupToolsPolicy({
          cfg,
          channel: "whatsapp",
          groupId: "g2",
          senderName: "dave",
        }),
      ).toEqual({ allow: ["read"], deny: ["exec"] });
    });
  });
});

