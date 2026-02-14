import type { AddressInfo } from "node:net";
import fs from "node:fs/promises";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";
import { WebSocket } from "ws";

import { rawDataToString } from "../infra/ws.js";
import { defaultRuntime } from "../runtime.js";
import { A2UI_PATH, CANVAS_HOST_PATH, CANVAS_WS_PATH, injectCanvasLiveReload } from "./a2ui.js";
import { createCanvasHostHandler, startCanvasHost } from "./server.js";

const TEST_AUTH = { mode: "token" as const, token: "secret" };

function withAuth(url: string) {
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}auth=${encodeURIComponent(TEST_AUTH.token)}`;
}

describe("canvas host", () => {
  it("injects live reload script", () => {
    const out = injectCanvasLiveReload("<html><body>Hello</body></html>");
    expect(out).toContain(CANVAS_WS_PATH);
    expect(out).toContain("location.reload");
    expect(out).toContain("zeeCanvasA2UIAction");
    expect(out).toContain("zeeSendUserAction");
  });

  it("requires auth for canvas content", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "zee-canvas-"));

    const server = await startCanvasHost({
      runtime: defaultRuntime,
      auth: TEST_AUTH,
      rootDir: dir,
      port: 0,
      listenHost: "127.0.0.1",
      allowInTests: true,
    });

    try {
      const res = await fetch(`http://127.0.0.1:${server.port}${CANVAS_HOST_PATH}/`);
      expect(res.status).toBe(401);
    } finally {
      await server.close();
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("defaults standalone bind host to loopback", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "zee-canvas-"));
    const runtime = {
      log: vi.fn(),
      error: vi.fn(),
      exit: vi.fn((_code: number) => {
        throw new Error("unexpected exit");
      }),
    };

    const server = await startCanvasHost({
      runtime: runtime as never,
      auth: TEST_AUTH,
      rootDir: dir,
      port: 0,
      allowInTests: true,
    });

    try {
      const res = await fetch(withAuth(`http://127.0.0.1:${server.port}${CANVAS_HOST_PATH}/`));
      expect(res.status).toBe(200);
      expect(runtime.log).toHaveBeenCalledWith(expect.stringContaining("http://127.0.0.1:"));
    } finally {
      await server.close();
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("creates a default index.html when missing", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "zee-canvas-"));

    const server = await startCanvasHost({
      runtime: defaultRuntime,
      auth: TEST_AUTH,
      rootDir: dir,
      port: 0,
      listenHost: "127.0.0.1",
      allowInTests: true,
    });

    try {
      const res = await fetch(withAuth(`http://127.0.0.1:${server.port}${CANVAS_HOST_PATH}/`));
      const html = await res.text();
      expect(res.status).toBe(200);
      expect(html).toContain("Interactive test page");
      expect(html).toContain("zeeSendUserAction");
      expect(html).toContain(CANVAS_WS_PATH);
    } finally {
      await server.close();
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("skips live reload injection when disabled", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "zee-canvas-"));
    await fs.writeFile(path.join(dir, "index.html"), "<html><body>no-reload</body></html>", "utf8");

    const server = await startCanvasHost({
      runtime: defaultRuntime,
      auth: TEST_AUTH,
      rootDir: dir,
      port: 0,
      listenHost: "127.0.0.1",
      allowInTests: true,
      liveReload: false,
    });

    try {
      const res = await fetch(withAuth(`http://127.0.0.1:${server.port}${CANVAS_HOST_PATH}/`));
      const html = await res.text();
      expect(res.status).toBe(200);
      expect(html).toContain("no-reload");
      expect(html).not.toContain(CANVAS_WS_PATH);

      const wsRes = await fetch(`http://127.0.0.1:${server.port}${CANVAS_WS_PATH}`);
      expect(wsRes.status).toBe(404);
    } finally {
      await server.close();
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("serves canvas content from the mounted base path", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "zee-canvas-"));
    await fs.writeFile(path.join(dir, "index.html"), "<html><body>v1</body></html>", "utf8");

    const handler = await createCanvasHostHandler({
      runtime: defaultRuntime,
      auth: TEST_AUTH,
      rootDir: dir,
      basePath: CANVAS_HOST_PATH,
      allowInTests: true,
    });

    const server = createServer((req, res) => {
      void (async () => {
        if (await handler.handleHttpRequest(req, res)) {
          return;
        }
        res.statusCode = 404;
        res.setHeader("Content-Type", "text/plain; charset=utf-8");
        res.end("Not Found");
      })();
    });
    server.on("upgrade", (req, socket, head) => {
      if (handler.handleUpgrade(req, socket, head)) {
        return;
      }
      socket.destroy();
    });

    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as AddressInfo).port;

    try {
      const res = await fetch(withAuth(`http://127.0.0.1:${port}${CANVAS_HOST_PATH}/`));
      const html = await res.text();
      expect(res.status).toBe(200);
      expect(html).toContain("v1");
      expect(html).toContain(CANVAS_WS_PATH);

      const miss = await fetch(`http://127.0.0.1:${port}/`);
      expect(miss.status).toBe(404);
    } finally {
      await handler.close();
      await new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      );
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("reuses a handler without closing it twice", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "zee-canvas-"));
    await fs.writeFile(path.join(dir, "index.html"), "<html><body>v1</body></html>", "utf8");

    const handler = await createCanvasHostHandler({
      runtime: defaultRuntime,
      auth: TEST_AUTH,
      rootDir: dir,
      basePath: CANVAS_HOST_PATH,
      allowInTests: true,
    });
    const originalClose = handler.close;
    const closeSpy = vi.fn(async () => originalClose());
    handler.close = closeSpy;

    const server = await startCanvasHost({
      runtime: defaultRuntime,
      auth: TEST_AUTH,
      handler,
      ownsHandler: false,
      port: 0,
      listenHost: "127.0.0.1",
      allowInTests: true,
    });

    try {
      expect(server.port).toBeGreaterThan(0);
    } finally {
      await server.close();
      expect(closeSpy).not.toHaveBeenCalled();
      await originalClose();
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("serves HTML with injection and broadcasts reload on file changes", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "zee-canvas-"));
    const index = path.join(dir, "index.html");
    await fs.writeFile(index, "<html><body>v1</body></html>", "utf8");

    const server = await startCanvasHost({
      runtime: defaultRuntime,
      auth: TEST_AUTH,
      rootDir: dir,
      port: 0,
      listenHost: "127.0.0.1",
      allowInTests: true,
    });

    try {
      const res = await fetch(withAuth(`http://127.0.0.1:${server.port}${CANVAS_HOST_PATH}/`));
      const html = await res.text();
      expect(res.status).toBe(200);
      expect(html).toContain("v1");
      expect(html).toContain(CANVAS_WS_PATH);

      const ws = new WebSocket(
        withAuth(`ws://127.0.0.1:${server.port}${CANVAS_WS_PATH}`),
      );
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("ws open timeout")), 5000);
        ws.on("open", () => {
          clearTimeout(timer);
          resolve();
        });
        ws.on("error", (err) => {
          clearTimeout(timer);
          reject(err);
        });
        ws.on("unexpected-response", () => {
          clearTimeout(timer);
          reject(new Error("unexpected response"));
        });
      });

      const msg = new Promise<string>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("reload timeout")), 10_000);
        ws.on("message", (data) => {
          clearTimeout(timer);
          resolve(rawDataToString(data));
        });
      });

      await new Promise((resolve) => setTimeout(resolve, 100));
      await fs.writeFile(index, "<html><body>v2</body></html>", "utf8");
      expect(await msg).toBe("reload");
      ws.close();
    } finally {
      await server.close();
      await fs.rm(dir, { recursive: true, force: true });
    }
  }, 20_000);

  it("rejects WebSocket upgrades with mismatched origins", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "zee-canvas-"));
    await fs.writeFile(path.join(dir, "index.html"), "<html><body>v1</body></html>", "utf8");

    const server = await startCanvasHost({
      runtime: defaultRuntime,
      auth: TEST_AUTH,
      rootDir: dir,
      port: 0,
      listenHost: "127.0.0.1",
      allowInTests: true,
    });

    const connect = () =>
      new Promise<"open" | "blocked">((resolve) => {
        const ws = new WebSocket(withAuth(`ws://127.0.0.1:${server.port}${CANVAS_WS_PATH}`), {
          headers: { Origin: "https://evil.example" },
        });
        const done = (value: "open" | "blocked") => {
          try {
            ws.close();
          } catch {
            // ignore
          }
          resolve(value);
        };
        ws.on("open", () => done("open"));
        ws.on("unexpected-response", () => done("blocked"));
        ws.on("error", () => done("blocked"));
        ws.on("close", () => done("blocked"));
        setTimeout(() => done("blocked"), 2000);
      });

    try {
      expect(await connect()).toBe("blocked");
    } finally {
      await server.close();
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("serves the gateway-hosted A2UI scaffold", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "zee-canvas-"));
    const a2uiRoot = path.resolve(process.cwd(), "src/canvas-host/a2ui");
    const bundlePath = path.join(a2uiRoot, "a2ui.bundle.js");
    let createdBundle = false;

    try {
      await fs.stat(bundlePath);
    } catch {
      await fs.writeFile(bundlePath, "globalThis.zeeA2UI = {};", "utf8");
      createdBundle = true;
    }

    let server: Awaited<ReturnType<typeof startCanvasHost>> | null = null;
    try {
      server = await startCanvasHost({
        runtime: defaultRuntime,
        auth: TEST_AUTH,
        rootDir: dir,
        port: 0,
        listenHost: "127.0.0.1",
        allowInTests: true,
      });

      const res = await fetch(withAuth(`http://127.0.0.1:${server.port}${A2UI_PATH}/`));
      const html = await res.text();
      expect(res.status).toBe(200);
      expect(html).toContain("zee-a2ui-host");
      expect(html).toContain("zeeCanvasA2UIAction");

      const bundleRes = await fetch(
        withAuth(`http://127.0.0.1:${server.port}${A2UI_PATH}/a2ui.bundle.js`),
      );
      const js = await bundleRes.text();
      expect(bundleRes.status).toBe(200);
      expect(js).toContain("zeeA2UI");
    } finally {
      await server?.close();
      if (createdBundle) {
        await fs.rm(bundlePath, { force: true });
      }
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});
