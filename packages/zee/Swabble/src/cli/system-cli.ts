import type { Command } from "commander";

import { danger } from "../globals.js";
import { defaultVoiceWakeTriggers } from "../infra/voicewake.js";
import { defaultRuntime } from "../runtime.js";
import { formatDocsLink } from "../terminal/links.js";
import { theme } from "../terminal/theme.js";
import type { GatewayRpcOpts } from "./gateway-rpc.js";
import { addGatewayClientOptions, callGatewayFromCli } from "./gateway-rpc.js";

type SystemEventOpts = GatewayRpcOpts & { text?: string; mode?: string; json?: boolean };
type VoiceWakeState = {
  enabled?: boolean;
  triggers?: unknown;
  effectiveTriggers?: unknown;
};

function collectRepeatableOption(value: string, previous: string[] = []) {
  previous.push(value);
  return previous;
}

const normalizeWakeMode = (raw: unknown) => {
  const mode = typeof raw === "string" ? raw.trim() : "";
  if (!mode) return "next-heartbeat" as const;
  if (mode === "now" || mode === "next-heartbeat") return mode;
  throw new Error("--mode must be now or next-heartbeat");
};

function normalizeTriggerList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const resolved = raw
    .flatMap((entry) => String(entry).split(/[,\n]+/g))
    .map((entry) => entry.trim())
    .filter(Boolean)
    .slice(0, 32);
  return resolved;
}

function readVoiceWakeState(payload: unknown): Required<VoiceWakeState> {
  const state = (payload ?? {}) as VoiceWakeState;
  const triggers = Array.isArray(state.triggers) ? state.triggers : [];
  const effectiveTriggers = Array.isArray(state.effectiveTriggers) ? state.effectiveTriggers : [];
  const enabled = state.enabled !== false;
  return { enabled, triggers, effectiveTriggers };
}

function formatVoiceWakeStatusLines(payload: unknown): string[] {
  const state = readVoiceWakeState(payload);
  const configured = normalizeTriggerList(state.triggers);
  const effective = normalizeTriggerList(state.effectiveTriggers);
  return [
    `voice wake: ${state.enabled ? "enabled" : "disabled"}`,
    `configured triggers: ${configured.length > 0 ? configured.join(", ") : "(none)"}`,
    `active triggers: ${effective.length > 0 ? effective.join(", ") : "(none)"}`,
  ];
}

