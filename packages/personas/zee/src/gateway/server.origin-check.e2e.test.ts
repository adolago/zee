import fs from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";
import { WebSocket } from "ws";

import { connectOk, getFreePort, installGatewayTestHooks, startGatewayServer } from "./test-helpers.js";

installGatewayTestHooks({ scope: "suite" });

async function writeTestConfig(cfg: unknown): Promise<void> {
  const configPath = process.env.ZEE_CONFIG_PATH;
  if (!configPath) throw new Error("missing ZEE_CONFIG_PATH");
  await fs.mkdir(path.dirname(configPath), { recursive: true });
  await fs.writeFile(configPath, JSON.stringify(cfg, null, 2).trimEnd().concat("\n"), "utf-8");
}

async function expectWsStatus(params: {
  url: string;
  headers: Record<string, string>;
  statusCode: number;
}): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const ws = new WebSocket(params.url, { headers: params.headers });
    const timer = setTimeout(() => reject(new Error("timeout")), 10_000);
    timer.unref?.();

    ws.once("open", () => {
      clearTimeout(timer);
      ws.terminate();
      reject(new Error("expected ws to reject"));
    });
    ws.once("unexpected-response", (_req, res) => {
      clearTimeout(timer);
      expect(res.statusCode).toBe(params.statusCode);
      ws.terminate();
      resolve();
    });
    ws.once("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

describe("gateway ws origin check", () => {
  it("rejects mismatched Origin by default", async () => {
    const port = await getFreePort();
    const server = await startGatewayServer(port);
    try {
      await expectWsStatus({
        url: `ws://127.0.0.1:${port}`,
        headers: { Origin: "https://evil.example" },
        statusCode: 403,
      });
    } finally {
      await server.close();
    }
  });

  it("allows allowlisted Origin", async () => {
    await writeTestConfig({
      gateway: {
        allowedOrigins: ["https://evil.example"],
      },
    });
    const port = await getFreePort();
    const server = await startGatewayServer(port);
    try {
      const ws = new WebSocket(`ws://127.0.0.1:${port}`, { headers: { Origin: "https://evil.example" } });
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("timeout")), 10_000);
        timer.unref?.();
        ws.once("open", () => {
          clearTimeout(timer);
          resolve();
        });
        ws.once("unexpected-response", (_req, res) => {
          clearTimeout(timer);
          reject(new Error(`unexpected response: ${res.statusCode ?? "unknown"}`));
        });
        ws.once("error", (err) => {
          clearTimeout(timer);
          reject(err);
        });
      });
      await connectOk(ws);
      ws.close();
    } finally {
      await server.close();
    }
  });
});

