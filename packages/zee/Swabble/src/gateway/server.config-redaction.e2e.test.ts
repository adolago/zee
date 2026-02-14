import fs from "node:fs/promises";

import { describe, expect, it } from "vitest";
import { WebSocket } from "ws";

import { REDACTED_SENTINEL } from "../config/redact-snapshot.js";
import { connectOk, getFreePort, installGatewayTestHooks, rpcReq, startGatewayServer } from "./test-helpers.js";

installGatewayTestHooks({ scope: "suite" });

async function resolveConfigBaseHash(ws: WebSocket): Promise<string | undefined> {
  const getRes = await rpcReq(ws, "config.get", {});
  if (!getRes.ok) return undefined;
  const hash = (getRes.payload as { hash?: unknown } | undefined)?.hash;
  return typeof hash === "string" && hash.trim() ? hash : undefined;
}

function expectRpcOk(label: string, res: { ok: boolean; payload?: unknown; error?: unknown }) {
  if (res.ok) return;
  throw new Error(`${label} failed: ${JSON.stringify(res)}`);
}

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
      const openaiApiKey = "sk-proj-1234567890abcdefghijklmnopqrstuvwxyz";
      const setBaseHash = await resolveConfigBaseHash(ws);

      const setRes = await rpcReq<{ ok: boolean; path?: string; config?: unknown }>(ws, "config.set", {
        raw: JSON.stringify({
          gateway: { mode: "local", auth: { token: gatewayToken } },
          env: {
            vars: {
              OPENAI_API_KEY: openaiApiKey,
            },
          },
        }),
        ...(setBaseHash ? { baseHash: setBaseHash } : {}),
      });
      expectRpcOk("config.set(initial)", setRes);
      const setPayload = setRes.payload as
        | {
            path?: string;
            config?: {
              gateway?: { auth?: { token?: string } };
              env?: { vars?: { OPENAI_API_KEY?: string } };
            };
          }
        | undefined;
      expect(setPayload?.config?.gateway?.auth?.token).toBe(REDACTED_SENTINEL);
      expect(setPayload?.config?.env?.vars?.OPENAI_API_KEY).toBe(REDACTED_SENTINEL);

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
        config?: {
          gateway?: { auth?: { token?: string } };
          env?: { vars?: { OPENAI_API_KEY?: string } };
        };
      };
      expect(snapshot.config?.gateway?.auth?.token).toBe(REDACTED_SENTINEL);
      expect(snapshot.config?.env?.vars?.OPENAI_API_KEY).toBe(REDACTED_SENTINEL);
      expect(typeof snapshot.raw).toBe("string");
      expect(typeof snapshot.hash).toBe("string");

      const raw = snapshot.raw as string;
      expect(raw).toContain(REDACTED_SENTINEL);
      expect(raw).not.toContain(gatewayToken);
      expect(raw).not.toContain(openaiApiKey);

      const baseHash = snapshot.hash as string;
      const setRes2 = await rpcReq(ws, "config.set", { raw, baseHash });
      expect(setRes2.ok).toBe(true);

      const storedRaw = await fs.readFile(configPath, "utf-8");
      const stored = JSON.parse(storedRaw) as {
        gateway?: { auth?: { token?: string } };
        env?: { vars?: { OPENAI_API_KEY?: string } };
      };
      expect(stored.gateway?.auth?.token).toBe(gatewayToken);
      expect(stored.env?.vars?.OPENAI_API_KEY).toBe(openaiApiKey);
      expect(storedRaw).not.toContain(REDACTED_SENTINEL);
    } finally {
      ws.close();
      await server.close();
    }
  });

  it("restores custom redacted fields on config.apply round-trips", async () => {
    const port = await getFreePort();
    const server = await startGatewayServer(port);

    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    await new Promise<void>((resolve, reject) => {
      ws.once("open", resolve);
      ws.once("error", reject);
    });
    await connectOk(ws);

    try {
      const privateCredential = "private-credential-123";
      const setBaseHash = await resolveConfigBaseHash(ws);
      const setRes = await rpcReq<{ ok: boolean; path?: string; config?: unknown }>(ws, "config.set", {
        raw: JSON.stringify({
          security: {
            redaction: {
              nestedKeyMatchers: ["private_credential"],
            },
          },
          env: {
            vars: {
              PRIVATE_CREDENTIAL: privateCredential,
              SAFE_VALUE: "ok",
            },
          },
        }),
        ...(setBaseHash ? { baseHash: setBaseHash } : {}),
      });
      expectRpcOk("config.set(custom-apply)", setRes);
      const configPath = (setRes.payload as { path?: string } | undefined)?.path;
      expect(typeof configPath).toBe("string");
      if (typeof configPath !== "string") {
        throw new Error("missing config path from config.set response");
      }

      const getRes = await rpcReq(ws, "config.get", {});
      expect(getRes.ok).toBe(true);
      const snapshot = getRes.payload as {
        raw?: unknown;
        hash?: unknown;
        config?: {
          env?: {
            vars?: {
              PRIVATE_CREDENTIAL?: string;
              SAFE_VALUE?: string;
            };
          };
        };
      };
      expect(typeof snapshot.raw).toBe("string");
      expect(typeof snapshot.hash).toBe("string");
      expect(snapshot.config?.env?.vars?.PRIVATE_CREDENTIAL).toBe(REDACTED_SENTINEL);
      expect(snapshot.config?.env?.vars?.SAFE_VALUE).toBe("ok");

      const applyRes = await rpcReq(ws, "config.apply", {
        raw: snapshot.raw,
        baseHash: snapshot.hash,
      });
      expect(applyRes.ok).toBe(true);
      const applyPayload = applyRes.payload as
        | {
            config?: {
              env?: {
                vars?: {
                  PRIVATE_CREDENTIAL?: string;
                  SAFE_VALUE?: string;
                };
              };
            };
          }
        | undefined;
      expect(applyPayload?.config?.env?.vars?.PRIVATE_CREDENTIAL).toBe(REDACTED_SENTINEL);
      expect(applyPayload?.config?.env?.vars?.SAFE_VALUE).toBe("ok");

      const storedRaw = await fs.readFile(configPath, "utf-8");
      const stored = JSON.parse(storedRaw) as {
        env?: {
          vars?: {
            PRIVATE_CREDENTIAL?: string;
            SAFE_VALUE?: string;
          };
        };
      };
      expect(stored.env?.vars?.PRIVATE_CREDENTIAL).toBe(privateCredential);
      expect(stored.env?.vars?.SAFE_VALUE).toBe("ok");
      expect(storedRaw).not.toContain(REDACTED_SENTINEL);
    } finally {
      ws.close();
      await server.close();
    }
  });

  it("redacts custom matcher secrets in config.patch responses", async () => {
    const port = await getFreePort();
    const server = await startGatewayServer(port);

    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    await new Promise<void>((resolve, reject) => {
      ws.once("open", resolve);
      ws.once("error", reject);
    });
    await connectOk(ws);

    try {
      const privateCredential = "private-credential-456";
      const setBaseHash = await resolveConfigBaseHash(ws);
      const setRes = await rpcReq<{ ok: boolean; path?: string; config?: unknown }>(ws, "config.set", {
        raw: JSON.stringify({
          security: {
            redaction: {
              nestedKeyMatchers: ["private_credential"],
            },
          },
          env: {
            vars: {
              PRIVATE_CREDENTIAL: privateCredential,
              SAFE_VALUE: "ok",
            },
          },
        }),
        ...(setBaseHash ? { baseHash: setBaseHash } : {}),
      });
      expectRpcOk("config.set(custom-patch)", setRes);
      const configPath = (setRes.payload as { path?: string } | undefined)?.path;
      expect(typeof configPath).toBe("string");
      if (typeof configPath !== "string") {
        throw new Error("missing config path from config.set response");
      }

      const getRes = await rpcReq(ws, "config.get", {});
      expect(getRes.ok).toBe(true);
      const snapshot = getRes.payload as { hash?: unknown };
      expect(typeof snapshot.hash).toBe("string");

      const patchRes = await rpcReq(ws, "config.patch", {
        raw: JSON.stringify({ ui: { seamColor: "#00ffaa" } }),
        baseHash: snapshot.hash,
      });
      expect(patchRes.ok).toBe(true);
      const patchPayload = patchRes.payload as
        | {
            config?: {
              ui?: { seamColor?: string };
              env?: {
                vars?: {
                  PRIVATE_CREDENTIAL?: string;
                  SAFE_VALUE?: string;
                };
              };
            };
          }
        | undefined;
      expect(patchPayload?.config?.ui?.seamColor).toBe("#00ffaa");
      expect(patchPayload?.config?.env?.vars?.PRIVATE_CREDENTIAL).toBe(REDACTED_SENTINEL);
      expect(patchPayload?.config?.env?.vars?.SAFE_VALUE).toBe("ok");

      const storedRaw = await fs.readFile(configPath, "utf-8");
      const stored = JSON.parse(storedRaw) as {
        ui?: { seamColor?: string };
        env?: {
          vars?: {
            PRIVATE_CREDENTIAL?: string;
            SAFE_VALUE?: string;
          };
        };
      };
      expect(stored.ui?.seamColor).toBe("#00ffaa");
      expect(stored.env?.vars?.PRIVATE_CREDENTIAL).toBe(privateCredential);
      expect(stored.env?.vars?.SAFE_VALUE).toBe("ok");
      expect(storedRaw).not.toContain(REDACTED_SENTINEL);
    } finally {
      ws.close();
      await server.close();
    }
  });
});