export function registerSystemCli(program: Command) {
  const system = program
    .command("system")
    .description("System tools (events, heartbeat, presence)")
    .addHelpText(
      "after",
      () =>
        `\n${theme.muted("Docs:")} ${formatDocsLink("/cli/system", "zee-bot.com/cli/system")}\n`,
    );

  addGatewayClientOptions(
    system
      .command("event")
      .description("Enqueue a system event and optionally trigger a heartbeat")
      .requiredOption("--text <text>", "System event text")
      .option("--mode <mode>", "Wake mode (now|next-heartbeat)", "next-heartbeat")
      .option("--json", "Output JSON", false),
  ).action(async (opts: SystemEventOpts) => {
    try {
      const text = typeof opts.text === "string" ? opts.text.trim() : "";
      if (!text) throw new Error("--text is required");
      const mode = normalizeWakeMode(opts.mode);
      const result = await callGatewayFromCli("wake", opts, { mode, text }, { expectFinal: false });
      if (opts.json) defaultRuntime.log(JSON.stringify(result, null, 2));
      else defaultRuntime.log("ok");
    } catch (err) {
      defaultRuntime.error(danger(String(err)));
      defaultRuntime.exit(1);
    }
  });

  const heartbeat = system.command("heartbeat").description("Heartbeat controls");

  addGatewayClientOptions(
    heartbeat
      .command("last")
      .description("Show the last heartbeat event")
      .option("--json", "Output JSON", false),
  ).action(async (opts: GatewayRpcOpts & { json?: boolean }) => {
    try {
      const result = await callGatewayFromCli("last-heartbeat", opts, undefined, {
        expectFinal: false,
      });
      defaultRuntime.log(JSON.stringify(result, null, 2));
    } catch (err) {
      defaultRuntime.error(danger(String(err)));
      defaultRuntime.exit(1);
    }
  });

  addGatewayClientOptions(
    heartbeat
      .command("enable")
      .description("Enable heartbeats")
      .option("--json", "Output JSON", false),
  ).action(async (opts: GatewayRpcOpts & { json?: boolean }) => {
    try {
      const result = await callGatewayFromCli(
        "set-heartbeats",
        opts,
        { enabled: true },
        { expectFinal: false },
      );
      defaultRuntime.log(JSON.stringify(result, null, 2));
    } catch (err) {
      defaultRuntime.error(danger(String(err)));
      defaultRuntime.exit(1);
    }
  });

  addGatewayClientOptions(
    heartbeat
      .command("disable")
      .description("Disable heartbeats")
      .option("--json", "Output JSON", false),
  ).action(async (opts: GatewayRpcOpts & { json?: boolean }) => {
    try {
      const result = await callGatewayFromCli(
        "set-heartbeats",
        opts,
        { enabled: false },
        { expectFinal: false },
      );
      defaultRuntime.log(JSON.stringify(result, null, 2));
    } catch (err) {
      defaultRuntime.error(danger(String(err)));
      defaultRuntime.exit(1);
    }
  });

  const voicewake = system.command("voicewake").description("Voice wake controls");

  addGatewayClientOptions(
    voicewake
      .command("status")
      .description("Show voice wake enabled state + triggers")
      .option("--json", "Output JSON", false),
  ).action(async (opts: GatewayRpcOpts & { json?: boolean }) => {
    try {
      const result = await callGatewayFromCli("voicewake.get", opts, undefined, {
        expectFinal: false,
      });
      if (opts.json) {
        defaultRuntime.log(JSON.stringify(result, null, 2));
        return;
      }
      defaultRuntime.log(formatVoiceWakeStatusLines(result).join("\n"));
    } catch (err) {
      defaultRuntime.error(danger(String(err)));
      defaultRuntime.exit(1);
    }
  });

  addGatewayClientOptions(
    voicewake
      .command("set")
      .description("Set wake triggers and enable voice wake")
      .argument("<triggers...>", "Trigger words/phrases")
      .option("--json", "Output JSON", false),
  ).action(async (triggers: string[], opts: GatewayRpcOpts & { json?: boolean }) => {
    try {
      const normalized = normalizeTriggerList(triggers);
      if (normalized.length === 0) {
        throw new Error("At least one trigger is required.");
      }
      const result = await callGatewayFromCli(
        "voicewake.set",
        opts,
        { enabled: true, triggers: normalized },
        { expectFinal: false },
      );
      if (opts.json) defaultRuntime.log(JSON.stringify(result, null, 2));
      else defaultRuntime.log(formatVoiceWakeStatusLines(result).join("\n"));
    } catch (err) {
      defaultRuntime.error(danger(String(err)));
      defaultRuntime.exit(1);
    }
  });

  addGatewayClientOptions(
    voicewake
      .command("enable")
      .description("Enable voice wake (optionally set triggers)")
      .option("--trigger <word>", "Add wake trigger (repeatable)", collectRepeatableOption, [])
      .option("--json", "Output JSON", false),
  ).action(async (opts: GatewayRpcOpts & { trigger?: string[]; json?: boolean }) => {
    try {
      const triggerList = normalizeTriggerList(opts.trigger);
      const params =
        triggerList.length > 0
          ? { enabled: true, triggers: triggerList }
          : {
              enabled: true,
            };
      const result = await callGatewayFromCli("voicewake.set", opts, params, {
        expectFinal: false,
      });
      if (opts.json) defaultRuntime.log(JSON.stringify(result, null, 2));
      else defaultRuntime.log(formatVoiceWakeStatusLines(result).join("\n"));
    } catch (err) {
      defaultRuntime.error(danger(String(err)));
      defaultRuntime.exit(1);
    }
  });

  addGatewayClientOptions(
    voicewake
      .command("disable")
      .description("Disable voice wake without deleting configured triggers")
      .option("--json", "Output JSON", false),
  ).action(async (opts: GatewayRpcOpts & { json?: boolean }) => {
    try {
      const result = await callGatewayFromCli(
        "voicewake.set",
        opts,
        { enabled: false },
        { expectFinal: false },
      );
      if (opts.json) defaultRuntime.log(JSON.stringify(result, null, 2));
      else defaultRuntime.log(formatVoiceWakeStatusLines(result).join("\n"));
    } catch (err) {
      defaultRuntime.error(danger(String(err)));
      defaultRuntime.exit(1);
    }
  });

  addGatewayClientOptions(
    voicewake
      .command("reset")
      .description("Reset to default triggers and enable voice wake")
      .option("--json", "Output JSON", false),
  ).action(async (opts: GatewayRpcOpts & { json?: boolean }) => {
    try {
      const result = await callGatewayFromCli(
        "voicewake.set",
        opts,
        { enabled: true, triggers: defaultVoiceWakeTriggers() },
        { expectFinal: false },
      );
      if (opts.json) defaultRuntime.log(JSON.stringify(result, null, 2));
      else defaultRuntime.log(formatVoiceWakeStatusLines(result).join("\n"));
    } catch (err) {
      defaultRuntime.error(danger(String(err)));
      defaultRuntime.exit(1);
    }
  });

  addGatewayClientOptions(
    system
      .command("presence")
      .description("List system presence entries")
      .option("--json", "Output JSON", false),
  ).action(async (opts: GatewayRpcOpts & { json?: boolean }) => {
    try {
      const result = await callGatewayFromCli("system-presence", opts, undefined, {
        expectFinal: false,
      });
      defaultRuntime.log(JSON.stringify(result, null, 2));
    } catch (err) {
      defaultRuntime.error(danger(String(err)));
      defaultRuntime.exit(1);
    }
  });
}
