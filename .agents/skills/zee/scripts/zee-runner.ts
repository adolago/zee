import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export type ZeeCliResult = {
  ok: boolean;
  data?: unknown;
  error?: string;
};

export function runZeeCli(args: string[]): ZeeCliResult {
  const repo = process.env.ZEE_REPO || join(homedir(), ".local", "src", "agent-core", "vendor", "personas", "zee");
  const runtime = process.env.ZEE_RUNTIME || "bun";
  const entry = join(repo, "src", "entry.ts");

  if (!existsSync(entry)) {
    return {
      ok: false,
      error: `Zee CLI not found at ${entry}. Set ZEE_REPO.`,
    };
  }

  const result = spawnSync(runtime, [entry, ...args], {
    encoding: "utf-8",
    cwd: repo,
    env: process.env,
  });

  if (result.error) {
    return { ok: false, error: result.error.message };
  }

  const stdout = result.stdout.trim();
  if (!stdout) {
    return { ok: false, error: result.stderr?.trim() || "Zee CLI returned no output." };
  }

  try {
    return JSON.parse(stdout) as ZeeCliResult;
  } catch {
    return { ok: false, error: stdout };
  }
}
