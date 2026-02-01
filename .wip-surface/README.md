# OpenCode + Agent-Core Integration

This directory contains the comprehensive integration plan for connecting OpenCode with the agent-core backend.

## Documents Overview

| Document | Description | Status |
|----------|-------------|--------|
| `opencode-integration-plan.md` | High-level integration architecture and strategy | Draft |
| `opencode-adapter-spec.md` | Detailed technical specification for the adapter layer | Draft |
| `opencode-deployment-guide.md` | Deployment configurations and operations guide | Draft |

## Quick Summary

### Integration Architecture

```
OpenCode Client ──► OpenCode Adapter ──► Agent-Core Daemon ──► Qdrant Memory
                         │
                         └── Persona Router ──► Zee/Stanley/Johny
```

### Key Components

1. **API Adapter** (`packages/opencode-adapter/`)
   - Session bridge for message/session translation
   - Tool bridge for tool execution mapping
   - Config bridge for settings synchronization
   - Auth bridge for credential management

2. **State Synchronization**
   - Bidirectional sync between OpenCode and agent-core
   - Conflict resolution with configurable strategies
   - Event-driven updates via WebSocket/SSE

3. **Deployment Options**
   - Sidecar (local daemon)
   - Remote (cloud-hosted)
   - Hybrid (local with remote sync)

### Persona Mapping

| OpenCode Agent | Agent-Core Persona | Notes |
|----------------|-------------------|-------|
| `build` | `zee` | Default development persona |
| `plan` | `zee` (read-only) | Analysis mode via permissions |
| `general` | `zee` (subagent) | Complex task delegation |

### Tool Mapping

| OpenCode | Agent-Core | Status |
|----------|-----------|--------|
| BashTool | bash | Supported |
| EditTool | edit | Supported |
| GlobTool | glob | Supported |
| GrepTool | grep | Supported |
| ReadTool | read | Supported |
| WriteTool | write | Supported |
| LSP | lsp | Supported |
| Task | task | Supported |

## Implementation Timeline

- **Week 1-2**: API adapter scaffolding and session bridge
- **Week 3-4**: Tool bridge and auth integration
- **Week 5**: State sync manager and testing
- **Week 6-7**: Deployment scripts and documentation
- **Week 8**: User acceptance testing and bug fixes

## Next Steps

1. Create `packages/opencode-adapter/` package structure
2. Implement session bridge with test coverage
3. Set up CI/CD pipeline for the adapter
4. Create migration scripts for existing OpenCode users
5. Documentation and examples

## Resources

- Agent-Core SDK: `packages/agent-core/src/pkg/sdk/`
- Agent-Core Server: `packages/agent-core/src/server/`
- OpenCode GitHub: https://github.com/anomalyco/opencode
