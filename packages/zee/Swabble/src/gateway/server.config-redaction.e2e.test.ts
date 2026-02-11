import fs from "node:fs/promises";

import { describe, expect, it } from "vitest";
import { WebSocket } from "ws";

import { REDACTED_SENTINEL } from "../config/redact-snapshot.js";
import { connectOk, getFreePort, installGatewayTestHooks, rpcReq, startGatewayServer } from "./test-helpers.js";

installGatewayTestHooks({ scope: "suite" });

describe("gateway config redaction", () => {
  it("redacts secrets in config RPC and preserves them across round trips", async () => {
    const port = await getFreePort();
    const server = await startGatewayServer(port);

    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    await new Promise<void>((resolve, reject) => {
      ws.once("open", resolve);
      ws.once("error", reject);
    });
    await connectOk(ws);

    try {
      const gatewayToken = "my-super-secret-gateway-token-value";
      const whatsappToken = "whatsapp-access-token-value-1234";

      const setRes = await rpcReq<{ ok: boolean; path?: string; config?: unknown }>(ws, "config.set", {
        raw: JSON.stringify({
          gateway: { mode: "local", auth: { token: gatewayToken } },
          channels: { whatsapp: { accessToken: whatsappToken } },
        }),
      });
      expect(setRes.ok).toBe(true);
      const setPayload = setRes.payload as
        | { path?: string; config?: { gateway?: { auth?: { token?: string } }; channels?: { whatsapp?: { accessToken?: string } } } }
        | undefined;
      expect(setPayload?.config?.gateway?.auth?.token).toBe(REDACTED_SENTINEL);
      expect(setPayload?.config?.channels?.whatsapp?.accessToken).toBe(REDACTED_SENTINEL);

      const configPath = setPayload?.path;
      expect(typeof configPath).toBe("string");
      if (typeof configPath !== "string") {
        throw new Error("missing config path from config.set response");
      }

      const getRes = await rpcReq(ws, "config.get", {});
      expect(getRes.ok).toBe(true);
      const snapshot = getRes.payload as {
        raw?: unknown;
        hash?: unknown;
        config?: { gateway?: { auth?: { token?: string } }; channels?: { whatsapp?: { accessToken?: string } } };
      };
      expect(snapshot.config?.gateway?.auth?.token).toBe(REDACTED_SENTINEL);
      expect(snapshot.config?.channels?.whatsapp?.accessToken).toBe(REDACTED_SENTINEL);
      expect(typeof snapshot.raw).toBe("string");
      expect(typeof snapshot.hash).toBe("string");

      const raw = snapshot.raw as string;
      expect(raw).toContain(REDACTED_SENTINEL);
      expect(raw).not.toContain(gatewayToken);
      expect(raw).not.toContain(whatsappToken);

      const baseHash = snapshot.hash as string;
      const setRes2 = await rpcReq(ws, "config.set", { raw, baseHash });
      expect(setRes2.ok).toBe(true);

      const storedRaw = await fs.readFile(configPath, "utf-8");
      const stored = JSON.parse(storedRaw) as {
        gateway?: { auth?: { token?: string } };
        channels?: { whatsapp?: { accessToken?: string } };
      };
      expect(stored.gateway?.auth?.token).toBe(gatewayToken);
      expect(stored.channels?.whatsapp?.accessToken).toBe(whatsappToken);
      expect(storedRaw).not.toContain(REDACTED_SENTINEL);
    } finally {
      ws.close();
      await server.close();
    }
  });
});
