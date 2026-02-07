import type { ContactConfig, ZeeConfig } from "../../config/types.js";
import type { ChannelDirectoryEntry } from "./types.js";
import { resolveWhatsAppAccount } from "../../web/accounts.js";
import { isWhatsAppGroupJid, normalizeWhatsAppTarget } from "../../whatsapp/normalize.js";

export type DirectoryConfigParams = {
  cfg: ZeeConfig;
  accountId?: string | null;
  query?: string | null;
  limit?: number | null;
};

function normalizeAliasList(contactId: string, aliases?: string[]): string[] {
  const raw = [contactId, ...(aliases ?? [])]
    .map((entry) => entry.trim())
    .filter(Boolean);
  return Array.from(new Set(raw));
}

function resolveContactChannelTarget(
  contact: ContactConfig,
  channel: "matrix" | "whatsapp",
): string | null {
  const channels = contact.channels ?? {};
  const direct = channels[channel];
  if (typeof direct === "string" || typeof direct === "number") {
    const trimmed = String(direct).trim();
    return trimmed ? trimmed : null;
  }
  if (channel === "whatsapp") {
    const phone = contact.phone?.trim();
    return phone || null;
  }
  return null;
}

function mergeDirectoryEntries(
  existing: ChannelDirectoryEntry,
  incoming: ChannelDirectoryEntry,
): ChannelDirectoryEntry {
  const aliases = [
    ...(existing.aliases ?? []),
    ...(incoming.aliases ?? []),
  ].map((entry) => entry.trim());
  const mergedAliases = Array.from(new Set(aliases.filter(Boolean)));
  return {
    ...existing,
    ...incoming,
    name: incoming.name ?? existing.name,
    handle: incoming.handle ?? existing.handle,
    aliases: mergedAliases.length ? mergedAliases : undefined,
    raw:
      existing.raw && incoming.raw && typeof existing.raw === "object" && typeof incoming.raw === "object"
        ? { ...(existing.raw as Record<string, unknown>), ...(incoming.raw as Record<string, unknown>) }
        : incoming.raw ?? existing.raw,
  };
}

function mergeDirectoryLists(
  entries: ChannelDirectoryEntry[],
  extras: ChannelDirectoryEntry[],
): ChannelDirectoryEntry[] {
  const merged = new Map<string, ChannelDirectoryEntry>();
  for (const entry of entries) {
    merged.set(entry.id, entry);
  }
  for (const entry of extras) {
    const existing = merged.get(entry.id);
    merged.set(entry.id, existing ? mergeDirectoryEntries(existing, entry) : entry);
  }
  return Array.from(merged.values());
}

function normalizeQuery(value: string): string {
  return value.trim().toLowerCase();
}

