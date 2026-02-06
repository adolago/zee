import { describe, it } from "vitest";

import type { MsgContext } from "../src/auto-reply/templating.js";
import { finalizeInboundContext } from "../src/auto-reply/reply/inbound-context.js";
import { expectInboundContextContract } from "./helpers/inbound-contract.js";

describe("inbound context contract (providers + extensions)", () => {
  const cases: Array<{ name: string; ctx: MsgContext }> = [
    {
      name: "whatsapp group",
      ctx: {
        Provider: "whatsapp",
        Surface: "whatsapp",
        ChatType: "group",
        From: "123@g.us",
        To: "+15550001111",
        Body: "[WhatsApp 123@g.us] hi",
        RawBody: "hi",
        CommandBody: "hi",
        SenderName: "Alice",
      },
    },
    {
      name: "matrix room",
      ctx: {
        Provider: "matrix",
        Surface: "matrix",
        ChatType: "channel",
        From: "room:!roomid:example.com",
        To: "matrix:!roomid:example.com",
        Body: "[Matrix !roomid:example.com] hi",
        RawBody: "hi",
        CommandBody: "hi",
        GroupSubject: "Matrix Room",
        SenderName: "Alice",
      },
    },
  ];

  for (const entry of cases) {
    it(entry.name, () => {
      const ctx = finalizeInboundContext({ ...entry.ctx });
      expectInboundContextContract(ctx);
    });
  }
});
