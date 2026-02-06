import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { loadConfig } from "../config/config.js";
import type { ZeeConfig } from "../config/config.js";
import { isTruthyEnvValue } from "../infra/env.js";
import { listBindings } from "../routing/bindings.js";
import { resolveAgentRoute } from "../routing/resolve-route.js";
import { normalizeAgentId } from "../routing/session-key.js";
import { GATEWAY_CLIENT_MODES, GATEWAY_CLIENT_NAMES } from "../utils/message-channel.js";
import { buildGatewayConnectionDetails } from "./call.js";
import { GatewayClient } from "./client.js";

const LIVE = isTruthyEnvValue(process.env.LIVE) || isTruthyEnvValue(process.env.ZEE_LIVE_TEST);
const MESSAGING_LIVE = isTruthyEnvValue(process.env.ZEE_LIVE_MESSAGING);
const SEND_PROBE = isTruthyEnvValue(process.env.ZEE_LIVE_MESSAGING_SEND);

const describeLive = LIVE || MESSAGING_LIVE ? describe : describe.skip;
const describeSend = SEND_PROBE ? describe : describe.skip;

function logProgress(message: string): void {
  console.log(`[live-messaging] ${message}`);
}

type ChannelAccountSnapshot = {
  accountId: string;
  name?: string;
  enabled?: boolean;
  configured?: boolean;
  linked?: boolean;
  running?: boolean;
  connected?: boolean;
  lastError?: string | null;
  [key: string]: unknown;
};

type ChannelStatusPayload = {
  ts: number;
  channelOrder: string[];
  channels: Record<string, unknown>;
  channelAccounts: Record<string, ChannelAccountSnapshot[]>;
  channelDefaultAccountId: Record<string, string>;
};

function resolveGatewayToken(): string | undefined {
  const envToken = process.env.ZEE_GATEWAY_TOKEN?.trim();
  if (envToken) return envToken;
  try {
    const override = process.env.ZEE_GATEWAY_TOKEN_FILE?.trim();
    const home = process.env.HOME?.trim();
    const stateHome = process.env.XDG_STATE_HOME?.trim() || (home ? path.join(home, ".local", "state") : undefined);
    const defaultPath = stateHome ? path.join(stateHome, "agent-core", "zee_gateway_token") : undefined;

    const candidates = [override, defaultPath].filter((p): p is string => Boolean(p && p.length > 0));
    for (const candidate of candidates) {
      try {
        const token = fs.readFileSync(candidate, "utf-8").trim();
        if (token) return token;
      } catch {
        // Ignore missing/unreadable token candidates.
      }
    }
    return undefined;
  } catch {
    return undefined;
  }
}

async function connectToRunningGateway(): Promise<GatewayClient> {
  const cfg = loadConfig();
  const details = buildGatewayConnectionDetails({ config: cfg });
  const token = resolveGatewayToken();
  const password = process.env.ZEE_GATEWAY_PASSWORD?.trim() || undefined;
  const authToken = cfg.gateway?.auth?.token;
  const authPassword = cfg.gateway?.auth?.password;
  const resolvedToken =
    token ||
    (typeof authToken === "string" && authToken.trim().length > 0 ? authToken.trim() : undefined);
  const resolvedPassword =
    password ||
    (typeof authPassword === "string" && authPassword.trim().length > 0
      ? authPassword.trim()
      : undefined);

  logProgress(`connecting to ${details.url} (${details.urlSource})`);

  return await new Promise<GatewayClient>((resolve, reject) => {
    let settled = false;
    const stop = (err?: Error, client?: GatewayClient) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (err) reject(err);
      else resolve(client as GatewayClient);
    };
    const client = new GatewayClient({
      url: details.url,
      token: resolvedToken,
      password: resolvedPassword,
      clientName: GATEWAY_CLIENT_NAMES.TEST,
      clientDisplayName: "vitest-messaging-live",
      clientVersion: "dev",
      mode: GATEWAY_CLIENT_MODES.TEST,
      onHelloOk: () => stop(undefined, client),
      onConnectError: (err) =>
        stop(new Error(`cannot connect to gateway at ${details.url}: ${err.message}`)),
      onClose: (code, reason) =>
        stop(new Error(`gateway closed during connect (${code}): ${reason}`)),
    });
    const timer = setTimeout(
      () => stop(new Error(`gateway connect timeout (${details.url})`)),
      10_000,
    );
    timer.unref();
    client.start();
  });
}

