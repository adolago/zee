import type { Command } from "commander";
import { gatewayStatusCommand } from "../../commands/gateway-status.js";
import { formatHealthChannelLines, type HealthSummary } from "../../commands/health.js";
import { loadConfig } from "../../config/config.js";
import { resolveGatewayAuth } from "../../gateway/auth.js";
import { discoverGatewayBeacons } from "../../infra/bonjour-discovery.js";
import type { CostUsageSummary } from "../../infra/session-cost-usage.js";
import { WIDE_AREA_DISCOVERY_DOMAIN } from "../../infra/widearea-dns.js";
import { defaultRuntime } from "../../runtime.js";
import { formatDocsLink } from "../../terminal/links.js";
import { colorize, isRich, theme } from "../../terminal/theme.js";
import { formatTokenCount, formatUsd } from "../../utils/usage-format.js";
import { withProgress } from "../progress.js";
import { runCommandWithRuntime } from "../cli-utils.js";
import {
  runDaemonInstall,
  runDaemonRestart,
  runDaemonStart,
  runDaemonStatus,
  runDaemonStop,
  runDaemonUninstall,
} from "../daemon-cli.js";
import { callGatewayCli, gatewayCallOpts } from "./call.js";
import type { GatewayDiscoverOpts } from "./discover.js";
import {
  dedupeBeacons,
  parseDiscoverTimeoutMs,
  pickBeaconHost,
  pickGatewayPort,
  renderBeaconLines,
} from "./discover.js";
import { addGatewayRunCommand } from "./run.js";

function styleHealthChannelLine(line: string, rich: boolean): string {
  if (!rich) return line;
  const colon = line.indexOf(":");
  if (colon === -1) return line;

  const label = line.slice(0, colon + 1);
  const detail = line.slice(colon + 1).trimStart();
  const normalized = detail.toLowerCase();

  const applyPrefix = (prefix: string, color: (value: string) => string) =>
    `${label} ${color(detail.slice(0, prefix.length))}${detail.slice(prefix.length)}`;

  if (normalized.startsWith("failed")) return applyPrefix("failed", theme.error);
  if (normalized.startsWith("ok")) return applyPrefix("ok", theme.success);
  if (normalized.startsWith("linked")) return applyPrefix("linked", theme.success);
  if (normalized.startsWith("configured")) return applyPrefix("configured", theme.success);
  if (normalized.startsWith("not linked")) return applyPrefix("not linked", theme.warn);
  if (normalized.startsWith("not configured")) return applyPrefix("not configured", theme.muted);
  if (normalized.startsWith("unknown")) return applyPrefix("unknown", theme.warn);

  return line;
}

function runGatewayCommand(action: () => Promise<void>, label?: string) {
  return runCommandWithRuntime(defaultRuntime, action, (err) => {
    const message = String(err);
    defaultRuntime.error(label ? `${label}: ${message}` : message);
    defaultRuntime.exit(1);
  });
}

function parseDaysOption(raw: unknown, fallback = 30): number {
  if (typeof raw === "number" && Number.isFinite(raw)) return Math.max(1, Math.floor(raw));
  if (typeof raw === "string" && raw.trim() !== "") {
    const parsed = Number(raw);
    if (Number.isFinite(parsed)) return Math.max(1, Math.floor(parsed));
  }
  return fallback;
}

function renderCostUsageSummary(summary: CostUsageSummary, days: number, rich: boolean): string[] {
  const totalCost = formatUsd(summary.totals.totalCost) ?? "$0.00";
  const totalTokens = formatTokenCount(summary.totals.totalTokens) ?? "0";
  const lines = [
    colorize(rich, theme.heading, `Usage cost (${days} days)`),
    `${colorize(rich, theme.muted, "Total:")} ${totalCost} · ${totalTokens} tokens`,
  ];

  if (summary.totals.missingCostEntries > 0) {
    lines.push(
      `${colorize(rich, theme.muted, "Missing entries:")} ${summary.totals.missingCostEntries}`,
    );
  }

  const latest = summary.daily.at(-1);
  if (latest) {
    const latestCost = formatUsd(latest.totalCost) ?? "$0.00";
    const latestTokens = formatTokenCount(latest.totalTokens) ?? "0";
    lines.push(
      `${colorize(rich, theme.muted, "Latest day:")} ${latest.date} · ${latestCost} · ${latestTokens} tokens`,
    );
  }

  return lines;
}

type WebWorkflowCheck = {
  id: string;
  label: string;
  method: string;
  ok: boolean;
  error?: string;
};

