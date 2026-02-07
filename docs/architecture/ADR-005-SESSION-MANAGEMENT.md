# ADR-005: Session Management Architecture

## Status

Accepted

Note: This document previously used ADR-001 numbering. ADR-001 is reserved for the Surface Abstraction Layer.

## Context

We need a session management system that:
1. Handles conversation state across CLI, API, and SDK surfaces
2. Supports real-time streaming of LLM responses
3. Manages tool execution with proper error handling
4. Provides persistence for session recovery
5. Enables multi-session workflows with isolation

The system must be designed to work with multiple LLM providers (Anthropic, OpenAI, etc.) and support features like reasoning content streaming, tool call streaming, and automatic retry logic.

## Decision

We will implement a modular session management architecture with the following components:

### 1. Types Module (`types.ts`)

Define all TypeScript types and Zod schemas for:
- Session identifiers (SessionId, MessageId, PartId)
- Session state (SessionInfo, SessionStatus, ActiveContext)
- Messages (UserMessage, AssistantMessage, MessageWithParts)
- Message parts (TextPart, ReasoningPart, ToolPart, etc.)
- Events (SessionEvent, StreamEvent)
- Errors (SessionError with typed error codes)
- Configuration (SessionConfig)

**Rationale**: Centralized type definitions ensure consistency and enable runtime validation via Zod schemas.

### 2. Session Interface (`session.ts`)

Define interfaces for:
- `ISession`: Core session operations (messages, parts, context)
- `ISessionManager`: Multi-session management
- `SessionFactory`: Session instance creation

Provide utilities for:
- ID generation (ascending/descending for ordering)
- Title generation and validation
- Usage calculation (tokens, cost)

**Rationale**: Interface-based design allows multiple implementations (e.g., memory-only for tests, persistent for production).

### 3. Message Processor (`processor.ts`)

Handle the message processing loop:
- Stream event processing
- Tool call orchestration
- Doom loop detection
- Error classification and retry coordination
- Step tracking with snapshots

**Rationale**: Separating the processing loop from session management allows reuse across different session types and simplifies testing.

### 4. Stream Handler (`stream.ts`)

Provide streaming capabilities:
- `StreamHandler`: Core async iterator implementation
- `TextStreamAggregator`: Accumulate text deltas
- `ReasoningStreamAggregator`: Track reasoning by ID
- `ToolCallStreamAggregator`: Manage tool call lifecycle

Features:
- Backpressure handling via configurable buffer
- Automatic reconnection for network failures
- Event-based and iterator-based consumption

**Rationale**: Dedicated streaming handler enables flexible consumption patterns and handles edge cases like backpressure and reconnection.

### 5. Persistence Layer (`persistence.ts`)

Implement storage abstraction:
- `IStorageBackend`: Generic storage operations
- `MemoryStorageBackend`: In-memory implementation
- `SessionPersistence`: Domain-specific operations

Features:
- Session save/restore
- Message and part persistence
- Cross-session context
- Export/import for session portability

**Rationale**: Backend abstraction allows switching between memory (tests), file (CLI), and database (API) storage without changing business logic.

### 6. Retry Logic (`retry.ts`)

Implement retry strategy:
- Error classification (retryable vs non-retryable)
- Exponential backoff with jitter
- Retry-After header support
- Configurable retry limits

Provide factory functions for specialized strategies:
- Rate limit handling
- Network error recovery

**Rationale**: Centralized retry logic ensures consistent error handling across all API calls and tool executions.

## Consequences

### Positive

1. **Modularity**: Each component has a single responsibility, making testing and maintenance easier.

2. **Flexibility**: Interface-based design allows different implementations for different use cases.

3. **Type Safety**: Zod schemas provide runtime validation alongside TypeScript static typing.

4. **Extensibility**: Event-driven architecture enables adding new features without modifying existing code.

5. **Testability**: Pure functions and injectable dependencies simplify unit testing.

### Negative

1. **Complexity**: More files and abstractions to understand and maintain.

2. **Performance Overhead**: Event emission and interface indirection add some overhead.

3. **Learning Curve**: Developers need to understand the component relationships.

### Risks

1. **Over-abstraction**: The interface-based approach might be overkill for simple use cases.

2. **Event Ordering**: Complex event flows might lead to race conditions if not carefully managed.

3. **Memory Leaks**: Long-running sessions need careful cleanup of event listeners and buffers.

## Implementation Notes

### Migration from upstream base

Key adaptations from the upstream base:
- Simplified namespace usage to standard exports
- Added Zod schemas for all types
- Made storage backend pluggable
- Added comprehensive streaming aggregators
- Standardized error classification

### Future Considerations

1. **File Storage Backend**: Implement `FileStorageBackend` for CLI persistence.
2. **Database Backend**: Implement database backend for API/cloud deployments.
3. **Session Compaction**: Add automatic summarization for long sessions.
4. **Cross-Session Context**: Implement context sharing between sessions.
5. **Session Sharing**: Add session export for collaboration features.

## References

- Vercel AI SDK streaming: https://sdk.vercel.ai/docs/ai-sdk-core/streaming
- Zod documentation: https://zod.dev/

## Implemented By (Evidence)

- Core session types/manager/processor: `packages/agent-core/src/session/`
- Session persistence/storage: `packages/agent-core/src/session/persistence.ts`, `packages/agent-core/src/storage/`
- Session tests: `packages/agent-core/test/session/`
