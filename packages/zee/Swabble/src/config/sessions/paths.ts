import path from "node:path";

export type ResolveSessionFilePathOptionsInput = {
  storePath?: string;
  agentId?: string;
};

export type ResolveSessionFilePathOptions = {
  sessionsDir?: string;
  agentId?: string;
};

function normalizeAgentId(agentId: string | undefined): string {
  const trimmed = typeof agentId === "string" ? agentId.trim() : "";
  return trimmed.length > 0 ? trimmed.toLowerCase() : "main";
}

export function resolveSessionFilePathOptions(
  input: ResolveSessionFilePathOptionsInput,
): ResolveSessionFilePathOptions {
  const storePath = typeof input.storePath === "string" ? input.storePath.trim() : "";
  if (storePath.length > 0 && storePath !== "(multiple)") {
    return { sessionsDir: path.resolve(path.dirname(storePath)) };
  }

  if (typeof input.agentId === "string" && input.agentId.trim().length > 0) {
    return { agentId: normalizeAgentId(input.agentId) };
  }

  return {};
}

export function resolveSessionTranscriptPath(sessionId: string, agentId: string): string {
  const safeAgentId = normalizeAgentId(agentId);
  return path.resolve(path.join("agents", safeAgentId, "sessions", `${sessionId}.jsonl`));
}

export function resolveSessionFilePath(
  sessionId: string,
  agentId?: string,
  options: ResolveSessionFilePathOptions = {},
): string {
  if (typeof options.sessionsDir === "string" && options.sessionsDir.trim().length > 0) {
    return path.resolve(path.join(options.sessionsDir, `${sessionId}.jsonl`));
  }

  return resolveSessionTranscriptPath(sessionId, options.agentId ?? agentId ?? "main");
}