function stripTargetPrefixes(value: string): string {
  return value
    .replace(/^(channel|user):/i, "")
    .replace(/^[@#]/, "")
    .trim();
}

function entryMatchesQuery(entry: ChannelDirectoryEntry, query: string): boolean {
  const normalized = normalizeQuery(query);
  if (!normalized) return true;
  const candidates = [
    entry.id,
    entry.name,
    entry.handle,
    ...(entry.aliases ?? []),
  ]
    .map((value) => (value ? stripTargetPrefixes(value) : ""))
    .map((value) => normalizeQuery(value))
    .filter(Boolean);
  return candidates.some((value) => value === normalized || value.includes(normalized));
}

function applyQueryAndLimit(
  entries: ChannelDirectoryEntry[],
  query?: string | null,
  limit?: number | null,
): ChannelDirectoryEntry[] {
  const filtered = query ? entries.filter((entry) => entryMatchesQuery(entry, query)) : entries;
  if (limit && limit > 0) return filtered.slice(0, limit);
  return filtered;
}

function listContactDirectoryPeersFromConfig(params: {
  cfg: ZeeConfig;
  channel: "matrix" | "whatsapp";
  query?: string | null;
  limit?: number | null;
}): ChannelDirectoryEntry[] {
  const contacts = params.cfg.contacts ?? {};
  const entries: ChannelDirectoryEntry[] = [];
  for (const [contactId, contact] of Object.entries(contacts)) {
    if (!contact || typeof contact !== "object") continue;
    const name = typeof contact.name === "string" ? contact.name.trim() : "";
    const resolvedName = name || contactId.trim();
    const aliases = normalizeAliasList(contactId, contact.aliases);
    const target = resolveContactChannelTarget(contact, params.channel);
    if (!target) continue;
    if (params.channel === "whatsapp") {
      const normalized = normalizeWhatsAppTarget(target);
      if (!normalized || isWhatsAppGroupJid(normalized)) continue;
      entries.push({
        kind: "user",
        id: normalized,
        name: resolvedName,
        aliases: aliases.length ? aliases : undefined,
        raw: { contactId },
      });
      continue;
    }
    const trimmed = target.trim();
    if (!trimmed) continue;
    entries.push({
      kind: "user",
      id: trimmed,
      name: resolvedName,
      aliases: aliases.length ? aliases : undefined,
      raw: { contactId },
    });
  }
  return applyQueryAndLimit(entries, params.query, params.limit);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function readMatrixDirectoryIds(cfg: ZeeConfig): string[] {
  const channels = (cfg.channels as Record<string, unknown> | undefined) ?? {};
  const matrix = channels.matrix;
  if (!isRecord(matrix)) return [];

  const ids: string[] = [];
  const addRaw = (raw: unknown) => {
    if (typeof raw !== "string") return;
    const trimmed = raw.trim();
    if (!trimmed) return;
    if (trimmed === "*") return;
    const withoutMatrixPrefix = trimmed.replace(/^matrix:/i, "").trim();
    const withoutTargetPrefix = withoutMatrixPrefix.replace(/^(room|channel|user):/i, "").trim();
    if (!withoutTargetPrefix) return;
    if (withoutTargetPrefix === "*") return;
    ids.push(withoutTargetPrefix);
  };
  const addList = (list: unknown) => {
    if (!Array.isArray(list)) return;
    for (const entry of list) addRaw(entry);
  };

  // Legacy allowlist key (pre-2026-02 Matrix plugin sync).
  addList(matrix.allowFrom);

  const dm = isRecord(matrix.dm) ? matrix.dm : null;
  addList(dm?.allowFrom);
  addList(matrix.groupAllowFrom);

  const groups = isRecord(matrix.groups) ? matrix.groups : null;
  const rooms = isRecord(matrix.rooms) ? matrix.rooms : null;
  const groupConfigs: Record<string, unknown> = {};
  if (groups) Object.assign(groupConfigs, groups);
  if (rooms) Object.assign(groupConfigs, rooms);
  for (const [key, value] of Object.entries(groupConfigs)) {
    if (key === "*") continue;
    addRaw(key);
    if (!isRecord(value)) continue;
    addList(value.users);
  }

  return Array.from(new Set(ids.map((entry) => entry.trim()).filter(Boolean)));
}

export async function listMatrixDirectoryPeersFromConfig(
  params: DirectoryConfigParams,
): Promise<ChannelDirectoryEntry[]> {
  const baseEntries = Array.from(new Set(readMatrixDirectoryIds(params.cfg)))
    .filter((entry) => entry.startsWith("@"))
    .map((id) => ({ kind: "user", id }) as const);
  const contactEntries = listContactDirectoryPeersFromConfig({
    cfg: params.cfg,
    channel: "matrix",
    query: params.query,
    limit: params.limit,
  }).filter((entry) => entry.id.startsWith("@"));
  return applyQueryAndLimit(
    mergeDirectoryLists(baseEntries, contactEntries),
    params.query,
    params.limit,
  );
}

export async function listMatrixDirectoryGroupsFromConfig(
  params: DirectoryConfigParams,
): Promise<ChannelDirectoryEntry[]> {
  const baseEntries = Array.from(new Set(readMatrixDirectoryIds(params.cfg)))
    .filter((entry) => entry.startsWith("!") || entry.startsWith("#"))
    .map((id) => ({ kind: "group", id }) as const);
  const contactEntries = listContactDirectoryPeersFromConfig({
    cfg: params.cfg,
    channel: "matrix",
    query: params.query,
    limit: params.limit,
  }).filter((entry) => entry.id.startsWith("!") || entry.id.startsWith("#"));
  return applyQueryAndLimit(
    mergeDirectoryLists(baseEntries, contactEntries),
    params.query,
    params.limit,
  );
}

export async function listWhatsAppDirectoryPeersFromConfig(
  params: DirectoryConfigParams,
): Promise<ChannelDirectoryEntry[]> {
  const account = resolveWhatsAppAccount({ cfg: params.cfg, accountId: params.accountId });
  const baseEntries = (account.allowFrom ?? [])
    .map((entry) => String(entry).trim())
    .filter((entry) => Boolean(entry) && entry !== "*")
    .map((entry) => normalizeWhatsAppTarget(entry) ?? "")
    .filter(Boolean)
    .filter((id) => !isWhatsAppGroupJid(id))
    .map((id) => ({ kind: "user", id }) as const);
  const contactEntries = listContactDirectoryPeersFromConfig({
    cfg: params.cfg,
    channel: "whatsapp",
    query: params.query,
    limit: params.limit,
  });
  return applyQueryAndLimit(
    mergeDirectoryLists(baseEntries, contactEntries),
    params.query,
    params.limit,
  );
}

export async function listWhatsAppDirectoryGroupsFromConfig(
  params: DirectoryConfigParams,
): Promise<ChannelDirectoryEntry[]> {
  const account = resolveWhatsAppAccount({ cfg: params.cfg, accountId: params.accountId });
  const q = params.query?.trim().toLowerCase() || "";
  return Object.keys(account.groups ?? {})
    .map((id) => id.trim())
    .filter((id) => Boolean(id) && id !== "*")
    .filter((id) => (q ? id.toLowerCase().includes(q) : true))
    .slice(0, params.limit && params.limit > 0 ? params.limit : undefined)
    .map((id) => ({ kind: "group", id }) as const);
}