type GatewayWebSummary = {
  wsUrl: string;
  checks: WebWorkflowCheck[];
  warnings: string[];
  auth: {
    mode: "token" | "password";
    hasSharedSecret: boolean;
    tailscaleMode: string;
    allowTailscale: boolean;
  };
  proxy: {
    allowedOrigins: string[];
    trustedProxies: string[];
  };
};

const WEB_WORKFLOW_CHECKS: Array<Pick<WebWorkflowCheck, "id" | "label" | "method">> = [
  { id: "health", label: "Gateway health", method: "health" },
  { id: "sessions", label: "Session visibility", method: "sessions.list" },
  { id: "approvals", label: "Approval controls", method: "exec.approvals.get" },
  { id: "pairing-nodes", label: "Node pairing", method: "node.pair.list" },
  { id: "pairing-devices", label: "Device pairing", method: "device.pair.list" },
  { id: "channels", label: "Channel state", method: "channels.status" },
];

function resolveGatewayWsUrlFromConfig(): string {
  const cfg = loadConfig();
  const remoteUrl = cfg.gateway?.remote?.url?.trim();
  if (remoteUrl) return remoteUrl;
  const port = cfg.gateway?.port ?? 18789;
  return `ws://127.0.0.1:${port}`;
}

function buildWebOperatorWarnings(params: {
  auth: GatewayWebSummary["auth"];
  proxy: GatewayWebSummary["proxy"];
}): string[] {
  const warnings: string[] = [];
  if (
    !params.auth.hasSharedSecret &&
    !(params.auth.allowTailscale && params.auth.tailscaleMode === "serve")
  ) {
    warnings.push(
      "Gateway auth secret is missing. Set gateway.auth.token/password before exposing web operator clients.",
    );
  }
  if (params.proxy.allowedOrigins.length === 0) {
    warnings.push(
      "gateway.allowedOrigins is empty. Add explicit web UI origins when running Control UI/WebChat on a different host/port.",
    );
  }
  if (params.proxy.trustedProxies.length === 0) {
    warnings.push(
      "gateway.trustedProxies is empty. Configure reverse-proxy IPs before relying on X-Forwarded-For/X-Real-IP.",
    );
  }
  return warnings;
}

async function buildGatewayWebSummary(opts: {
  url?: string;
  token?: string;
  password?: string;
  timeout?: string;
  expectFinal?: boolean;
  json?: boolean;
}): Promise<GatewayWebSummary> {
  const cfg = loadConfig();
  const tailscaleMode = cfg.gateway?.tailscale?.mode ?? "off";
  const auth = resolveGatewayAuth({
    authConfig: cfg.gateway?.auth,
    tailscaleMode,
    env: process.env,
  });
  const hasSharedSecret =
    (auth.mode === "token" && typeof auth.token === "string" && auth.token.trim().length > 0) ||
    (auth.mode === "password" &&
      typeof auth.password === "string" &&
      auth.password.trim().length > 0);
  const proxy = {
    allowedOrigins:
      cfg.gateway?.allowedOrigins?.map((value) => value.trim()).filter(Boolean) ?? [],
    trustedProxies:
      cfg.gateway?.trustedProxies?.map((value) => value.trim()).filter(Boolean) ?? [],
  };

  const checks: WebWorkflowCheck[] = [];
  for (const check of WEB_WORKFLOW_CHECKS) {
    try {
      const params = check.method === "channels.status" ? { probe: false } : {};
      await callGatewayCli(check.method, opts, params);
      checks.push({
        ...check,
        ok: true,
      });
    } catch (err) {
      checks.push({
        ...check,
        ok: false,
        error: String(err),
      });
    }
  }

  return {
    wsUrl: opts.url?.trim() || resolveGatewayWsUrlFromConfig(),
    checks,
    warnings: buildWebOperatorWarnings({
      auth: {
        mode: auth.mode,
        hasSharedSecret,
        tailscaleMode,
        allowTailscale: auth.allowTailscale === true,
      },
      proxy,
    }),
    auth: {
      mode: auth.mode,
      hasSharedSecret,
      tailscaleMode,
      allowTailscale: auth.allowTailscale === true,
    },
    proxy,
  };
}