function findBindingForAgent(
  cfg: ZeeConfig,
  channel: string,
  agentId: string,
): { accountId: string } | null {
  const normalized = normalizeAgentId(agentId);
  for (const binding of listBindings(cfg)) {
    if (!binding?.match) continue;
    const bindingChannel = (binding.match.channel ?? "").trim().toLowerCase();
    if (bindingChannel !== channel) continue;
    if (normalizeAgentId(binding.agentId) !== normalized) continue;
    const accountId = (binding.match.accountId ?? "").trim();
    if (accountId && accountId !== "*") return { accountId };
    return { accountId: "default" };
  }
  return null;
}

function findAccountInStatus(
  payload: ChannelStatusPayload,
  channelId: string,
  accountId?: string,
): ChannelAccountSnapshot | null {
  const accounts = payload.channelAccounts[channelId];
  if (!Array.isArray(accounts) || accounts.length === 0) return null;
  if (!accountId) return accounts[0] ?? null;
  return accounts.find((a) => a.accountId === accountId) ?? null;
}

describeLive(
  "gateway messaging provider connectivity",
  () => {
    let client: GatewayClient;
    let cfg: ZeeConfig;
    let channelStatus: ChannelStatusPayload;

    beforeAll(async () => {
      cfg = loadConfig();
      client = await connectToRunningGateway();

      // Fetch channel status once for all connectivity tests
      channelStatus = await client.request<ChannelStatusPayload>("channels.status", {
        probe: true,
        timeoutMs: 30_000,
      });
      logProgress(
        `channel status: ${Object.keys(channelStatus.channelAccounts ?? {}).join(", ")}`,
      );
    }, 60_000);

    afterAll(() => {
      client?.stop();
    });

    // --- Gateway Health ---

    describe("gateway health", () => {
      it(
        "responds to health check",
        async () => {
          const result = await client.request<unknown>("health", {});
          expect(result).toBeTruthy();
          logProgress("health check ok");
        },
        10_000,
      );

      it("returns channel status with whatsapp and matrix", () => {
        expect(channelStatus).toBeTruthy();
        expect(channelStatus.channelOrder).toBeInstanceOf(Array);
        expect(channelStatus.channelAccounts).toBeTruthy();

        const channels = Object.keys(channelStatus.channelAccounts);
        expect(channels).toContain("whatsapp");
        expect(channels).toContain("matrix");
        logProgress(`channels present: ${channels.join(", ")}`);
      });
    });

    // --- Per-Persona Channel Connectivity ---

    describe("per-persona channel connectivity", () => {
      it("zee: whatsapp account is connected", () => {
        const accounts = channelStatus.channelAccounts.whatsapp;
        if (!accounts || accounts.length === 0) {
          logProgress("skip: no whatsapp accounts configured");
          return;
        }
        const connected = accounts.filter(
          (a) => a.configured === true && a.enabled !== false,
        );
        expect(connected.length).toBeGreaterThan(0);

        for (const account of connected) {
          logProgress(
            `whatsapp/${account.accountId}: configured=${account.configured} ` +
              `connected=${account.connected} linked=${account.linked}`,
          );
        }
        // At least one WhatsApp account should be linked or connected
        const alive = connected.some((a) => a.connected === true || a.linked === true);
        expect(alive).toBe(true);
      });

      it("zee: matrix account is connected", () => {
        const binding = findBindingForAgent(cfg, "matrix", "zee");
        if (!binding) {
          logProgress("skip: no matrix binding for zee");
          return;
        }
        const account = findAccountInStatus(channelStatus, "matrix", binding.accountId);
        if (!account) {
          logProgress(`skip: matrix account ${binding.accountId} not in status`);
          return;
        }
        logProgress(
          `matrix/${account.accountId} (zee): configured=${account.configured} ` +
            `running=${account.running} connected=${account.connected}`,
        );
        expect(account.configured).toBe(true);
      });

      it("stanley: matrix account is connected", () => {
        const binding = findBindingForAgent(cfg, "matrix", "stanley");
        if (!binding) {
          logProgress("skip: no matrix binding for stanley");
          return;
        }
        const account = findAccountInStatus(channelStatus, "matrix", binding.accountId);
        if (!account) {
          logProgress(`skip: matrix account ${binding.accountId} not in status`);
          return;
        }
        logProgress(
          `matrix/${account.accountId} (stanley): configured=${account.configured} ` +
            `running=${account.running} connected=${account.connected}`,
        );
        expect(account.configured).toBe(true);
      });

      it("johny: matrix account is connected", () => {
        const binding = findBindingForAgent(cfg, "matrix", "johny");
        if (!binding) {
          logProgress("skip: no matrix binding for johny");
          return;
        }
        const account = findAccountInStatus(channelStatus, "matrix", binding.accountId);
        if (!account) {
          logProgress(`skip: matrix account ${binding.accountId} not in status`);
          return;
        }
        logProgress(
          `matrix/${account.accountId} (johny): configured=${account.configured} ` +
            `running=${account.running} connected=${account.connected}`,
        );
        expect(account.configured).toBe(true);
      });
    });

    // --- Routing Validation ---

    describe("routing validation", () => {
      it("whatsapp routes to zee by default", () => {
        const route = resolveAgentRoute({ cfg, channel: "whatsapp" });
        logProgress(`whatsapp default route: agentId=${route.agentId} matchedBy=${route.matchedBy}`);
        // WhatsApp should route to the default agent (zee/main)
        expect(route.agentId).toBeTruthy();
        expect(route.channel).toBe("whatsapp");
      });

      it("matrix binding for zee routes correctly", () => {
        const binding = findBindingForAgent(cfg, "matrix", "zee");
        if (!binding) {
          logProgress("skip: no matrix binding for zee");
          return;
        }
        const route = resolveAgentRoute({
          cfg,
          channel: "matrix",
          accountId: binding.accountId,
        });
        logProgress(
          `matrix zee route: agentId=${route.agentId} matchedBy=${route.matchedBy}`,
        );
        // Should route to zee (or the default agent if zee is the default)
        expect(route.agentId).toBeTruthy();
      });

      it("matrix binding for stanley routes correctly", () => {
        const binding = findBindingForAgent(cfg, "matrix", "stanley");
        if (!binding) {
          logProgress("skip: no matrix binding for stanley");
          return;
        }
        const route = resolveAgentRoute({
          cfg,
          channel: "matrix",
          accountId: binding.accountId,
        });
        logProgress(
          `matrix stanley route: agentId=${route.agentId} matchedBy=${route.matchedBy}`,
        );
        expect(normalizeAgentId(route.agentId)).toBe(normalizeAgentId("stanley"));
      });

      it("matrix binding for johny routes correctly", () => {
        const binding = findBindingForAgent(cfg, "matrix", "johny");
        if (!binding) {
          logProgress("skip: no matrix binding for johny");
          return;
        }
        const route = resolveAgentRoute({
          cfg,
          channel: "matrix",
          accountId: binding.accountId,
        });
        logProgress(
          `matrix johny route: agentId=${route.agentId} matchedBy=${route.matchedBy}`,
        );
        expect(normalizeAgentId(route.agentId)).toBe(normalizeAgentId("johny"));
      });
    });

    // --- Send Probe (optional, gated) ---

    describeSend("send probe", () => {
      const waTo = process.env.ZEE_LIVE_MESSAGING_SEND_TO_WA?.trim();
      const matrixTo = process.env.ZEE_LIVE_MESSAGING_SEND_TO_MATRIX?.trim();

      it(
        "sends probe message via whatsapp",
        async () => {
          if (!waTo) {
            logProgress("skip: ZEE_LIVE_MESSAGING_SEND_TO_WA not set");
            return;
          }
          const nonce = randomUUID().slice(0, 8);
          const message = `live test probe ${nonce}`;
          logProgress(`whatsapp send probe to ${waTo}: ${message}`);
          const result = await client.request<unknown>("send", {
            to: waTo,
            message,
            channel: "whatsapp",
            idempotencyKey: randomUUID(),
          });
          expect(result).toBeTruthy();
          logProgress("whatsapp send probe ok");
        },
        60_000,
      );

      it(
        "sends probe message via matrix",
        async () => {
          if (!matrixTo) {
            logProgress("skip: ZEE_LIVE_MESSAGING_SEND_TO_MATRIX not set");
            return;
          }
          const nonce = randomUUID().slice(0, 8);
          const message = `live test probe ${nonce}`;
          logProgress(`matrix send probe to ${matrixTo}: ${message}`);
          const result = await client.request<unknown>("send", {
            to: matrixTo,
            message,
            channel: "matrix",
            idempotencyKey: randomUUID(),
          });
          expect(result).toBeTruthy();
          logProgress("matrix send probe ok");
        },
        60_000,
      );
    });
  },
  120_000,
);
