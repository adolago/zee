import crypto from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";

export type CanvasHostAuth = {
  mode: "token" | "password";
  token?: string;
  password?: string;
};

export type CanvasHostAuthResult =
  | { ok: true; setCookie?: string[] }
  | { ok: false; reason: string };

export const CANVAS_AUTH_QUERY_PARAM = "auth";
export const CANVAS_AUTH_COOKIE_ZEE = "zee_canvas_auth";
export const CANVAS_AUTH_COOKIE_AGENT = "zee_agent_canvas_auth";

export function resolveCanvasAuthSecret(auth: CanvasHostAuth | undefined): string | null {
  if (!auth) return null;
  if (auth.mode === "password") {
    return typeof auth.password === "string" && auth.password.trim() ? auth.password.trim() : null;
  }
  return typeof auth.token === "string" && auth.token.trim() ? auth.token.trim() : null;
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

function getHeader(req: IncomingMessage, name: string): string | undefined {
  const raw = req.headers[name.toLowerCase()];
  if (typeof raw === "string") return raw;
  if (Array.isArray(raw)) return raw[0];
  return undefined;
}

function getBearerToken(req: IncomingMessage): string | undefined {
  const raw = getHeader(req, "authorization")?.trim() ?? "";
  if (!raw.toLowerCase().startsWith("bearer ")) return undefined;
  const token = raw.slice(7).trim();
  return token || undefined;
}

function parseCookieHeader(value: string | undefined): Record<string, string> {
  if (typeof value !== "string" || !value.trim()) return {};
  const out: Record<string, string> = {};
  for (const part of value.split(";")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const name = trimmed.slice(0, eq).trim();
    const rawValue = trimmed.slice(eq + 1).trim();
    if (!name) continue;
    try {
      out[name] = decodeURIComponent(rawValue);
    } catch {
      out[name] = rawValue;
    }
  }
  return out;
}

function isSecureRequest(req: IncomingMessage): boolean {
  const forwardedProto = getHeader(req, "x-forwarded-proto")?.trim().toLowerCase();
  if (forwardedProto === "https") return true;
  const socket = req.socket as unknown as { encrypted?: boolean };
  return socket.encrypted === true;
}

function buildCookie(value: string, params: { name: string; path: string; secure: boolean }): string {
  const encValue = encodeURIComponent(value);
  const parts = [
    `${params.name}=${encValue}`,
    `Path=${params.path}`,
    "HttpOnly",
    "SameSite=Strict",
    "Max-Age=3600",
  ];
  if (params.secure) parts.push("Secure");
  return parts.join("; ");
}

function getCanvasCookieCandidates(req: IncomingMessage): string[] {
  const cookies = parseCookieHeader(getHeader(req, "cookie"));
  const out: string[] = [];
  for (const name of [CANVAS_AUTH_COOKIE_ZEE, CANVAS_AUTH_COOKIE_AGENT]) {
    const value = cookies[name];
    if (typeof value === "string" && value.trim()) out.push(value.trim());
  }
  return out;
}

export function authorizeCanvasHostRequest(params: {
  req: IncomingMessage;
  res?: ServerResponse;
  auth: CanvasHostAuth | undefined;
}): CanvasHostAuthResult {
  const secret = resolveCanvasAuthSecret(params.auth);
  if (!secret) return { ok: false, reason: "auth_not_configured" };

  const bearer = getBearerToken(params.req);
  if (bearer && safeEqual(bearer, secret)) {
    return { ok: true };
  }

  for (const cookie of getCanvasCookieCandidates(params.req)) {
    if (safeEqual(cookie, secret)) {
      return { ok: true };
    }
  }

  const urlRaw = params.req.url;
  if (urlRaw) {
    const url = new URL(urlRaw, "http://localhost");
    const raw = url.searchParams.get(CANVAS_AUTH_QUERY_PARAM);
    const queryToken = typeof raw === "string" ? raw.trim() : "";
    if (queryToken && safeEqual(queryToken, secret)) {
      const secure = isSecureRequest(params.req);
      const cookies = [
        buildCookie(secret, { name: CANVAS_AUTH_COOKIE_ZEE, path: "/__zee__/", secure }),
        buildCookie(secret, { name: CANVAS_AUTH_COOKIE_AGENT, path: "/__agent__/", secure }),
      ];
      if (params.res) {
        params.res.setHeader("Set-Cookie", cookies);
      }
      return { ok: true, setCookie: cookies };
    }
  }

  return { ok: false, reason: "unauthorized" };
}

export function sendCanvasHostUnauthorized(res: ServerResponse): void {
  res.statusCode = 401;
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.end("Unauthorized");
}

