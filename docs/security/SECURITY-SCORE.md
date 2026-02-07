# Security Score Rubric (0-100)

This rubric defines the “security score” referenced by the v3 release checklist.

Each item is worth 10 points. A release target is >= 90/100.

## Checks (10 points each)

1. `docs/security/SECURITY-ARCHITECTURE.md` exists.
2. `docs/security/CVE-REMEDIATION-PLAN.md` exists.
3. `docs/security/SECURE-PATTERNS.md` exists.
4. `docs/security/THREAT-MODEL.md` exists.
5. `scripts/security-gate.sh` exists.
6. `bash scripts/bun-audit-ci.sh` passes.
7. `cd packages/agent-core && bun test test/security` passes.
8. Non-loopback bind guardrail exists (insecure flags require explicit opt-in).
9. Scope map marks high-risk routes as `operator.admin` (PTY/MCP/TUI).
10. Messaging RELEASE mode is blocked by default (requires explicit opt-in).

## Tooling

Run:

```bash
bun scripts/security-score.ts
```

The script prints a breakdown and exits non-zero if the score is below the configured threshold.

