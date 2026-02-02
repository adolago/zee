# Session Management System Architecture

## Overview

The session management system handles conversation state across all surfaces (CLI, API, SDK). It provides a unified interface for managing message history, streaming responses, tool execution, and persistence.

## C4 Architecture Diagrams

### Level 1: System Context

```
+------------------+     +----------------------+     +------------------+
|                  |     |                      |     |                  |
|   CLI Surface    |     |     API Surface      |     |   SDK Surface    |
|                  |     |                      |     |                  |
+--------+---------+     +----------+-----------+     +--------+---------+
         |                          |                          |
         |                          |                          |
         +------------+-------------+-------------+------------+
                      |                           |
                      v                           v
         +------------+---------------------------+------------+
         |                                                     |
         |              Session Management System              |
         |                                                     |
         |  +---------------+  +---------------+  +---------+  |
         |  |   Session     |  |   Message     |  | Stream  |  |
         |  |   Manager     |  |   Processor   |  | Handler |  |
         |  +---------------+  +---------------+  +---------+  |
         |                                                     |
         +---------------------------+-------------------------+
                                     |
                      +--------------+---------------+
                      |              |               |
                      v              v               v
              +-------+----+  +------+------+  +-----+------+
              |            |  |             |  |            |
              | LLM        |  | Tool        |  | Storage    |
              | Providers  |  | Registry    |  | Backend    |
              |            |  |             |  |            |
              +------------+  +-------------+  +------------+
```

### Level 2: Container Diagram

```
+------------------------------------------------------------------+
|                     Session Management System                      |
+------------------------------------------------------------------+
|                                                                    |
|  +------------------+    +------------------+    +---------------+ |
|  |                  |    |                  |    |               | |
|  |  Session         |    |  Message         |    |  Stream       | |
|  |  Interface       |    |  Processor       |    |  Handler      | |
|  |  (session.ts)    |    |  (processor.ts)  |    |  (stream.ts)  | |
|  |                  |    |                  |    |               | |
|  |  - ISession      |    |  - Process       |    |  - Text       | |
|  |  - ISessionMgr   |    |    stream        |    |    stream     | |
|  |  - Create/Fork   |    |  - Tool calls    |    |  - Reasoning  | |
|  |  - Messages      |    |  - Doom loop     |    |    stream     | |
|  |                  |    |    detection     |    |  - Tool calls | |
|  +--------+---------+    +--------+---------+    +-------+-------+ |
|           |                       |                      |         |
|           v                       v                      v         |
|  +------------------+    +------------------+    +---------------+ |
|  |                  |    |                  |    |               | |
|  |  Types           |    |  Retry           |    |  Persistence  | |
|  |  (types.ts)      |    |  (retry.ts)      |    |  (persist.ts) | |
|  |                  |    |                  |    |               | |
|  |  - SessionInfo   |    |  - Exponential   |    |  - Storage    | |
|  |  - Message       |    |    backoff       |    |    backend    | |
|  |  - Parts         |    |  - Error         |    |  - Save/Load  | |
|  |  - Events        |    |    classify      |    |  - Export     | |
|  |                  |    |  - Retry-After   |    |               | |
|  +------------------+    +------------------+    +---------------+ |
|                                                                    |
+------------------------------------------------------------------+
```

### Level 3: Component Diagram

