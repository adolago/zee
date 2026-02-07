import fs from "node:fs/promises";

import { describe, expect, it } from "vitest";
import { WebSocket } from "ws";

import { connectOk, getFreePort, installGatewayTestHooks, rpcReq, startGatewayServer } from "./test-helpers.js";

installGatewayTestHooks({ scope: "suite" });

describe("gateway config redaction", () => {
  it("redacts secrets in gateway config RPC and preserves them across round trips", async () => {
    const port = await getFreePort();
    const server = await startGatewayServer(port);
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    await new Promise<void>((resolve) => ws.once("open", resolve));
    await connectOk(ws);

    try {
      const setRes = await rpcReq<{ ok: boolean; path?: string; config?: unknown }>(ws, "config.set", {
        raw: '{ "gateway": { "auth": { "token": "token-1" } } }',
      });
      expect(setRes.ok).toBe(true);
      expect((setRes.payload as { config?: { gateway?: { auth?: { token?: string } } } } | undefined)?.config?.gateway?.auth?.token).toBe(
        "<redacted>",
      );

      const getRes = await rpcReq(ws, "config.get", {});
      expect(getRes.ok).toBe(true);
      const snapshot = getRes.payload as { raw?: unknown; hash?: unknown; config?: unknown };
      expect(typeof snapshot.raw).toBe("string");
      expect(typeof snapshot.hash).toBe("string");

      const raw = snapshot.raw as string;
      expect(raw).toContain("<redacted>");
      expect(raw).not.toContain("token-1");

      const baseHash = snapshot.hash as string;
      const setRes2 = await rpcReq(ws, "config.set", { raw, baseHash });
      expect(setRes2.ok).toBe(true);

      const configPath = process.env.ZEE_CONFIG_PATH;
      if (!configPath) throw new Error("missing ZEE_CONFIG_PATH");
      const onDisk = await fs.readFile(configPath, "utf-8");
      expect(onDisk).toContain("token-1");
      expect(onDisk).not.toContain("<redacted>");
    } finally {
      ws.close();
      await server.close();
    }
  });
});

