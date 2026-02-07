# ACP (Agent Client Protocol) Support

This directory contains agent-core's agent-side implementation of the
[Agent Client Protocol (ACP)](https://agentclientprotocol.com/). It is used by
the `agent-core acp` CLI command to expose an ACP agent over stdio.

## Components

- **`agent.ts`** - ACP agent implementation
  - Initialization and capability negotiation
  - Session operations (new/load/list/fork/resume)
  - Prompt translation to agent-core session prompts
  - Event subscription to stream updates back to the ACP client
- **`session.ts`** - In-memory ACP session state
  - Maps ACP session ids to agent-core sessions
  - Stores per-session working directory, selected model/variant, and mode
- **`types.ts`** - Internal types

The stdio JSON-RPC wiring and local server startup is implemented in
`src/cli/cmd/acp.ts`.

## Usage

### Command Line

```bash
# Start the ACP server in the current directory
agent-core acp

# Start in a specific directory
agent-core acp --cwd /path/to/project
```

### Programmatic

```typescript
import { ACPServer } from "./acp/server"

await ACPServer.start()
```

### Integration with Zed

Add to your Zed configuration (`~/.config/zed/settings.json`):

```json
{
  "agent_servers": {
    "Agent-Core": {
      "command": "agent-core",
      "args": ["acp"]
    }
  }
}
```

## Protocol Compliance

This implementation follows the ACP specification v1:

✅ **Initialization**

- Proper `initialize` request/response with protocol version negotiation
- Capability advertisement (`agentCapabilities`)
- Auth method hint (auth itself is not implemented via ACP)

✅ **Session Management**

- `session/new` - Create new conversation sessions
- `session/load` - Load an existing session and replay history to the client
- `session/list` - List sessions (SDK method name: `unstable_listSessions`)
- `session/fork` - Fork a session (SDK method name: `unstable_forkSession`)
- `session/resume` - Resume a session (SDK method name: `unstable_resumeSession`)
- Working directory context (`cwd`)
- MCP server configuration support
- Mode switching (`setSessionMode`)
- Model switching (`unstable_setSessionModel`)

✅ **Prompting**

- `session/prompt` - Process user messages
- Content block handling (text, image, resource, resource_link)
- Streaming updates via `session/update` notifications driven by agent-core events

## Model Variants

Model variants are encoded directly in ACP model ids as:

`providerID/modelID#variant`

For example: `openai/gpt-5#thinking`.

## Audience Mapping

For ACP text blocks, the agent maps `annotations.audience` to agent-core message
flags, and reverses the mapping when replaying history/events back to the ACP
client:

- `["assistant"]` -> `synthetic`
- `["user"]` -> `ignored`

## Tool Availability

When running ACP, the CLI sets `AGENT_CORE_CLIENT=acp`. This excludes the
`question` tool from the tool registry so ACP clients are not prompted via the
interactive question tool.

## Current Limitations

### Not Yet Implemented

1. **Authentication** - ACP `authenticate` is not implemented. Use `agent-core auth login`.
2. **Terminal Support** - ACP terminal capability is not implemented beyond what the client provides.

### Future Enhancements

- **Authentication**: Support ACP `authenticate` flows directly.
- **Terminal Integration**: Surface a richer terminal API when the ACP ecosystem supports it.

## Testing

```bash
# Run ACP tests
cd packages/agent-core
bun test test/acp

# Test manually with stdio
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":1}}' | agent-core acp
```

## Design Decisions

### Why the Official Library?

We use `@agentclientprotocol/sdk` instead of implementing JSON-RPC ourselves because:

- Ensures protocol compliance
- Handles edge cases and future protocol versions
- Reduces maintenance burden
- Works with other ACP clients automatically

### Clean Architecture

Each component has a single responsibility:

- **Agent** = Protocol interface
- **Client** = Client-side operations
- **Session** = State management
- **Server** = Lifecycle and I/O

This makes the codebase maintainable and testable.

### Mapping to Agent-Core

ACP sessions map cleanly to agent-core's internal session model:

- ACP `session/new` → creates internal Session
- ACP `session/prompt` → uses SessionPrompt.prompt()
- Working directory context preserved per-session
- Tool execution uses existing ToolRegistry

## References

- [ACP Specification](https://agentclientprotocol.com/)
- [TypeScript Library](https://github.com/agentclientprotocol/typescript-sdk)
- [Protocol Examples](https://github.com/agentclientprotocol/typescript-sdk/tree/main/src/examples)
