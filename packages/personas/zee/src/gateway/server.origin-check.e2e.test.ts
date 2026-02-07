import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { WebSocket } from "ws";

import {
  connectOk,
  getFreePort,
  installGatewayTestHooks,
  startGatewayServer,
} from "./test-helpers.js";

installGatewayTestHooks({ scope: "suite" });

type OpenResult =
  | { ok: true; ws: WebSocket }
  | { ok: false; statusCode?: number; error?: string };

async function openWithOrigin(url: string, origin: string): Promise<OpenResult> {
  return await new Promise<OpenResult>((resolve) => {
    let settled = false;
    const finish = (result: OpenResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };

    const ws = new WebSocket(url, { origin });
    const timer = setTimeout(() => {
      try {
        ws.terminate();
      } catch {
        // ignore
      }
      finish({ ok: false, error: "timeout" });
    }, 5000);

    ws.once("open", () => finish({ ok: true, ws }));
    ws.once("unexpected-response", (_req, res) => {
      try {
        ws.terminate();
      } catch {
        // ignore
      }
      finish({ ok: false, statusCode: res.statusCode });
    });
    ws.once("error", (err) => finish({ ok: false, error: String(err) }));
  });
}

describe("gateway origin-check", () => {
  let server: Awaited<ReturnType<typeof startGatewayServer>>;
  let port = 0;

  beforeAll(async () => {
    port = await getFreePort();
    server = await startGatewayServer(port);
  });

  afterAll(async () => {
    await server.close();
  });

  it("rejects mismatched browser origins", async () => {
    const res = await openWithOrigin(`ws://127.0.0.1:${port}`, "https://evil.example");
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.statusCode).toBe(403);
    }
  });

  it("allows same-host browser origins", async () => {
    const res = await openWithOrigin(`ws://127.0.0.1:${port}`, "http://127.0.0.1:3000");
    expect(res.ok).toBe(true);
    if (res.ok) {
      try {
        await connectOk(res.ws);
      } finally {
        res.ws.close();
      }
    }
  });
});

