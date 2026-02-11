import { randomUUID } from "node:crypto";
import type { IncomingMessage } from "node:http";

import { buildAgentMainSessionKey, normalizeAgentId } from "../routing/session-key.js";

/**
 * Reject session keys that contain path traversal sequences, null bytes,
 * or other characters that could escape directory boundaries when the key
 * is later used as (or embedded in) a filesystem path.
 *
 * Allowed characters: alphanumeric, dash, underscore, colon, dot, plus, at.
 * Maximum length: 256 characters.
 */
const SESSION_KEY_MAX_LENGTH = 256;
const SESSION_KEY_SAFE_RE = /^[a-zA-Z0-9_:.\-+@]+$/;

function sanitizeSessionKey(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  if (trimmed.length > SESSION_KEY_MAX_LENGTH) {
    throw new Error("Session key too long");
  }
  if (trimmed.includes("\0")) {
    throw new Error("Session key contains null byte");
  }
  if (trimmed.includes("..")) {
    throw new Error("Session key contains path traversal sequence");
  }
  if (trimmed.includes("/") || trimmed.includes("\\")) {
    throw new Error("Session key contains path separator");
  }
  if (!SESSION_KEY_SAFE_RE.test(trimmed)) {
    throw new Error("Session key contains invalid characters");
  }
  return trimmed;
}

export function getHeader(req: IncomingMessage, name: string): string | undefined {
  const raw = req.headers[name.toLowerCase()];
  if (typeof raw === "string") return raw;
  if (Array.isArray(raw)) return raw[0];
  return undefined;
}

export function getBearerToken(req: IncomingMessage): string | undefined {
  const raw = getHeader(req, "authorization")?.trim() ?? "";
  if (!raw.toLowerCase().startsWith("bearer ")) return undefined;
  const token = raw.slice(7).trim();
  return token || undefined;
}

export function resolveAgentIdFromHeader(req: IncomingMessage): string | undefined {
  const raw =
    getHeader(req, "x-zee-agent-id")?.trim() ||
    getHeader(req, "x-zee-agent")?.trim() ||
    getHeader(req, "x-zee-agent-id")?.trim() ||
    getHeader(req, "x-zee-agent")?.trim() ||
    getHeader(req, "x-zee-agent-id")?.trim() ||
    getHeader(req, "x-zee-agent")?.trim() ||
    "";
  if (!raw) return undefined;
  return normalizeAgentId(raw);
}

export function resolveAgentIdFromModel(model: string | undefined): string | undefined {
  const raw = model?.trim();
  if (!raw) return undefined;

  const m =
    raw.match(/^zee[:/](?<agentId>[a-z0-9][a-z0-9_-]{0,63})$/i) ??
    raw.match(/^zee[:/](?<agentId>[a-z0-9][a-z0-9_-]{0,63})$/i) ??
    raw.match(/^zee[:/](?<agentId>[a-z0-9][a-z0-9_-]{0,63})$/i) ??
    raw.match(/^agent:(?<agentId>[a-z0-9][a-z0-9_-]{0,63})$/i);
  const agentId = m?.groups?.agentId;
  if (!agentId) return undefined;
  return normalizeAgentId(agentId);
}

export function resolveAgentIdForRequest(params: {
  req: IncomingMessage;
  model: string | undefined;
}): string {
  const fromHeader = resolveAgentIdFromHeader(params.req);
  if (fromHeader) return fromHeader;

  const fromModel = resolveAgentIdFromModel(params.model);
  return fromModel ?? "main";
}

export function resolveSessionKey(params: {
  req: IncomingMessage;
  agentId: string;
  user?: string | undefined;
  prefix: string;
}): string {
  const rawExplicit =
    getHeader(params.req, "x-zee-session-key")?.trim() ||
    getHeader(params.req, "x-zee-session-key")?.trim() ||
    getHeader(params.req, "x-zee-session-key")?.trim();
  if (rawExplicit) return sanitizeSessionKey(rawExplicit);

  const user = params.user?.trim();
  const mainKey = user ? `${params.prefix}-user:${user}` : `${params.prefix}:${randomUUID()}`;
  return buildAgentMainSessionKey({ agentId: params.agentId, mainKey });
}