export function registerGatewayCli(program: Command) {
  const gateway = addGatewayRunCommand(
    program
      .command("gateway")
      .description("Run the WebSocket Gateway")
      .addHelpText(
        "after",
        () =>
          `\n${theme.muted("Docs:")} ${formatDocsLink("/cli/gateway", "zee-bot.com/cli/gateway")}\n`,
      ),
  );

  addGatewayRunCommand(
    gateway.command("run").description("Run the WebSocket Gateway (foreground)"),
  );

  gateway
    .command("status")
    .description("Show gateway service status + probe the Gateway")
    .option("--url <url>", "Gateway WebSocket URL (defaults to config/remote/local)")
    .option("--token <token>", "Gateway token (if required)")
    .option("--password <password>", "Gateway password (password auth)")
    .option("--timeout <ms>", "Timeout in ms", "10000")
    .option("--no-probe", "Skip RPC probe")
    .option("--deep", "Scan system-level services", false)
    .option("--json", "Output JSON", false)
    .action(async (opts) => {
      await runDaemonStatus({
        rpc: opts,
        probe: Boolean(opts.probe),
        deep: Boolean(opts.deep),
        json: Boolean(opts.json),
      });
    });

  gateway
    .command("install")
    .description("Install the Gateway service (systemd/schtasks)")
    .option("--port <port>", "Gateway port")
    .option("--runtime <runtime>", "Daemon runtime (node|bun). Default: node")
    .option("--token <token>", "Gateway token (token auth)")
    .option("--force", "Reinstall/overwrite if already installed", false)
    .option("--json", "Output JSON", false)
    .action(async (opts) => {
      await runDaemonInstall(opts);
    });

  gateway
    .command("uninstall")
    .description("Uninstall the Gateway service (systemd/schtasks)")
    .option("--json", "Output JSON", false)
    .action(async (opts) => {
      await runDaemonUninstall(opts);
    });

  gateway
    .command("start")
    .description("Start the Gateway service (systemd/schtasks)")
    .option("--json", "Output JSON", false)
    .action(async (opts) => {
      await runDaemonStart(opts);
    });

  gateway
    .command("stop")
    .description("Stop the Gateway service (systemd/schtasks)")
    .option("--json", "Output JSON", false)
    .action(async (opts) => {
      await runDaemonStop(opts);
    });

  gateway
    .command("restart")
    .description("Restart the Gateway service (systemd/schtasks)")
    .option("--json", "Output JSON", false)
    .action(async (opts) => {
      await runDaemonRestart(opts);
    });

  gatewayCallOpts(
    gateway
      .command("call")
      .description("Call a Gateway method")
      .argument("<method>", "Method name (health/status/system-presence/cron.*)")
      .option("--params <json>", "JSON object string for params", "{}")
      .action(async (method, opts) => {
        await runGatewayCommand(async () => {
          const params = JSON.parse(String(opts.params ?? "{}"));
          const result = await callGatewayCli(method, opts, params);
          if (opts.json) {
            defaultRuntime.log(JSON.stringify(result, null, 2));
            return;
          }
          const rich = isRich();
          defaultRuntime.log(
            `${colorize(rich, theme.heading, "Gateway call")}: ${colorize(rich, theme.muted, String(method))}`,
          );
          defaultRuntime.log(JSON.stringify(result, null, 2));
        }, "Gateway call failed");
      }),
  );

  gatewayCallOpts(
    gateway
      .command("usage-cost")
      .description("Fetch usage cost summary from session logs")
      .option("--days <days>", "Number of days to include", "30")
      .action(async (opts) => {
        await runGatewayCommand(async () => {
          const days = parseDaysOption(opts.days);
          const result = await callGatewayCli("usage.cost", opts, { days });
          if (opts.json) {
            defaultRuntime.log(JSON.stringify(result, null, 2));
            return;
          }
          const rich = isRich();
          const summary = result as CostUsageSummary;
          for (const line of renderCostUsageSummary(summary, days, rich)) {
            defaultRuntime.log(line);
          }
        }, "Gateway usage cost failed");
      }),
  );

  gatewayCallOpts(
    gateway
      .command("health")
      .description("Fetch Gateway health")
      .action(async (opts) => {
        await runGatewayCommand(async () => {
          const result = await callGatewayCli("health", opts);
          if (opts.json) {
            defaultRuntime.log(JSON.stringify(result, null, 2));
            return;
          }
          const rich = isRich();
          const obj =
            result && typeof result === "object" ? (result as Record<string, unknown>) : {};
          const durationMs = typeof obj.durationMs === "number" ? obj.durationMs : null;
          defaultRuntime.log(colorize(rich, theme.heading, "Gateway Health"));
          defaultRuntime.log(
            `${colorize(rich, theme.success, "OK")}${durationMs != null ? ` (${durationMs}ms)` : ""}`,
          );
          if (obj.channels && typeof obj.channels === "object") {
            for (const line of formatHealthChannelLines(obj as HealthSummary)) {
              defaultRuntime.log(styleHealthChannelLine(line, rich));
            }
          }
        });
      }),
  );

  gatewayCallOpts(
    gateway
      .command("web")
      .description(
        "Validate web operator readiness (sessions, approvals, pairing, health, channel state)",
      )
      .action(async (opts) => {
        await runGatewayCommand(async () => {
          const summary = await buildGatewayWebSummary(opts);
          if (opts.json) {
            defaultRuntime.log(JSON.stringify(summary, null, 2));
            return;
          }
          const rich = isRich();
          defaultRuntime.log(colorize(rich, theme.heading, "Gateway Web Operator"));
          defaultRuntime.log(`${colorize(rich, theme.muted, "WS URL:")} ${summary.wsUrl}`);
          defaultRuntime.log(
            `${colorize(rich, theme.muted, "Auth:")} ${summary.auth.mode} · ${
              summary.auth.hasSharedSecret ? "configured" : "missing secret"
            }`,
          );
          defaultRuntime.log(
            `${colorize(rich, theme.muted, "Proxy:")} origins=${summary.proxy.allowedOrigins.length} trustedProxies=${summary.proxy.trustedProxies.length}`,
          );
          defaultRuntime.log("");
          defaultRuntime.log(colorize(rich, theme.heading, "Workflow checks"));
          for (const check of summary.checks) {
            const status = check.ok
              ? colorize(rich, theme.success, "ok")
              : colorize(rich, theme.error, "failed");
            defaultRuntime.log(`- ${check.label}: ${status}`);
            if (!check.ok && check.error) {
              defaultRuntime.log(`  ${colorize(rich, theme.muted, check.error)}`);
            }
          }
          if (summary.warnings.length > 0) {
            defaultRuntime.log("");
            defaultRuntime.log(colorize(rich, theme.warn, "Security guidance"));
            for (const warning of summary.warnings) {
              defaultRuntime.log(`- ${warning}`);
            }
          }
        }, "Gateway web readiness check failed");
      }),
  );

  gateway
    .command("probe")
    .description("Show gateway reachability + discovery + health + status summary (local + remote)")
    .option("--url <url>", "Explicit Gateway WebSocket URL (still probes localhost)")
    .option("--ssh <target>", "SSH target for remote gateway tunnel (user@host or user@host:port)")
    .option("--ssh-identity <path>", "SSH identity file path")
    .option("--ssh-auto", "Try to derive an SSH target from Bonjour discovery", false)
    .option("--token <token>", "Gateway token (applies to all probes)")
    .option("--password <password>", "Gateway password (applies to all probes)")
    .option("--timeout <ms>", "Overall probe budget in ms", "3000")
    .option("--json", "Output JSON", false)
    .action(async (opts) => {
      await runGatewayCommand(async () => {
        await gatewayStatusCommand(opts, defaultRuntime);
      });
    });

  gateway
    .command("discover")
    .description(
      `Discover gateways via Bonjour (multicast local. + unicast ${WIDE_AREA_DISCOVERY_DOMAIN})`,
    )
    .option("--timeout <ms>", "Per-command timeout in ms", "2000")
    .option("--json", "Output JSON", false)
    .action(async (opts: GatewayDiscoverOpts) => {
      await runGatewayCommand(async () => {
        const timeoutMs = parseDiscoverTimeoutMs(opts.timeout, 2000);
        const beacons = await withProgress(
          {
            label: "Scanning for gateways…",
            indeterminate: true,
            enabled: opts.json !== true,
            delayMs: 0,
          },
          async () => await discoverGatewayBeacons({ timeoutMs }),
        );

        const deduped = dedupeBeacons(beacons).sort((a, b) =>
          String(a.displayName || a.instanceName).localeCompare(
            String(b.displayName || b.instanceName),
          ),
        );

        if (opts.json) {
          const enriched = deduped.map((b) => {
            const host = pickBeaconHost(b);
            const port = pickGatewayPort(b);
            return { ...b, wsUrl: host ? `ws://${host}:${port}` : null };
          });
          defaultRuntime.log(
            JSON.stringify(
              {
                timeoutMs,
                domains: ["local.", WIDE_AREA_DISCOVERY_DOMAIN],
                count: enriched.length,
                beacons: enriched,
              },
              null,
              2,
            ),
          );
          return;
        }

        const rich = isRich();
        defaultRuntime.log(colorize(rich, theme.heading, "Gateway Discovery"));
        defaultRuntime.log(
          colorize(
            rich,
            theme.muted,
            `Found ${deduped.length} gateway(s) · domains: local., ${WIDE_AREA_DISCOVERY_DOMAIN}`,
          ),
        );
        if (deduped.length === 0) return;

        for (const beacon of deduped) {
          for (const line of renderBeaconLines(beacon, rich)) {
            defaultRuntime.log(line);
          }
        }
      }, "gateway discover failed");
    });
}
