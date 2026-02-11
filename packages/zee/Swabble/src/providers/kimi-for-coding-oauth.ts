import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import { randomUUID } from "node:crypto";

import type { OAuthCredentials } from "@mariozechner/pi-ai";

const KIMI_CODE_CLIENT_ID = "17e5f671-d194-4dfb-9706-5516cb48c098";
const DEFAULT_OAUTH_HOST = "https://auth.kimi.com";
const DEFAULT_KIMI_CLI_VERSION = "0.77";

const KIMI_SHARE_DIR_NAME = ".kimi";
const KIMI_DEVICE_ID_FILE = "device_id";

function resolveOauthHost(): string {
  return (
    process.env.KIMI_CODE_OAUTH_HOST?.trim() ||
    process.env.KIMI_OAUTH_HOST?.trim() ||
    DEFAULT_OAUTH_HOST
  );
}

function resolveUserAgent(): { userAgent: string; version: string } {
  const userAgent = process.env.KIMI_CODE_USER_AGENT?.trim() || `KimiCLI/${DEFAULT_KIMI_CLI_VERSION}`;
  const match = /^KimiCLI\/(.+)$/.exec(userAgent);
  const version = match?.[1]?.trim() || DEFAULT_KIMI_CLI_VERSION;
  return { userAgent, version };
}

function resolveKimiShareDir(): string {
  return path.join(os.homedir(), KIMI_SHARE_DIR_NAME);
}

function resolveKimiDeviceIdPath(): string {
  return path.join(resolveKimiShareDir(), KIMI_DEVICE_ID_FILE);
}

async function ensurePrivateFile(filePath: string): Promise<void> {
  await fs.chmod(filePath, 0o600).catch(() => {});
}

async function readTextFile(filePath: string): Promise<string | null> {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch {
    return null;
  }
}

async function getDeviceId(): Promise<string> {
  const deviceIdPath = resolveKimiDeviceIdPath();
  const cached = await readTextFile(deviceIdPath);
  if (cached && cached.trim()) return cached.trim();

  const deviceId = randomUUID().replace(/-/g, "");
  await fs.mkdir(path.dirname(deviceIdPath), { recursive: true });
  await fs.writeFile(deviceIdPath, deviceId, "utf8");
  await ensurePrivateFile(deviceIdPath);
  return deviceId;
}

function getDeviceModel(): string {
  const platform = os.platform();
  const arch = os.arch();
  const release = os.release();

  if (platform === "win32") {
    let winRelease = release;
    const parts = release.split(".");
    const build = Number(parts[2] ?? "0");
    if (parts[0] === "10" && build >= 22000) {
      winRelease = "11";
    }
    return `Windows ${winRelease} ${arch}`.trim();
  }
  if (platform === "linux") {
    return `Linux ${release} ${arch}`.trim();
  }
  if (platform) {
    return `Unix ${release} ${arch}`.trim();
  }
  return `Unknown ${arch}`.trim();
}

async function getKimiHeaders(): Promise<Record<string, string>> {
  const deviceId = await getDeviceId();
  const { userAgent, version } = resolveUserAgent();
  const osVersion = typeof os.version === "function" ? os.version() : os.release();

  return {
    "User-Agent": userAgent,
    "X-Msh-Platform": "kimi_cli",
    "X-Msh-Version": version,
    "X-Msh-Device-Name": os.hostname(),
    "X-Msh-Device-Model": getDeviceModel(),
    "X-Msh-Os-Version": osVersion,
    "X-Msh-Device-Id": deviceId,
  };
}

type KimiTokenRefreshResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
};

export async function refreshKimiForCodingCredentials(
  credential: OAuthCredentials,
): Promise<OAuthCredentials> {
  const refreshToken = credential.refresh?.trim();
  if (!refreshToken) {
    throw new Error("Missing refresh token.");
  }

  const headers = await getKimiHeaders();
  const response = await fetch(`${resolveOauthHost()}/api/oauth/token`, {
    method: "POST",
    headers: {
      ...headers,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      client_id: KIMI_CODE_CLIENT_ID,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
  });

  if (response.status === 401 || response.status === 403) {
    throw new Error(`Kimi OAuth refresh unauthorized (${response.status}).`);
  }

  const data = (await response.json().catch(() => ({}))) as KimiTokenRefreshResponse;
  if (!response.ok) {
    const details = data.error_description || data.error || `${response.status}`;
    throw new Error(`Kimi OAuth refresh failed (${details}).`);
  }

  const access = typeof data.access_token === "string" ? data.access_token.trim() : "";
  if (!access) {
    throw new Error("Kimi OAuth refresh response missing access token.");
  }

  const nextRefresh = typeof data.refresh_token === "string" ? data.refresh_token.trim() : "";
  const expiresIn = typeof data.expires_in === "number" && data.expires_in > 0 ? data.expires_in : 3600;

  return {
    ...credential,
    access,
    refresh: nextRefresh || refreshToken,
    expires: Date.now() + expiresIn * 1000,
  };
}