```
Session Interface (session.ts)
+-----------------------------------------------------------------------+
|                                                                       |
|  +-------------------+     +-------------------+     +--------------+ |
|  | ISession          |     | ISessionManager   |     | Utilities    | |
|  +-------------------+     +-------------------+     +--------------+ |
|  | + id: SessionId   |     | + create()        |     | generateId() | |
|  | + info: SessionInfo    | + get()           |     | calcUsage()  | |
|  | + status         |     | + list()          |     | defaultTitle | |
|  | + context        |     | + switchTo()      |     +--------------+ |
|  +-------------------+     | + delete()        |                     |
|  | + initialize()   |     | + getStats()      |                     |
|  | + update()       |     +-------------------+                     |
|  | + getMessages()  |                                               |
|  | + addMessage()   |                                               |
|  | + fork()         |                                               |
|  +-------------------+                                               |
|                                                                       |
+-----------------------------------------------------------------------+

Message Processor (processor.ts)
+-----------------------------------------------------------------------+
|                                                                       |
|  +-------------------+     +-------------------+     +--------------+ |
|  | MessageProcessor  |     | ProcessorConfig   |     | Callbacks    | |
|  +-------------------+     +-------------------+     +--------------+ |
|  | - toolCalls       |     | doomLoopThreshold |     | updatePart() | |
|  | - snapshot        |     | doomLoopPermission|     | updateMsg()  | |
|  | - blocked         |     | maxOutputTokens   |     | snapshot()   | |
|  | - attempt         |     | enablePruning     |     | askPerm()    | |
|  +-------------------+     +-------------------+     +--------------+ |
|  | + process()       |                                               |
|  | + getToolPart()   |                                               |
|  | - checkDoomLoop() |                                               |
|  | - handleError()   |                                               |
|  | - finalizeParts() |                                               |
|  +-------------------+                                               |
|                                                                       |
+-----------------------------------------------------------------------+

Stream Handler (stream.ts)
+-----------------------------------------------------------------------+
|                                                                       |
|  +-------------------+     +-------------------+     +--------------+ |
|  | StreamHandler     |     | Aggregators       |     | Config       | |
|  +-------------------+     +-------------------+     +--------------+ |
|  | - state           |     | TextStream        |     | bufferSize   | |
|  | - buffer          |     | Aggregator        |     | autoReconnect| |
|  | - resolvers       |     +-------------------+     | maxAttempts  | |
|  +-------------------+     | ReasoningStream   |     | reconnectDelay|
|  | + start()         |     | Aggregator        |     | heartbeat    | |
|  | + stop()          |     +-------------------+     +--------------+ |
|  | + on/off()        |     | ToolCallStream    |                     |
|  | [asyncIterator]() |     | Aggregator        |                     |
|  | - connect()       |     +-------------------+                     |
|  | - reconnect()     |                                               |
|  +-------------------+                                               |
|                                                                       |
+-----------------------------------------------------------------------+

Persistence (persistence.ts)
+-----------------------------------------------------------------------+
|                                                                       |
|  +-------------------+     +-------------------+     +--------------+ |
|  | SessionPersistence|     | IStorageBackend   |     | Types        | |
|  +-------------------+     +-------------------+     +--------------+ |
|  | - backend         |     | + initialize()    |     | SessionSummary|
|  | - projectId       |     | + write()         |     | SessionExport|
|  | - emitter         |     | + read()          |     | ImportOptions|
|  +-------------------+     | + delete()        |     +--------------+ |
|  | + saveSession()   |     | + list()          |                     |
|  | + loadSession()   |     | + exists()        |                     |
|  | + saveMessage()   |     | + update()        |                     |
|  | + savePart()      |     +-------------------+                     |
|  | + saveContext()   |     | MemoryStorage     |                     |
|  | + export/import() |     | Backend           |                     |
|  +-------------------+     +-------------------+                     |
|                                                                       |
+-----------------------------------------------------------------------+

Retry Logic (retry.ts)
+-----------------------------------------------------------------------+
|                                                                       |
|  +-------------------+     +-------------------+     +--------------+ |
|  | RetryStrategy     |     | DefaultRetry      |     | Utilities    | |
|  +-------------------+     | Strategy          |     +--------------+ |
|  | + getDelay()      |     +-------------------+     | classifyError|
|  | + sleep()         |     | - currentAttempt  |     | calcDelay()  |
|  | + shouldRetry()   |     +-------------------+     | withRetry()  |
|  | + currentAttempt  |     | + getDelay()      |     +--------------+ |
|  | + config          |     | + sleep()         |                     |
|  +-------------------+     | + shouldRetry()   |     +--------------+ |
|                            | - extractHeaders()|     | Constants    | |
|                            +-------------------+     +--------------+ |
|                                                      | RETRYABLE_   | |
|                                                      | ERRORS       | |
|                                                      | DEFAULT_     | |
|                                                      | RETRY_CONFIG | |
|                                                      +--------------+ |
|                                                                       |
+-----------------------------------------------------------------------+
```

## Data Flow

### Message Processing Flow

```
User Input
    |
    v
+-------------------+
| SessionPrompt     |
| - Create user msg |
| - Start loop      |
+--------+----------+
         |
         v
+-------------------+
| MessageProcessor  |
| - Create asst msg |
| - Set up stream   |
+--------+----------+
         |
         v
+-------------------+
| LLM Provider      |
| - Stream request  |
| - Get response    |
+--------+----------+
         |
         v
+-------------------+       +-------------------+
| StreamHandler     |------>| Text Aggregator   |
| - Process events  |       | Reasoning Aggr.   |
| - Buffer/emit     |       | ToolCall Aggr.    |
+--------+----------+       +-------------------+
         |
         v
+-------------------+
| Tool Execution    |
| - Call tools      |
| - Get results     |
+--------+----------+
         |
         v
+-------------------+
| Persistence       |
| - Save message    |
| - Save parts      |
| - Update session  |
+-------------------+
```

### Retry Flow

```
API Call
    |
    v
+-------------------+
| Execute Request   |
+--------+----------+
         |
    +----+----+
    | Error?  |
    +----+----+
         |
    Yes  |  No
    v    v
+---+----+---+     +-------------------+
| Classify   |     | Return Result     |
| Error      |     +-------------------+
+-----+------+
      |
  +---+---+
  |Retry? |
  +---+---+
      |
  Yes |  No
  v   v
+---+----+---+     +-------------------+
| Calculate  |     | Throw Error       |
| Delay      |     +-------------------+
+-----+------+
      |
      v
+-------------------+
| Check Retry-After |
| Headers           |
+--------+----------+
         |
         v
+-------------------+
| Apply Backoff     |
| + Jitter          |
+--------+----------+
         |
         v
+-------------------+
| Sleep (Delay)     |
+--------+----------+
         |
         v
+-------------------+
| Retry Request     |
+-------------------+
```

