import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ZeeConfig } from "./types.js";
import { deriveDefaultCanvasHostPort } from "./port-defaults.js";

/**
 * Nix mode detection: When ZEE_NIX_MODE=1, the gateway is running under Nix.
 * In this mode:
 * - No auto-install flows should be attempted
 * - Missing dependencies should produce actionable Nix-specific error messages
 * - Config is managed externally (read-only from Nix perspective)
 */
export function resolveIsNixMode(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.ZEE_NIX_MODE === "1";
}

export const isNixMode = resolveIsNixMode();

const DEFAULT_STATE_DIRNAME = ".zee";
const CONFIG_FILENAME = "zee.json";

function defaultStateDir(homedir: () => string = os.homedir): string {
  return path.join(homedir(), DEFAULT_STATE_DIRNAME);
}

export function resolveLegacyStateDir(homedir: () => string = os.homedir): string {
  return defaultStateDir(homedir);
}

export function resolveNewStateDir(homedir: () => string = os.homedir): string {
  return defaultStateDir(homedir);
}

/**
 * State directory for mutable data (sessions, logs, caches).
 * Can be overridden via ZEE_STATE_DIR.
 * Default: ~/.zee.
 */
export function resolveStateDir(
  env: NodeJS.ProcessEnv = process.env,
  homedir: () => string = os.homedir,
): string {
  const override = env.ZEE_STATE_DIR?.trim();
  if (override) return resolveUserPath(override);
  return defaultStateDir(homedir);
}

function resolveUserPath(input: string): string {
  if (!input) return process.cwd();
  const trimmed = input.trim();
  if (!trimmed) return trimmed;
  if (trimmed.startsWith("~")) {
    const expanded = trimmed.replace(/^~(?=$|[\\/])/, os.homedir());
    return path.resolve(expanded);
  }
  return path.resolve(trimmed);
}

export const STATE_DIR = resolveStateDir();

/**
 * Config file path (JSON5).
 * Can be overridden via ZEE_CONFIG_PATH.
 * Default: ~/.zee/zee.json (or $ZEE_STATE_DIR/zee.json)
 */
export function resolveCanonicalConfigPath(
  env: NodeJS.ProcessEnv = process.env,
  stateDir: string = resolveStateDir(env, os.homedir),
): string {
  const override = env.ZEE_CONFIG_PATH?.trim();
  if (override) return resolveUserPath(override);
  return path.join(stateDir, CONFIG_FILENAME);
}

/**
 * Resolve the active config path by preferring existing config candidates
 * before falling back to the canonical path.
 */
export function resolveConfigPathCandidate(
  env: NodeJS.ProcessEnv = process.env,
  homedir: () => string = os.homedir,
): string {
  const candidates = resolveDefaultConfigCandidates(env, homedir);
  const existing = candidates.find((candidate) => {
    try {
      return fs.existsSync(candidate);
    } catch {
      return false;
    }
  });
  if (existing) return existing;
  return resolveCanonicalConfigPath(env, resolveStateDir(env, homedir));
}

/**
 * Active config path (prefers existing config files).
 */
export function resolveConfigPath(
  env: NodeJS.ProcessEnv = process.env,
  stateDir: string = resolveStateDir(env, os.homedir),
  homedir: () => string = os.homedir,
): string {
  const override = env.ZEE_CONFIG_PATH?.trim();
  if (override) return resolveUserPath(override);
  const stateOverride = env.ZEE_STATE_DIR?.trim();
  const candidates = [path.join(stateDir, CONFIG_FILENAME)];
  const existing = candidates.find((candidate) => {
    try {
      return fs.existsSync(candidate);
    } catch {
      return false;
    }
  });
  if (existing) return existing;
  if (stateOverride) return path.join(stateDir, CONFIG_FILENAME);
  const defaultStateDir = resolveStateDir(env, homedir);
  if (path.resolve(stateDir) === path.resolve(defaultStateDir)) {
    return resolveConfigPathCandidate(env, homedir);
  }
  return path.join(stateDir, CONFIG_FILENAME);
}

export const CONFIG_PATH = resolveConfigPathCandidate();

/**
 * Resolve default config path candidates across standard locations.
 * Order: explicit config path → state-dir-derived paths → default location.
 */
export function resolveDefaultConfigCandidates(
  env: NodeJS.ProcessEnv = process.env,
  homedir: () => string = os.homedir,
): string[] {
  const explicit = env.ZEE_CONFIG_PATH?.trim();
  if (explicit) return [resolveUserPath(explicit)];

  const candidates: string[] = [];
  const stateOverride = env.ZEE_STATE_DIR?.trim();
  if (stateOverride) {
    const resolved = resolveUserPath(stateOverride);
    candidates.push(path.join(resolved, CONFIG_FILENAME));
  }
  const newDir = defaultStateDir(homedir);
  candidates.push(path.join(newDir, CONFIG_FILENAME));
  return candidates;
}

export const DEFAULT_GATEWAY_PORT = 18789;
export const DEFAULT_CANVAS_HOST_PORT = 18793;

/**
 * Gateway lock directory (ephemeral).
 * Default: os.tmpdir()/zee-<uid> (uid suffix when available).
 */
export function resolveGatewayLockDir(tmpdir: () => string = os.tmpdir): string {
  const base = tmpdir();
  const uid = typeof process.getuid === "function" ? process.getuid() : undefined;
  const suffix = uid != null ? `zee-${uid}` : "zee";
  return path.join(base, suffix);
}

const OAUTH_FILENAME = "oauth.json";

/**
 * OAuth credentials storage directory.
 *
 * Precedence:
 * - `ZEE_OAUTH_DIR` (explicit override)
 * - `$*_STATE_DIR/credentials` (canonical server/default)
 * - state dir credentials fallback
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

export function resolveCanvasHostPort(
  cfg?: ZeeConfig,
  env: NodeJS.ProcessEnv = process.env,
): number {
  const envRaw = env.ZEE_CANVAS_HOST_PORT?.trim();
  if (envRaw) {
    const parsed = Number.parseInt(envRaw, 10);
    if (Number.isFinite(parsed) && parsed > 0 && parsed <= 65535) return parsed;
  }
  const configPort = cfg?.canvasHost?.port;
  if (typeof configPort === "number" && Number.isFinite(configPort)) {
    if (configPort > 0 && configPort <= 65535) return configPort;
  }
  const gatewayPort = resolveGatewayPort(cfg, env);
  const derived = deriveDefaultCanvasHostPort(gatewayPort);
  return derived > 0 ? derived : DEFAULT_CANVAS_HOST_PORT;
}
