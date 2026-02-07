import fs from "node:fs/promises";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { WebSocket } from "ws";

import { REDACTED_SENTINEL } from "../config/redact-snapshot.js";
import { connectOk, getFreePort, installGatewayTestHooks, onceMessage, startGatewayServer } from "./test-helpers.js";

installGatewayTestHooks({ scope: "suite" });

let server: Awaited<ReturnType<typeof startGatewayServer>>;
let port = 0;

beforeAll(async () => {
  port = await getFreePort();
  server = await startGatewayServer(port);
});

afterAll(async () => {
  await server.close();
});

const openClient = async () => {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  await new Promise<void>((resolve) => ws.once("open", resolve));
  await connectOk(ws);
  return ws;
};

describe("gateway config redaction", () => {
  it("redacts secrets on config.get and preserves them on config.set round-trips", async () => {
    const ws = await openClient();
    try {
      const gatewayToken = "my-super-secret-gateway-token-value";
      const matrixToken = "matrix-access-token-value-1234";

      const setId = "req-set-1";
      ws.send(
        JSON.stringify({
          type: "req",
          id: setId,
          method: "config.set",
          params: {
            raw: JSON.stringify({
              gateway: { mode: "local", auth: { token: gatewayToken } },
              channels: { matrix: { accessToken: matrixToken } },
            }),
          },
        }),
      );
      const setRes = await onceMessage<{
        ok: boolean;
        payload?: { path?: string };
        error?: { message?: string };
      }>(ws, (o) => o.type === "res" && o.id === setId);
      expect(setRes.ok).toBe(true);
      const configPath = setRes.payload?.path;
      expect(typeof configPath).toBe("string");
      if (typeof configPath !== "string") {
        throw new Error("missing config path from config.set response");
      }

      const getId = "req-get-1";
      ws.send(
        JSON.stringify({
          type: "req",
          id: getId,
          method: "config.get",
          params: {},
        }),
      );
      const getRes = await onceMessage<{
        ok: boolean;
        payload?: {
          hash?: string;
          raw?: string | null;
          config?: {
            gateway?: { auth?: { token?: string } };
            channels?: { matrix?: { accessToken?: string } };
          };
        };
        error?: { message?: string };
      }>(ws, (o) => o.type === "res" && o.id === getId);
      expect(getRes.ok).toBe(true);
      expect(getRes.payload?.config?.gateway?.auth?.token).toBe(REDACTED_SENTINEL);
      expect(getRes.payload?.config?.channels?.matrix?.accessToken).toBe(REDACTED_SENTINEL);
      expect(typeof getRes.payload?.raw).toBe("string");
      expect(getRes.payload?.raw).toContain(REDACTED_SENTINEL);

      const baseHash = getRes.payload?.hash;
      expect(typeof baseHash).toBe("string");
      if (typeof baseHash !== "string") {
        throw new Error("missing config hash from config.get response");
      }
      const rawRedacted = getRes.payload?.raw;
      if (typeof rawRedacted !== "string") {
        throw new Error("missing config raw from config.get response");
      }

      const set2Id = "req-set-2";
      ws.send(
        JSON.stringify({
          type: "req",
          id: set2Id,
          method: "config.set",
          params: {
            raw: rawRedacted,
            baseHash,
          },
        }),
      );
      const set2Res = await onceMessage<{ ok: boolean }>(ws, (o) => o.type === "res" && o.id === set2Id);
      expect(set2Res.ok).toBe(true);

      const storedRaw = await fs.readFile(configPath, "utf-8");
      const stored = JSON.parse(storedRaw) as {
        gateway?: { auth?: { token?: string } };
        channels?: { matrix?: { accessToken?: string } };
      };
      expect(stored.gateway?.auth?.token).toBe(gatewayToken);
      expect(stored.channels?.matrix?.accessToken).toBe(matrixToken);
    } finally {
      ws.close();
    }
  });
});

