# Zee Security Architecture

This document describes the practical security architecture of `zee` as implemented in this repository. It is not a formal guarantee of isolation; `zee` is a privileged local tool by design.

## Summary

`zee` defends against common classes of agent-tool vulnerabilities with layered controls:

- **Permission gating**: per-surface defaults (`allow`/`deny`/`ask`) with an interactive “ask” flow when configured.
- **Tool sandboxing (selected tools)**: MCP filesystem tools validate paths against a sandbox root and block sensitive host locations.
- **Input hardening**: no `shell: true` process spawning in tool surfaces; archive extraction rejects path traversal and link entries.
- **Secret-handling hygiene**: crash-report capture is redacted; hosted secrets encryption uses a per-install vault key.

## Trust Boundaries

The highest-impact boundary is between untrusted inputs (remote clients, messaging surfaces, external MCP servers) and privileged host actions (process spawn, filesystem access, credential stores).

Primary surfaces:

- `cli`: local operator at the terminal.
- `web`/`api`: HTTP clients (may be loopback or LAN depending on configuration).
- `whatsapp`: inbound messages (treat as untrusted by default).

External components:

- MCP servers: third-party tool providers (outside the `zee` trust boundary).
- Zee gateway: a separate process that can forward messaging and tool requests.

## Permissions (MCP Layer)

The MCP tools layer implements a permission system that is enforced at tool execution time:

- Default per-surface permissions are defined in `src/mcp/permission.ts`.
- Tool execution is wrapped in `src/mcp/registry.ts` to:
  - deny when the effective permission is `deny`
  - call an interactive handler when the effective permission is `ask`

This is intended as a guardrail to reduce accidental high-risk actions, especially on messaging surfaces.

## Filesystem Sandbox (MCP Built-ins)

The MCP built-in filesystem tools (`read`, `write`, `edit`, `glob`, `grep`) enforce a sandbox:

- Paths are resolved relative to a sandbox `cwd`.
- Access is restricted to a sandbox `root`.
- Symlink-based sandbox escapes are prevented via realpath checks.
- Sensitive system/credential locations are blocked (for example `/proc`, `/sys`, `~/.ssh`, `~/.gnupg`).

Implementation:

- Path validation: `src/mcp/security/validate-path.ts`
- Sandbox resolution: `src/mcp/security/sandbox.ts`
- Glob/include pattern validation: `src/mcp/security/glob-pattern.ts`

## Process Execution Hardening

Command execution is a primary risk surface. To reduce injection primitives:

- Tool surfaces avoid `shell: true`.
- Commands are executed via argv (`spawn(argv0, argv, { shell: false })`).
- If shell behavior is required, it must be explicit (for example `["bash","-lc","..."]`).

Implementation:

- MCP bash tool: `src/mcp/builtin/bash.ts`
- Zee local shell runner: `packages/personas/zee/src/tui/tui-local-shell.ts`

## Archive Extraction Hardening

Archive extraction is a common source of “zip slip” / “tar slip” vulnerabilities.

The Zee archive extraction utilities reject:

- absolute paths
- `..` traversal segments
- tar symlinks and hardlinks

Implementation:

- `packages/personas/zee/src/infra/archive.ts`

## Hosted Vault Key (Per-Install Secret)

The hosted service encrypts provider connection material at rest. The vault key is:

- taken from `HOSTED_VAULT_KEY` when provided
- otherwise generated per-install and persisted to `HOSTED_DATA_DIR/vault.key`
- migrated away from the legacy hardcoded dev key when legacy encrypted rows are detected

Implementation:

- `packages/hosted/src/crypto.ts`

## Non-Goals

- `zee` is not an OS sandbox. A determined attacker with tool execution can often reach full user-level compromise.
- Strong isolation should be provided by running `zee` inside a container/VM and restricting network exposure.
