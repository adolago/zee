# ADR-001: Surface Abstraction Layer

## Status
ACCEPTED (Design Phase)

## Context

The agent-core needs to support multiple UI surfaces:
1. **CLI/TUI** (agent-core native) - Terminal-based interaction
2. **GUI** (Stanley) - GPUI-based desktop application
3. **Messaging** (Zee) - WhatsApp and Matrix platforms

Each surface has different capabilities:
- CLI supports streaming and interactive prompts
- GUI supports rich visuals and WebSocket streaming
- Messaging requires batched messages and cannot prompt users

Without abstraction, the agent core would need platform-specific code throughout, leading to duplication and maintenance burden.

### Requirements

1. Unified interface for sending/receiving messages
2. Capability-based adaptation (streaming vs batching)
3. Surface-specific permission handling
4. Tool call notifications and results
5. Configurable per-surface behavior
6. Extensible for new platforms

## Decision

Design a Surface Abstraction Layer with the following components:

### Architecture

```
                    +-----------------+
                    |   Agent Core    |
                    +--------+--------+
                             |
                    +--------v--------+
                    | Surface Router  |
                    +--------+--------+
                             |
        +--------------------+--------------------+
        |                    |                    |
 +------v------+      +------v------+      +------v------+
 | CLI Surface |      | GUI Surface |      | Msg Surface |
 +-------------+      +-------------+      +-------------+
        |                    |                    |
    Terminal           WebSocket           Platform APIs
                                           (WhatsApp/Matrix)
```

### Core Interface

```typescript
interface Surface {
  readonly id: string;
  readonly name: string;
  readonly capabilities: SurfaceCapabilities;
  readonly state: SurfaceState;

  connect(): Promise<void>;
  disconnect(): Promise<void>;

  sendResponse(response: SurfaceResponse, threadId?: string): Promise<void>;
  sendStreamChunk(chunk: StreamChunk, threadId?: string): Promise<void>;
  sendTypingIndicator(threadId?: string): Promise<void>;

  requestPermission(request: PermissionRequest): Promise<PermissionResponse>;
  notifyToolStart(toolCall: ToolCall): Promise<void>;
  notifyToolEnd(result: ToolResult): Promise<void>;

  onEvent(handler: (event: SurfaceEvent) => void): () => void;
}
```

### Capabilities Model

```typescript
type SurfaceCapabilities = {
  streaming: boolean;           // Can receive partial responses
  interactivePrompts: boolean;  // Can prompt user for permissions
  richText: boolean;            // Supports markdown/formatting
  media: boolean;               // Can display media
  threading: boolean;           // Supports conversation threads
  typingIndicators: boolean;    // Can show typing status
  reactions: boolean;           // Supports message reactions
  messageEditing: boolean;      // Can edit sent messages
  maxMessageLength: number;     // 0 = unlimited
  supportedMediaTypes: string[];
};
```

### Permission Model

Three tiers of permission handling:

1. **Interactive (CLI/GUI)**: Show prompt, wait for user response
2. **Automatic (Messaging)**: Apply config-based default action
3. **Remembered**: Apply previously saved user preference

```typescript
type PermissionAction = 'allow' | 'deny' | 'allow_session' | 'deny_session';
```

### Configuration Hierarchy

```
Global Config
    |
    +-- Surface Type Config (cli, gui, messaging)
    |       |
    |       +-- Platform Config (whatsapp, matrix)
    |               |
    |               +-- Instance Config
```

## File Structure

```
src/surface/
  types.ts      - Core type definitions
  surface.ts    - Surface interface and BaseSurface
  config.ts     - Configuration types and defaults
  cli.ts        - CLI/TUI adapter
  gui.ts        - GUI WebSocket adapter
  messaging.ts  - Messaging platforms adapter
  index.ts      - Module exports
```

## Key Design Decisions

### 1. Capability-Based Adaptation

**Decision**: Agent adapts behavior based on declared surface capabilities.

**Rationale**: Different surfaces have fundamentally different constraints. Declarative capabilities allow the agent to:
- Stream to CLI/GUI, batch to messaging
- Show tool details to CLI, hide from messaging
- Request permission interactively where possible

### 2. Platform Handler Interface

