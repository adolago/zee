export const AuthScope = {
  /** Full administrative access */
  ADMIN: "operator.admin",
  /** Read-only access (list sessions, view models, read config) */
  READ: "operator.read",
  /** Observability access (flux events, traces, diagnostics) */
  OBSERVE: "operator.observe",
  /** Write access (create sessions, send messages, modify config) */
  WRITE: "operator.write",
  /** Approve execution requests and permissions */
  APPROVALS: "operator.approvals",
  /** Device pairing and gateway pairing */
  PAIRING: "operator.pairing",
} as const

export type AuthScopeValue = (typeof AuthScope)[keyof typeof AuthScope]

export type ControlPlaneRouteScopeEntry = {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE"
  path: string
  scope: AuthScopeValue
  note: string
}

export type RequiredScopeResolution = {
  required: AuthScopeValue
  matchedEntry?: ControlPlaneRouteScopeEntry
  fallback: boolean
  controlPlane: boolean
}

function entry(
  method: ControlPlaneRouteScopeEntry["method"],
  path: string,
  scope: AuthScopeValue,
  note: string,
): ControlPlaneRouteScopeEntry {
  return { method, path, scope, note }
}

export const CONTROL_PLANE_SCOPE_MATRIX: ControlPlaneRouteScopeEntry[] = [
  // Observability and tracing
  entry("GET", "/event", AuthScope.OBSERVE, "Server event stream."),
  entry("GET", "/events", AuthScope.OBSERVE, "Global event stream."),
  entry("GET", "/global/event", AuthScope.OBSERVE, "Global event stream."),
  entry("GET", "/process", AuthScope.OBSERVE, "Process registry inventory."),
  entry("GET", "/process/{id}", AuthScope.OBSERVE, "Process registry detail."),
  entry("GET", "/process/consensus/history", AuthScope.OBSERVE, "Consensus history."),
  entry("GET", "/process/consensus/stats", AuthScope.OBSERVE, "Consensus metrics."),
  entry("GET", "/process/events", AuthScope.OBSERVE, "Process SSE stream."),
  entry("GET", "/process/stats", AuthScope.OBSERVE, "Process metrics."),
  entry("GET", "/process/swarm/{swarmId}", AuthScope.OBSERVE, "Swarm process inventory."),
  entry("GET", "/process/workstealing/stats", AuthScope.OBSERVE, "Work-stealing metrics."),
  entry("GET", "/session/{sessionID}/events", AuthScope.OBSERVE, "Session SSE stream."),
  entry("GET", "/usage/cost", AuthScope.OBSERVE, "Usage cost metrics."),
  entry("GET", "/usage/events", AuthScope.OBSERVE, "Usage event log."),
  entry("GET", "/usage/stats", AuthScope.OBSERVE, "Usage dashboard metrics."),
  entry("GET", "/usage/summary", AuthScope.OBSERVE, "Usage summary."),
  entry("GET", "/usage/summary/model/{id}", AuthScope.OBSERVE, "Model usage summary."),
  entry("GET", "/usage/summary/provider/{id}", AuthScope.OBSERVE, "Provider usage summary."),
  entry("GET", "/usage/summary/session/{id}", AuthScope.OBSERVE, "Session usage summary."),
  entry("GET", "/v1/flux/events", AuthScope.OBSERVE, "Flux event inspection."),
  entry("GET", "/v1/flux/schema", AuthScope.OBSERVE, "Flux schema inspection."),
  entry("GET", "/v1/flux/sessions/{sessionID}/path", AuthScope.OBSERVE, "Flux session path inspection."),
  entry("GET", "/v1/flux/trace/{traceID}", AuthScope.OBSERVE, "Flux trace inspection."),

  // Approval queue operations
  entry("GET", "/permission", AuthScope.APPROVALS, "Pending permission queue."),
  entry("POST", "/permission/{requestID}/reply", AuthScope.APPROVALS, "Permission approval response."),
  entry("GET", "/question", AuthScope.APPROVALS, "Pending question queue."),
  entry("POST", "/question/{requestID}/reject", AuthScope.APPROVALS, "Reject question."),
  entry("POST", "/question/{requestID}/reply", AuthScope.APPROVALS, "Reply to question."),
  entry(
    "POST",
    "/session/{sessionID}/permissions/{permissionID}",
    AuthScope.APPROVALS,
    "Respond to in-session permission prompt.",
  ),

  // Pairing and node lifecycle
  entry("GET", "/gateway/node", AuthScope.PAIRING, "Paired node inventory."),
  entry("POST", "/gateway/node/pair", AuthScope.PAIRING, "Pair new node client."),
  entry("POST", "/gateway/node/reconnect", AuthScope.PAIRING, "Reconnect paired node client."),
  entry("POST", "/gateway/node/rotate", AuthScope.PAIRING, "Rotate paired node credential."),
  entry("POST", "/gateway/node/revoke", AuthScope.PAIRING, "Revoke paired node."),
  entry("POST", "/gateway/node/tool/authorize", AuthScope.PAIRING, "Authorize paired node tool request."),

  // High-risk administrative surfaces
  entry("DELETE", "/auth/{providerID}", AuthScope.ADMIN, "Remove provider credentials."),
  entry("PUT", "/auth/{providerID}", AuthScope.ADMIN, "Set provider credentials."),
  entry("POST", "/global/dispose", AuthScope.ADMIN, "Dispose instance."),
  entry("POST", "/global/dispose-all", AuthScope.ADMIN, "Dispose all cached instances."),
  entry("POST", "/global/dispose-directory", AuthScope.ADMIN, "Dispose cached instance by directory."),
  entry("GET", "/global/instances", AuthScope.ADMIN, "Inspect cached instances."),
  entry("POST", "/instance/dispose", AuthScope.ADMIN, "Dispose named instance."),
  entry("DELETE", "/mcp/{name}/auth", AuthScope.ADMIN, "Remove MCP OAuth state."),
  entry("POST", "/mcp", AuthScope.ADMIN, "Register MCP server."),
  entry("POST", "/mcp/{name}/auth", AuthScope.ADMIN, "Start MCP OAuth."),
  entry("POST", "/mcp/{name}/auth/authenticate", AuthScope.ADMIN, "Authenticate MCP OAuth."),
  entry("POST", "/mcp/{name}/auth/callback", AuthScope.ADMIN, "Complete MCP OAuth."),
  entry("POST", "/mcp/{name}/connect", AuthScope.ADMIN, "Connect MCP server."),
  entry("POST", "/mcp/{name}/disconnect", AuthScope.ADMIN, "Disconnect MCP server."),
  entry("POST", "/mcp/{name}/reconnect", AuthScope.ADMIN, "Reconnect MCP server."),
  entry("POST", "/mcp/{name}/tool", AuthScope.ADMIN, "Execute MCP tool."),
  entry("POST", "/mcp/health-check", AuthScope.ADMIN, "Health check MCP servers."),
  entry("POST", "/mcp/reconnect-all", AuthScope.ADMIN, "Reconnect all MCP servers."),
  entry("POST", "/process/{id}/heartbeat", AuthScope.ADMIN, "Update process heartbeat."),
  entry("POST", "/process/consensus/propose", AuthScope.ADMIN, "Submit consensus proposal."),
  entry("POST", "/process/consensus/vote", AuthScope.ADMIN, "Cast consensus vote."),
  entry("POST", "/process/consensus/voter", AuthScope.ADMIN, "Register consensus voter."),
  entry("POST", "/process/find-available", AuthScope.ADMIN, "Schedule work onto available agents."),
  entry("POST", "/process/register", AuthScope.ADMIN, "Register process."),
  entry("POST", "/process/workstealing/find-best", AuthScope.ADMIN, "Find best worker for task."),
  entry("POST", "/process/workstealing/task-duration", AuthScope.ADMIN, "Record task duration."),
  entry("POST", "/process/workstealing/workload", AuthScope.ADMIN, "Update worker workload."),
  entry("DELETE", "/process/{id}", AuthScope.ADMIN, "Deregister process."),
  entry("PATCH", "/process/{id}", AuthScope.ADMIN, "Update process registry record."),
  entry("POST", "/provider/{providerID}/oauth/authorize", AuthScope.ADMIN, "Start provider OAuth."),
  entry("POST", "/provider/{providerID}/oauth/callback", AuthScope.ADMIN, "Complete provider OAuth."),
  entry("GET", "/pty", AuthScope.ADMIN, "Inspect PTY sessions."),
  entry("POST", "/pty", AuthScope.ADMIN, "Create PTY session."),
  entry("DELETE", "/pty/{ptyID}", AuthScope.ADMIN, "Destroy PTY session."),
  entry("GET", "/pty/{ptyID}", AuthScope.ADMIN, "Inspect PTY session."),
  entry("PUT", "/pty/{ptyID}", AuthScope.ADMIN, "Resize or update PTY session."),
  entry("POST", "/gateway/telegram/moderation/delete", AuthScope.ADMIN, "Moderate Telegram content."),
  entry("POST", "/gateway/whatsapp/inbound", AuthScope.ADMIN, "Receive privileged WhatsApp bridge payload."),
  entry("POST", "/session/{sessionID}/shell", AuthScope.ADMIN, "Run shell command inside session."),
  entry("POST", "/tui/append-prompt", AuthScope.ADMIN, "Drive TUI remotely."),
  entry("POST", "/tui/clear-prompt", AuthScope.ADMIN, "Drive TUI remotely."),
  entry("POST", "/tui/execute-command", AuthScope.ADMIN, "Drive TUI remotely."),
  entry("POST", "/tui/open-help", AuthScope.ADMIN, "Drive TUI remotely."),
  entry("POST", "/tui/open-models", AuthScope.ADMIN, "Drive TUI remotely."),
  entry("POST", "/tui/open-sessions", AuthScope.ADMIN, "Drive TUI remotely."),
  entry("POST", "/tui/open-themes", AuthScope.ADMIN, "Drive TUI remotely."),
  entry("POST", "/tui/publish", AuthScope.ADMIN, "Drive TUI remotely."),
  entry("POST", "/tui/select-session", AuthScope.ADMIN, "Drive TUI remotely."),
  entry("POST", "/tui/show-toast", AuthScope.ADMIN, "Drive TUI remotely."),
  entry("POST", "/tui/submit-prompt", AuthScope.ADMIN, "Drive TUI remotely."),
  entry("DELETE", "/usage/events", AuthScope.ADMIN, "Purge usage telemetry."),

  // Read-oriented operator surfaces
  entry("GET", "/", AuthScope.READ, "List tools."),
  entry("GET", "/agent", AuthScope.READ, "List agents."),
  entry("GET", "/command", AuthScope.READ, "List commands."),
  entry("GET", "/config", AuthScope.READ, "Read configuration."),
  entry("GET", "/config/providers", AuthScope.READ, "List config providers."),
  entry("GET", "/experimental/worktree", AuthScope.READ, "List worktrees."),
  entry("GET", "/file", AuthScope.READ, "List files."),
  entry("GET", "/file/content", AuthScope.READ, "Read file contents."),
  entry("GET", "/file/status", AuthScope.READ, "Read file status."),
  entry("GET", "/find", AuthScope.READ, "Search text."),
  entry("GET", "/find/file", AuthScope.READ, "Search files."),
  entry("GET", "/find/symbol", AuthScope.READ, "Search symbols."),
  entry("GET", "/formatter", AuthScope.READ, "Inspect formatter."),
  entry("GET", "/gateway/skills", AuthScope.READ, "Inspect gateway skills."),
  entry("POST", "/gateway/telegram/metadata/chat", AuthScope.READ, "Fetch Telegram metadata."),
  entry("GET", "/global/health", AuthScope.READ, "Read health."),
  entry("GET", "/global/health/live", AuthScope.READ, "Read liveness."),
  entry("GET", "/global/health/status", AuthScope.READ, "Read health status."),
  entry("GET", "/global/stats", AuthScope.READ, "Read server stats."),
  entry("GET", "/ids", AuthScope.READ, "List tool IDs."),
  entry("GET", "/lsp", AuthScope.READ, "Inspect LSP status."),
  entry("GET", "/mcp", AuthScope.READ, "Inspect MCP server status."),
  entry("GET", "/mcp/experimental/resource", AuthScope.READ, "Read MCP resources."),
  entry("GET", "/memory/{id}", AuthScope.READ, "Read memory."),
  entry("POST", "/memory/agentic-search", AuthScope.READ, "Search memories."),
  entry("GET", "/memory/curated", AuthScope.READ, "Read curated context."),
  entry("GET", "/memory/health", AuthScope.READ, "Read memory health."),
  entry("GET", "/memory/namespace/{namespace}", AuthScope.READ, "Read namespaced memories."),
  entry("POST", "/memory/search", AuthScope.READ, "Search memories."),
  entry("GET", "/memory/stats", AuthScope.READ, "Read memory stats."),
  entry("GET", "/memory/tree/domains", AuthScope.READ, "Read memory domains."),
  entry("GET", "/memory/tree/subtopics/{domain}/{topic}", AuthScope.READ, "Read memory subtopics."),
  entry("GET", "/memory/tree/topics/{domain}", AuthScope.READ, "Read memory topics."),
  entry("GET", "/memory/version/{memoryId}", AuthScope.READ, "Read memory version history."),
  entry("GET", "/openbb/agents.json", AuthScope.READ, "Read OpenBB Workspace agent descriptor."),
  entry("GET", "/openapi", AuthScope.READ, "Read OpenAPI spec."),
  entry("GET", "/path", AuthScope.READ, "Read path info."),
  entry("GET", "/preferences/theme", AuthScope.READ, "Read theme preference."),
  entry("GET", "/project", AuthScope.READ, "List projects."),
  entry("GET", "/project/current", AuthScope.READ, "Read current project."),
  entry("GET", "/provider", AuthScope.READ, "List providers."),
  entry("GET", "/provider/auth", AuthScope.READ, "Read provider auth modes."),
  entry("GET", "/provider/auth/status", AuthScope.READ, "Read provider auth status."),
  entry("GET", "/session", AuthScope.READ, "List sessions."),
  entry("GET", "/session/{sessionID}", AuthScope.READ, "Read session."),
  entry("GET", "/session/{sessionID}/children", AuthScope.READ, "Read session children."),
  entry("GET", "/session/{sessionID}/diff", AuthScope.READ, "Read session diff."),
  entry("GET", "/session/{sessionID}/diff/all", AuthScope.READ, "Read full session diff."),
  entry("GET", "/session/{sessionID}/message", AuthScope.READ, "Read session messages."),
  entry("GET", "/session/{sessionID}/message/{messageID}", AuthScope.READ, "Read message."),
  entry("GET", "/session/{sessionID}/todo", AuthScope.READ, "Read session todos."),
  entry("GET", "/session/status", AuthScope.READ, "Read session status."),
  entry("GET", "/sync", AuthScope.READ, "Read sync delta."),
  entry("GET", "/themes", AuthScope.READ, "List themes."),
  entry("GET", "/v1/memory/{id}", AuthScope.READ, "Read memory (v1)."),
  entry("POST", "/v1/memory/agentic-search", AuthScope.READ, "Search memories (v1)."),
  entry("GET", "/v1/memory/curated", AuthScope.READ, "Read curated context (v1)."),
  entry("GET", "/v1/memory/health", AuthScope.READ, "Read memory health (v1)."),
  entry("GET", "/v1/memory/namespace/{namespace}", AuthScope.READ, "Read namespaced memories (v1)."),
  entry("POST", "/v1/memory/search", AuthScope.READ, "Search memories (v1)."),
  entry("GET", "/v1/memory/stats", AuthScope.READ, "Read memory stats (v1)."),
  entry("GET", "/v1/memory/tree/domains", AuthScope.READ, "Read memory domains (v1)."),
  entry("GET", "/v1/memory/tree/subtopics/{domain}/{topic}", AuthScope.READ, "Read memory subtopics (v1)."),
  entry("GET", "/v1/memory/tree/topics/{domain}", AuthScope.READ, "Read memory topics (v1)."),
  entry("GET", "/v1/memory/version/{memoryId}", AuthScope.READ, "Read memory version history (v1)."),
  entry("GET", "/v1/registry/palette", AuthScope.READ, "Read registry palette."),
  entry("GET", "/v1/registry/providers", AuthScope.READ, "Read registry providers."),
  entry("GET", "/v1/registry/skills/frontmatter", AuthScope.READ, "Read skill frontmatter registry."),
  entry("GET", "/v1/skills/index", AuthScope.READ, "Read skills index."),
  entry("POST", "/v1/skills/recommend", AuthScope.READ, "Recommend skills."),
  entry("GET", "/vcs", AuthScope.READ, "Read VCS info."),
  entry("GET", "/gateway/channels/status", AuthScope.OBSERVE, "Inspect gateway channel health."),
  entry("GET", "/gateway/status", AuthScope.OBSERVE, "Inspect gateway health."),
  entry("GET", "/gateway/usage", AuthScope.OBSERVE, "Inspect gateway usage metrics."),

  // Mutation and workflow surfaces
  entry("PATCH", "/config", AuthScope.WRITE, "Update configuration."),
  entry("GET", "/cron/jobs", AuthScope.READ, "Read cron jobs."),
  entry("GET", "/cron/status", AuthScope.READ, "Read cron scheduler status."),
  entry("POST", "/cron/jobs", AuthScope.WRITE, "Create cron job."),
  entry("PATCH", "/cron/jobs/{id}", AuthScope.WRITE, "Update cron job."),
  entry("DELETE", "/cron/jobs/{id}", AuthScope.WRITE, "Delete cron job."),
  entry("POST", "/cron/jobs/{id}/run", AuthScope.WRITE, "Run cron job."),
  entry("POST", "/cron/wake", AuthScope.WRITE, "Wake cron scheduler."),
  entry("POST", "/experimental/worktree", AuthScope.WRITE, "Create worktree."),
  entry("POST", "/gateway/telegram/send", AuthScope.WRITE, "Send Telegram message."),
  entry("POST", "/gateway/whatsapp/send", AuthScope.WRITE, "Send WhatsApp message."),
  entry("POST", "/heartbeat/run", AuthScope.WRITE, "Run heartbeat now."),
  entry("POST", "/heartbeat/wake", AuthScope.WRITE, "Wake heartbeat runner."),
  entry("POST", "/log", AuthScope.WRITE, "Write operator log."),
  entry("DELETE", "/memory/{id}", AuthScope.WRITE, "Delete memory."),
  entry("POST", "/memory/batch", AuthScope.WRITE, "Batch store memories."),
  entry("POST", "/memory/cleanup", AuthScope.WRITE, "Cleanup expired memories."),
  entry("POST", "/memory/delete-where", AuthScope.WRITE, "Delete memories by filter."),
  entry("POST", "/memory/reset", AuthScope.WRITE, "Reset memory service."),
  entry("POST", "/memory/store", AuthScope.WRITE, "Store memory."),
  entry("POST", "/openbb/query", AuthScope.WRITE, "Run OpenBB Workspace copilot query."),
  entry("POST", "/memory/version/{memoryId}/rollback", AuthScope.WRITE, "Rollback memory version."),
  entry("PATCH", "/preferences/theme", AuthScope.WRITE, "Update theme preference."),
  entry("PATCH", "/project/{projectID}", AuthScope.WRITE, "Update project."),
  entry("POST", "/session", AuthScope.WRITE, "Create session."),
  entry("DELETE", "/session/{sessionID}", AuthScope.WRITE, "Delete session."),
  entry("PATCH", "/session/{sessionID}", AuthScope.WRITE, "Update session."),
  entry("POST", "/session/{sessionID}/abort", AuthScope.WRITE, "Abort session."),
  entry("POST", "/session/{sessionID}/command", AuthScope.WRITE, "Send session command."),
  entry("POST", "/session/{sessionID}/fork", AuthScope.WRITE, "Fork session."),
  entry("POST", "/session/{sessionID}/handoff", AuthScope.WRITE, "Hand off session."),
  entry("POST", "/session/{sessionID}/init", AuthScope.WRITE, "Initialize session."),
  entry("POST", "/session/{sessionID}/message", AuthScope.WRITE, "Send message."),
  entry("DELETE", "/session/{sessionID}/message/{messageID}/part/{partID}", AuthScope.WRITE, "Delete message part."),
  entry("PATCH", "/session/{sessionID}/message/{messageID}/part/{partID}", AuthScope.WRITE, "Update message part."),
  entry("PATCH", "/session/{sessionID}/mode", AuthScope.WRITE, "Update session mode."),
  entry("POST", "/session/{sessionID}/note", AuthScope.WRITE, "Append session note."),
  entry("POST", "/session/{sessionID}/prompt_async", AuthScope.WRITE, "Send async prompt."),
  entry("POST", "/session/{sessionID}/revert", AuthScope.WRITE, "Revert session."),
  entry("DELETE", "/session/{sessionID}/share", AuthScope.WRITE, "Unshare session."),
  entry("POST", "/session/{sessionID}/share", AuthScope.WRITE, "Share session."),
  entry("POST", "/session/{sessionID}/steer", AuthScope.WRITE, "Steer session."),
  entry("POST", "/session/{sessionID}/summarize", AuthScope.WRITE, "Summarize session."),
  entry("POST", "/session/{sessionID}/unrevert", AuthScope.WRITE, "Restore reverted content."),
  entry("POST", "/stt/wisprflow", AuthScope.WRITE, "Run speech-to-text."),
  entry("POST", "/v1/llm/stream", AuthScope.WRITE, "Run legacy LLM bridge."),
  entry("DELETE", "/v1/memory/{id}", AuthScope.WRITE, "Delete memory (v1)."),
  entry("POST", "/v1/memory/batch", AuthScope.WRITE, "Batch store memories (v1)."),
  entry("POST", "/v1/memory/cleanup", AuthScope.WRITE, "Cleanup expired memories (v1)."),
  entry("POST", "/v1/memory/delete-where", AuthScope.WRITE, "Delete memories by filter (v1)."),
  entry("POST", "/v1/memory/reset", AuthScope.WRITE, "Reset memory service (v1)."),
  entry("POST", "/v1/memory/store", AuthScope.WRITE, "Store memory (v1)."),
  entry(
    "POST",
    "/v1/memory/version/{memoryId}/rollback",
    AuthScope.WRITE,
    "Rollback memory version (v1).",
  ),
] as const