## Key Design Patterns

### 1. Event-Driven Architecture

All components emit events for state changes, enabling:
- Real-time UI updates
- Decoupled component communication
- Easy extension via event listeners

### 2. Strategy Pattern (Retry)

Retry logic uses the Strategy pattern:
- `RetryStrategy` interface defines the contract
- `DefaultRetryStrategy` provides standard implementation
- Specialized strategies for rate limiting and network errors

### 3. Iterator Pattern (Streaming)

Streams implement `AsyncIterator`:
- Natural async/await consumption
- Backpressure handling via buffer
- Composable with other async operations

### 4. Factory Pattern

Factory functions for component creation:
- `createProcessor()` - Message processors
- `createStreamHandler()` - Stream handlers
- `createPersistence()` - Persistence managers
- `createRetryStrategy()` - Retry strategies

### 5. Repository Pattern (Persistence)

Storage abstracted behind interfaces:
- `IStorageBackend` - Storage operations
- `SessionPersistence` - Domain-specific operations
- Supports multiple backends (memory, file, database)

## Configuration

### Session Configuration

```typescript
{
  maxConcurrentSessions: 10,
  sessionTimeout: 1800000,  // 30 minutes
  maxHistorySize: 100,
  autoCompaction: true,
  compactionThreshold: 100000,
  crossSessionContext: true,
  persistence: {
    enabled: true,
    backend: 'file',
    path: './sessions'
  },
  retry: {
    maxAttempts: 5,
    initialDelay: 2000,
    maxDelay: 30000,
    backoffFactor: 2
  }
}
```

### Session Context Overrides

Sessions can carry optional metadata that is injected into the system prompt on each loop. These fields are additive and do not replace the base agent prompt or surface policies.

- `systemPrompt`: a session-specific system prompt section.
- `skills`: an ordered list of skill names. The corresponding `SKILL.md` content is loaded and appended.
- `contextFiles`: a list of file paths whose contents are appended as session context.

Path resolution for `contextFiles` expands `${ENV}` variables, `~/` home paths, and resolves relative paths against the session directory.

The session also stores a `toolPolicySnapshot` (read-only) to capture the tool policy used for a processing loop.

```json
POST /session
{
  "directory": "/path/to/project",
  "systemPrompt": "Be concise in this session.",
  "skills": ["codebase-guide"],
  "contextFiles": ["docs/ARCHITECTURE.md", "~/notes/todo.md"]
}
```

```json
PATCH /session/:sessionID
{
  "systemPrompt": null,
  "skills": ["gh-address-comments"],
  "contextFiles": []
}
```

### Processor Configuration

```typescript
{
  doomLoopThreshold: 3,
  doomLoopPermission: 'deny',
  maxOutputTokens: 32000,
  enablePruning: true
}
```

### Stream Configuration

```typescript
{
  bufferSize: 100,
  autoReconnect: true,
  maxReconnectAttempts: 3,
  reconnectDelay: 1000,
  heartbeatInterval: 30000
}
```

## Error Handling

### Error Classification

| Type | Description | Retryable |
|------|-------------|-----------|
| `session_busy` | Session is processing | No |
| `session_not_found` | Session doesn't exist | No |
| `provider_auth_error` | Auth failure | No |
| `api_error` | API call failed | Maybe |
| `output_length_error` | Response too long | No |
| `aborted` | User cancelled | No |
| `unknown` | Unclassified error | No |

### Retryable Errors

- Rate limiting (429)
- Server overload (503)
- Temporary server errors (500, 502, 504)
- Network errors (ECONNRESET, ETIMEDOUT)
- Capacity issues

## Multi-Session Support

### Session Isolation

Each session maintains:
- Independent message history
- Isolated tool call state
- Separate context (cwd, files, preferences)
- Own persistence records

### Session Switching

When switching sessions:
1. Current session state is persisted
2. New session is loaded/created
3. Context is restored
4. Active session reference is updated

### Session Forking

Sessions can be forked:
1. Create new session
2. Copy messages up to fork point
3. Copy all message parts
4. Establish parent-child relationship

## Performance Considerations

### Token Management

- Track input/output tokens per message
- Calculate costs per model pricing
- Support cache token tracking (Anthropic, Bedrock)

### Memory Management

- Configurable message history limit
- Automatic tool output pruning
- Session compaction for long conversations

### Streaming Efficiency

- Buffered event processing
- Backpressure handling
- Reconnection support for network issues

## Security Considerations

### Data Isolation

- Sessions are project-scoped
- No cross-project data access
- User-specific session lists

### Sensitive Data

- Tool outputs can be pruned
- Export/import with optional filtering
- Context preferences are session-local
