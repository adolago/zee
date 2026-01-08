import os from "node:os";
import path from "node:path";
import type { ZeeConfig } from "./types.js";

/**
 * Nix mode detection: When ZEE_NIX_MODE=1, the gateway is running under Nix.
 * In this mode:
 * - No auto-install flows should be attempted
 * - Missing dependencies should produce actionable Nix-specific error messages
 * - Config is managed externally (read-only from Nix perspective)
 */
export function resolveIsNixMode(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return env.ZEE_NIX_MODE === "1";
}

export const isNixMode = resolveIsNixMode();

/**
 * State directory for mutable data (sessions, logs, caches).
 * Can be overridden via ZEE_STATE_DIR environment variable.
 * Default: ~/.zee
 */
export function resolveStateDir(
  env: NodeJS.ProcessEnv = process.env,
  homedir: () => string = os.homedir,
): string {
  const override =
    env.ZEE_STATE_DIR?.trim() || env.CLAWDIS_STATE_DIR?.trim();
  if (override) return resolveUserPath(override);
  return path.join(homedir(), ".zee");
}

function resolveUserPath(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return trimmed;
  if (trimmed.startsWith("~")) {
    const expanded = trimmed.replace(/^~(?=$|[\\/])/, os.homedir());
    return path.resolve(expanded);
  }
  return path.resolve(trimmed);
}

export const STATE_DIR_ZEE = resolveStateDir();

/**
 * Config file path (JSON5).
 * Can be overridden via ZEE_CONFIG_PATH environment variable.
 * Default: ~/.zee/zee.json (or $ZEE_STATE_DIR/zee.json)
 */
export function resolveConfigPath(
  env: NodeJS.ProcessEnv = process.env,
  stateDir: string = resolveStateDir(env, os.homedir),
): string {
  const override = env.ZEE_CONFIG_PATH?.trim();
  if (override) return override;
  return path.join(stateDir, "zee.json");
}

export const CONFIG_PATH_ZEE = resolveConfigPath();

export const DEFAULT_GATEWAY_PORT = 18789;

const OAUTH_FILENAME = "oauth.json";

/**
 * OAuth credentials storage directory.
 *
 * Precedence:
 * - `ZEE_OAUTH_DIR` (explicit override)
 * - `ZEE_STATE_DIR/credentials` (canonical server/default)
 * - `~/.zee/credentials` (legacy default)
 */
export function resolveOAuthDir(
  env: NodeJS.ProcessEnv = process.env,
  stateDir: string = resolveStateDir(env, os.homedir),
): string {
  const override = env.ZEE_OAUTH_DIR?.trim();
  if (override) return resolveUserPath(override);
  return path.join(stateDir, "credentials");
}

export function resolveOAuthPath(
  env: NodeJS.ProcessEnv = process.env,
  stateDir: string = resolveStateDir(env, os.homedir),
): string {
  return path.join(resolveOAuthDir(env, stateDir), OAUTH_FILENAME);
}

export function resolveGatewayPort(
  cfg?: ZeeConfig,
  env: NodeJS.ProcessEnv = process.env,
): number {
  const envRaw = env.ZEE_GATEWAY_PORT?.trim();
  if (envRaw) {
    const parsed = Number.parseInt(envRaw, 10);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  const configPort = cfg?.gateway?.port;
  if (typeof configPort === "number" && Number.isFinite(configPort)) {
    if (configPort > 0) return configPort;
  }
  return DEFAULT_GATEWAY_PORT;
}
