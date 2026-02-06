# Security

## Threat Model

### Overview

Agent-Core is an AI-powered coding assistant that runs locally on your machine. It provides an agent system with access to powerful tools including shell execution, file operations, and web access.

### No Sandbox

Agent-Core does **not** sandbox the agent. The permission system exists as a UX feature to help users stay aware of what actions the agent is taking - it prompts for confirmation before executing commands, writing files, etc. However, it is not designed to provide security isolation.

If you need true isolation, run Agent-Core inside a Docker container or VM.

### Server Mode

Server mode can be run on loopback without authentication for personal/local use. If you bind the daemon to a non-loopback interface (for example `--hostname 0.0.0.0` or enabling mDNS), `agent-core` refuses to start unless HTTP auth is enabled and configured.

To enable HTTP Basic Auth:
- Set `AGENT_CORE_ENABLE_SERVER_AUTH=1`
- Set `AGENT_CORE_SERVER_PASSWORD` (optionally `AGENT_CORE_SERVER_USERNAME`)
- Optionally set `AGENT_CORE_SERVER_SCOPES` (comma-separated, defaults to admin)

To explicitly run insecurely without auth (not recommended):
- Set `AGENT_CORE_DISABLE_SERVER_AUTH=1`
- Set `AGENT_CORE_ALLOW_INSECURE_SERVER_NO_AUTH=1`

Server resource limits (to reduce DoS blast radius):
- `AGENT_CORE_SERVER_IDLE_TIMEOUT_SECONDS` (default: 120)
- `AGENT_CORE_SERVER_MAX_SSE_CONNECTIONS` (default: 64)
- `AGENT_CORE_SERVER_MAX_SSE_CONNECTIONS_PER_CLIENT` (default: 8)
- `AGENT_CORE_SERVER_MAX_INSTANCES` (default: 64 for non-loopback binds)

### Hold/Release Mode

Agent-Core defaults sessions to HOLD mode (safe-by-default). Switching a session into RELEASE mode removes permission prompts and enables full tool access.

For safety, `/release` is refused on messaging surfaces (WhatsApp/Matrix) unless you explicitly opt in:
- Set `AGENT_CORE_ALLOW_MESSAGING_RELEASE=1`

When HTTP auth is enabled, switching to RELEASE mode requires `operator.admin` scope.

### Zee Gateway Token File

When using Zee gateway WebSocket RPC, `agent-core` can authenticate with:
- `ZEE_GATEWAY_TOKEN` (environment variable)
- `ZEE_GATEWAY_TOKEN_FILE` (path to a token file)
- Default token file at `~/.local/state/agent-core/zee_gateway_token`

For safety, `agent-core` ignores token files that are symlinks, not owned by the current user, or not `0600` (POSIX).

### Out of Scope

| Category                        | Rationale                                                               |
| ------------------------------- | ----------------------------------------------------------------------- |
| **Server access when opted-in** | If you enable server mode, API access is expected behavior              |
| **Sandbox escapes**             | The permission system is not a sandbox (see above)                      |
| **LLM provider data handling**  | Data sent to your configured LLM provider is governed by their policies |
| **MCP server behavior**         | External MCP servers you configure are outside our trust boundary       |

---

# Reporting Security Issues

We appreciate your efforts to responsibly disclose your findings.

Please contact the maintainers directly with a private report. Avoid sharing sensitive details in public issues.
