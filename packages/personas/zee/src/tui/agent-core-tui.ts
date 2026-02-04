import { spawn } from "node:child_process";
import type { RuntimeEnv } from "../runtime.js";
import { defaultRuntime } from "../runtime.js";
import type { TuiOptions } from "./tui-types.js";

type AgentCoreTuiOptions = TuiOptions;

const UNSUPPORTED_FLAG_HINTS: Array<[keyof AgentCoreTuiOptions, string]> = [
  ["token", "--token"],
  ["deliver", "--deliver"],
  ["thinking", "--thinking"],
  ["timeoutMs", "--timeout-ms"],
  ["historyLimit", "--history-limit"],
];

function formatUnsupportedOptions(opts: AgentCoreTuiOptions): string[] {
  const seen: string[] = [];
  for (const [key, label] of UNSUPPORTED_FLAG_HINTS) {
    const value = opts[key];
    if (value === undefined) continue;
    if (typeof value === "boolean" && value === false) continue;
    seen.push(label);
  }
  return seen;
}

function shouldUseAgentCoreUrl(raw: string): boolean {
  return raw.startsWith("http://") || raw.startsWith("https://");
}

export async function runAgentCoreTui(
  opts: AgentCoreTuiOptions,
  runtime: RuntimeEnv = defaultRuntime,
): Promise<void> {
  const binPath = process.env.AGENT_CORE_BIN_PATH || "agent-core";
  const args: string[] = [];

  if (opts.session) {
    args.push("--session", opts.session);
  }
  if (opts.message) {
    args.push("--prompt", opts.message);
  }

  const env: NodeJS.ProcessEnv = { ...process.env };
  env.AGENT_CORE_ORIGINAL_PWD = env.AGENT_CORE_ORIGINAL_PWD ?? process.cwd();

  if (opts.url) {
    if (shouldUseAgentCoreUrl(opts.url)) {
      env.AGENT_CORE_URL = opts.url;
    } else {
      runtime.log(
        `[zee tui] Ignoring --url "${opts.url}". Agent-core expects an http(s) daemon URL.`,
      );
    }
  }

  if (opts.password) {
    env.AGENT_CORE_SERVER_PASSWORD = opts.password;
  }

  const unsupported = formatUnsupportedOptions(opts);
  if (unsupported.length > 0) {
    runtime.log(
      `[zee tui] Ignoring unsupported option(s): ${unsupported.join(", ")}.`,
    );
  }

  runtime.log("[zee tui] Launching agent-core TUI...");

  await new Promise<void>((resolve, reject) => {
    const child = spawn(binPath, args, {
      stdio: "inherit",
      env,
    });
    child.on("error", (err) => {
      runtime.error(`[zee tui] Failed to launch ${binPath}: ${String(err)}`);
      reject(err);
    });
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      const err = new Error(`[zee tui] agent-core exited with code ${code ?? "unknown"}.`);
      runtime.error(err.message);
      reject(err);
    });
  });
}