**Decision**: Messaging surface uses pluggable platform handlers.

**Rationale**: Each messaging platform (WhatsApp, Matrix) has unique SDKs and APIs. The handler interface abstracts these differences while allowing platform-specific implementation.

```typescript
interface MessagingPlatformHandler {
  readonly platform: 'whatsapp' | 'matrix';
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  sendMessage(target, text, options?): Promise<void>;
  sendTyping(target): Promise<void>;
  onMessage(handler): () => void;
}
```

### 3. Message Batching for Non-Streaming Surfaces

**Decision**: Non-streaming surfaces buffer stream chunks and send complete messages.

**Rationale**: Messaging platforms don't support streaming responses. The MessageBatcher accumulates chunks and sends the complete response when `isFinal=true`.

### 4. Automatic Permission Resolution

**Decision**: Messaging surfaces automatically apply configured permissions without prompting.

**Rationale**: Cannot interrupt a WhatsApp/Matrix conversation to ask "Allow file write?". Configuration determines what's allowed for each surface.

### 5. Surface Context

**Decision**: Each message includes SurfaceContext with surface metadata.

**Rationale**: Agent may adjust response format, length, or content based on surface. Context provides sender info, thread context, and capabilities.

## Consequences

### Positive

1. **Unified agent core**: No surface-specific logic in core
2. **Extensible**: Easy to add new surfaces
3. **Testable**: Mock surfaces for testing
4. **Flexible permissions**: Per-surface security policies
5. **Consistent UX**: Common patterns across surfaces

### Negative

1. **Abstraction overhead**: Additional layer between agent and UI
2. **Capability gaps**: Some surfaces may not support all features
3. **Configuration complexity**: Multiple config levels

### Risks

1. **Capability divergence**: Surfaces evolve at different rates
2. **Permission confusion**: Different behavior across surfaces
3. **Latency**: Batching adds delay for messaging surfaces

## Mitigations

### Risk 1: Capability Divergence
- Version capabilities independently
- Graceful degradation for missing features
- Clear capability documentation

### Risk 2: Permission Confusion
- Explicit permission config per surface
- Logging of permission decisions
- Admin override capabilities

### Risk 3: Latency
- Configurable chunk delay
- Typing indicators during batching
- Timeout handling

## Implementation Plan

### Phase 1: Foundation (Complete)
- [x] Type definitions (types.ts)
- [x] Surface interface (surface.ts)
- [x] Configuration (config.ts)

### Phase 2: Adapters (Complete)
- [x] CLI adapter (cli.ts)
- [x] GUI adapter (gui.ts)
- [x] Messaging adapter (messaging.ts)

### Phase 3: Integration (COMPLETED)
- [x] Connect to agent core
  - Surface bootstrap module: `packages/zee-core/src/bootstrap/surface.ts`
  - Integrated into daemon startup/shutdown sequence
  - Status output in daemon startup message
- [x] Implement platform handlers (Baileys, Matrix)
  - WhatsApp handler (Baileys)
  - Matrix handler (matrix-bot-sdk)
  - Both implement `MessagingPlatformHandler` interface
- [x] Add surface router
  - Router: `src/surface/router.ts`
  - Message routing between surfaces and agent core
  - Surface lifecycle management

### Phase 4: Enhancement (COMPLETED)
- [x] Surface analytics
  - Event tracking: messages, errors, connect/disconnect
  - Session statistics: active sessions, message counts
  - Query interface: `getAnalytics()`, `getSessionStats()`
- [x] Hot-reload configuration
  - Configurable via `enableHotReload` option
  - 30-second config check interval
  - Per-surface hot-reload support
- [x] Multi-surface orchestration
  - Register/unregister surfaces at runtime
  - Multiple concurrent surfaces (CLI + WhatsApp + Matrix)
  - Surface registry with conflict detection

## Related ADRs

- ADR-002: Agent Core Architecture
- ADR-003: Tool System
- ADR-004: Permission System

## References

- Stanley: GPUI-based desktop client
- Zee: Existing messaging patterns (`src/domain/zee/tools.ts`)

## Sign-Off

**Proposed by**: arch-surface agent
**Date**: 2026-01-04
**Status**: ACCEPTED (Design ready for implementation)
