# Security

## Threat Model

### Overview

Zee is an AI-powered coding assistant that runs locally on your machine. It provides an agent system with access to powerful tools including shell execution, file operations, and web access.

### No OS Sandbox

`zee` does **not** provide OS-level isolation for the agent. Some tool surfaces enforce sandboxing and input hardening (for example, MCP filesystem tools validate paths against a sandbox root), but these are defense-in-depth controls rather than a complete security boundary.

If you need strong isolation, run `zee` inside a Docker container or VM.

### Server Mode

Server mode can be run on loopback without authentication for personal/local use. If you bind the daemon to a non-loopback interface (for example `--hostname 0.0.0.0` or enabling mDNS), Zee refuses to start unless HTTP auth is enabled and configured.

To enable HTTP Basic Auth:
- Set `ZEE_ENABLE_SERVER_AUTH=1`
- Set `ZEE_SERVER_PASSWORD` (optionally `ZEE_SERVER_USERNAME`)
- Optionally set `ZEE_SERVER_SCOPES` (comma-separated, defaults to admin)

To explicitly run insecurely without auth (not recommended):
- Set `ZEE_DISABLE_SERVER_AUTH=1`
- Set `ZEE_ALLOW_INSECURE_SERVER_NO_AUTH=1`

Server resource limits (to reduce DoS blast radius):
- `ZEE_SERVER_IDLE_TIMEOUT_SECONDS` (default: 120)
- `ZEE_SERVER_MAX_SSE_CONNECTIONS` (default: 64)
- `ZEE_SERVER_MAX_SSE_CONNECTIONS_PER_CLIENT` (default: 8)
- `ZEE_SERVER_MAX_INSTANCES` (default: 64 for non-loopback binds)

### Hold/Release Mode

Zee defaults sessions to HOLD mode (safe-by-default). Switching a session into RELEASE mode removes permission prompts and enables full tool access.

For safety, `/release` is refused on messaging surfaces (WhatsApp) unless you explicitly opt in:
- Set `ZEE_ALLOW_MESSAGING_RELEASE=1`

When HTTP auth is enabled, switching to RELEASE mode requires `operator.admin` scope.

### Zee Gateway Token File

When using Zee gateway WebSocket RPC, `zee` can authenticate with:
- `ZEE_GATEWAY_TOKEN` (environment variable)
- `ZEE_GATEWAY_TOKEN_FILE` (path to a token file)
- Default token file at `~/.local/state/zee/zee_gateway_token`

For safety, Zee ignores token files that are symlinks, not owned by the current user, or not `0600` (POSIX).

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
