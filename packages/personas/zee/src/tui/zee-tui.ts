import { spawn } from "node:child_process";
import type { RuntimeEnv } from "../runtime.js";
import { defaultRuntime } from "../runtime.js";
import type { TuiOptions } from "./tui-types.js";

type ZeeTuiOptions = TuiOptions;

const UNSUPPORTED_FLAG_HINTS: Array<[keyof ZeeTuiOptions, string]> = [
  ["token", "--token"],
  ["deliver", "--deliver"],
  ["thinking", "--thinking"],
  ["timeoutMs", "--timeout-ms"],
  ["historyLimit", "--history-limit"],
];

function formatUnsupportedOptions(opts: ZeeTuiOptions): string[] {
  const seen: string[] = [];
  for (const [key, label] of UNSUPPORTED_FLAG_HINTS) {
    const value = opts[key];
    if (value === undefined) continue;
    if (typeof value === "boolean" && value === false) continue;
    seen.push(label);
  }
  return seen;
}

function shouldUseZeeUrl(raw: string): boolean {
  return raw.startsWith("http://") || raw.startsWith("https://");
}

export async function runZeeTui(
  opts: ZeeTuiOptions,
  runtime: RuntimeEnv = defaultRuntime,
): Promise<void> {
  const binPath = process.env.ZEE_BIN_PATH || process.env.AGENT_CORE_BIN_PATH || "zee";
  const args: string[] = [];

  if (opts.session) {
    args.push("--session", opts.session);
  }
  if (opts.message) {
    args.push("--prompt", opts.message);
  }

  const env: NodeJS.ProcessEnv = { ...process.env };
  env.ZEE_ORIGINAL_PWD = env.ZEE_ORIGINAL_PWD ?? process.cwd();
  env.AGENT_CORE_ORIGINAL_PWD = env.AGENT_CORE_ORIGINAL_PWD ?? env.ZEE_ORIGINAL_PWD; // legacy compatibility

  if (opts.url) {
    if (shouldUseZeeUrl(opts.url)) {
      env.ZEE_URL = opts.url;
      env.AGENT_CORE_URL = env.AGENT_CORE_URL ?? env.ZEE_URL; // legacy compatibility
    } else {
      runtime.log(
        `[zee tui] Ignoring --url "${opts.url}". Zee expects an http(s) daemon URL.`,
      );
    }
  }

  if (opts.password) {
    env.ZEE_SERVER_PASSWORD = opts.password;
    env.AGENT_CORE_SERVER_PASSWORD = env.AGENT_CORE_SERVER_PASSWORD ?? env.ZEE_SERVER_PASSWORD; // legacy compatibility
  }

  const unsupported = formatUnsupportedOptions(opts);
  if (unsupported.length > 0) {
    runtime.log(
      `[zee tui] Ignoring unsupported option(s): ${unsupported.join(", ")}.`,
    );
  }

  runtime.log("[zee tui] Launching Zee TUI...");

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
      const err = new Error(`[zee tui] zee exited with code ${code ?? "unknown"}.`);
      runtime.error(err.message);
      reject(err);
    });
  });
}
