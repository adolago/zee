# Secure Patterns (zee)

This document captures secure-by-default patterns to use across `zee` when writing tools and infrastructure code.

## Process Execution

Do:

- Prefer `spawn(argv0, argv, { shell: false })` or `execFile` with an argv array.
- Treat any “raw shell command string” as untrusted input unless it is authored by the operator.
- If shell features are required, make it explicit by invoking a shell binary as argv (for example `["bash","-lc","..."]`) and ensure the call site is permission-gated.

Avoid:

- `spawn(cmd, { shell: true })`
- `exec(...)` / `execSync(...)` with interpolated strings

## Filesystem Paths

Do:

- Resolve relative paths against an explicit `cwd`.
- Enforce a sandbox `root` and reject any path that escapes it.
- Guard against symlink-based escapes (realpath checks).
- Block sensitive system and credential locations by default.

Implementation reference:

- `src/mcp/security/validate-path.ts`
- `src/mcp/security/sandbox.ts`

Avoid:

- Accepting arbitrary absolute paths without validation
- Lexical-only prefix checks (for example `candidate.startsWith(root)`)

## Glob / Include Patterns

Do:

- Reject patterns that contain `..` traversal segments or absolute path forms.
- Keep the search `cwd` within a sandboxed directory.

Implementation reference:

- `src/mcp/security/glob-pattern.ts`

## Archive Extraction

Do:

- Validate each archive entry path before writing:
  - reject absolute paths
  - reject `..` segments
- Reject symlink and hardlink entries from tar archives.
- Prefer validating the archive (list) before extraction to avoid partial writes.

Implementation reference:

- `packages/personas/zee/src/infra/archive.ts`

## Permission Enforcement

Do:

- Enforce permissions at the boundary where a tool is executed, not only at discovery time.
- On “ask”, route through a single interactive handler and persist the session decision only in-memory unless explicitly persisted by config.

Implementation reference:

- `src/mcp/registry.ts`
- `src/mcp/permission.ts`