export const CONTROL_PLANE_PUBLIC_EXCEPTIONS = [
  "OPTIONS * (CORS preflight bypasses auth middleware)",
] as const

const CONTROL_PLANE_FAMILIES = [
  "/agent",
  "/auth",
  "/command",
  "/config",
  "/cron",
  "/event",
  "/events",
  "/experimental",
  "/file",
  "/find",
  "/formatter",
  "/gateway",
  "/global",
  "/heartbeat",
  "/ids",
  "/instance",
  "/log",
  "/lsp",
  "/mcp",
  "/memory",
  "/openbb",
  "/openapi",
  "/path",
  "/permission",
  "/preferences",
  "/process",
  "/project",
  "/provider",
  "/pty",
  "/question",
  "/session",
  "/stt",
  "/sync",
  "/themes",
  "/tui",
  "/usage",
  "/v1",
  "/vcs",
] as const

function buildPatternRegex(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&")
  const withParams = escaped.replace(/\\\{[^/]+\\\}/g, "[^/]+")
  return new RegExp(`^${withParams}$`)
}

function pathMatchesEntry(path: string, entry: ControlPlaneRouteScopeEntry): boolean {
  return buildPatternRegex(entry.path).test(path)
}

function resolveCandidateMethods(method: string): string[] {
  const upperMethod = method.toUpperCase()
  return upperMethod === "HEAD" ? ["GET", "HEAD"] : [upperMethod]
}

function isControlPlaneFamily(path: string): boolean {
  if (path === "/") return true
  return CONTROL_PLANE_FAMILIES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`))
}

export function resolveRequiredScopeInfo(method: string, path: string): RequiredScopeResolution {
  const candidateMethods = resolveCandidateMethods(method)
  const matchedEntry = CONTROL_PLANE_SCOPE_MATRIX.find(
    (entry) => candidateMethods.includes(entry.method) && pathMatchesEntry(path, entry),
  )

  if (matchedEntry) {
    return {
      required: matchedEntry.scope,
      matchedEntry,
      fallback: false,
      controlPlane: true,
    }
  }

  const controlPlane = isControlPlaneFamily(path)
  return {
    required: AuthScope.ADMIN,
    fallback: true,
    controlPlane,
  }
}

export function resolveRequiredScope(method: string, path: string): AuthScopeValue {
  return resolveRequiredScopeInfo(method, path).required
}
