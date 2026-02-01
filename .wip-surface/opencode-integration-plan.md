# OpenCode Integration Plan

## Executive Summary

This document outlines the integration strategy for connecting the OpenCode AI coding agent with the agent-core backend. The integration enables OpenCode to leverage agent-core's persona-based routing, semantic memory (Qdrant), and multi-surface orchestration while maintaining OpenCode's TUI and client/server capabilities.

## 1. Integration Architecture

### 1.1 High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           INTEGRATION ARCHITECTURE                           │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌─────────────────────┐         ┌─────────────────────┐                    │
│  │   OpenCode Client   │◄───────►│  OpenCode TUI/GUI   │                    │
│  │   (CLI/Desktop)     │         │   (User Interface)  │                    │
│  └──────────┬──────────┘         └─────────────────────┘                    │
│             │                                                                │
│             │ HTTP/WebSocket                                                   │
│             ▼                                                                │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │                    OpenCode Adapter Layer                            │    │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐ │    │
│  │  │   Session   │  │    Tool     │  │    Auth     │  │   Config    │ │    │
│  │  │   Bridge    │  │   Bridge    │  │   Bridge    │  │   Bridge    │ │    │
│  │  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘ │    │
│  └─────────────────────────────┬───────────────────────────────────────┘    │
│                                │                                             │
│                                │ Agent-Core SDK                              │
│                                ▼                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │                      AGENT-CORE BACKEND                              │    │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐ │    │
│  │  │   Daemon    │  │   Persona   │  │   Memory    │  │   Surface   │ │    │
│  │  │   Server    │  │   Router    │  │  (Qdrant)   │  │   Router    │ │    │
│  │  │  (Port 3210)│  │             │  │             │  │             │ │    │
│  │  └─────────────┘  └──────┬──────┘  └─────────────┘  └─────────────┘ │    │
│  │                          │                                          │    │
│  │         ┌────────────────┼────────────────┐                         │    │
│  │         ▼                ▼                ▼                         │    │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐                  │    │
│  │  │     ZEE     │  │   STANLEY   │  │    JOHNY    │                  │    │
│  │  │  Personal   │  │  Investing  │  │  Learning   │                  │    │
│  │  │  Assistant  │  │  Platform   │  │  System     │                  │    │
│  │  └─────────────┘  └─────────────┘  └─────────────┘                  │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 1.2 Communication Flow

```
1. User sends message via OpenCode TUI
   │
   ▼
2. OpenCode client processes command
   │
   ▼
3. OpenCode Adapter Layer translates to agent-core format
   │
   ▼
4. Agent-Core SDK sends HTTP request to daemon (port 3210)
   │
   ▼
5. Agent-Core persona router determines target persona
   │
   ▼
6. Response flows back through the chain
```

## 2. API Adapter Requirements

### 2.1 Session Management Bridge

| OpenCode Concept | Agent-Core Mapping | Implementation |
|------------------|-------------------|----------------|
| `Session` | `Session` | Direct mapping with ID translation |
| `Message` | `MessageV2` | Format conversion layer |
| `Thread` | `Session.threadId` | Thread context preservation |
| `Agent Mode` | `Persona` | build→Zee, plan→read-only mode, general→subagent |

**Required Endpoints:**

```typescript
// Session Bridge
POST   /v1/opencode/session              → POST /session
GET    /v1/opencode/session/:id          → GET  /session/:sessionID
POST   /v1/opencode/session/:id/message  → POST /session/:sessionID/message
DELETE /v1/opencode/session/:id          → DELETE /session/:sessionID

// Status Bridge
GET    /v1/opencode/status               → GET  /session/status
```

### 2.2 Tool Bridge

OpenCode tools need to be registered with agent-core's tool registry:

```typescript
// Tool Registry Bridge
interface ToolBridge {
  // Map OpenCode tool names to agent-core tool names
  toolMapping: {
    "BashTool": "bash",
    "EditTool": "edit", 
    "GlobTool": "glob",
    "GrepTool": "grep",
    "LSTool": "ls",
    "ReadTool": "read",
    "WriteTool": "write",
    // ... etc
  }
  
  // Permission mapping
  permissionMapping: {
    "BashTool": "bash",
    "EditTool": "edit",
    // ... etc
  }
}
```

### 2.3 Configuration Bridge

Configuration translation between OpenCode and agent-core formats:

```typescript
interface ConfigBridge {
  // OpenCode → Agent-Core
  translateConfig(opencodeConfig: OpenCodeConfig): AgentCoreConfig;
  
  // Agent-Core → OpenCode
  reverseTranslateConfig(agentCoreConfig: AgentCoreConfig): OpenCodeConfig;
}

// Key mappings:
// - opencode.models → agent-core.provider
// - opencode.agent → agent-core.agent
// - opencode.instructions → agent-core.instructions
// - opencode.permission → agent-core.permission
```

### 2.4 Adapter Implementation Structure

```
packages/opencode-adapter/
├── src/
│   ├── index.ts                 # Main exports
│   ├── bridge/
│   │   ├── session.ts           # Session bridge
│   │   ├── tool.ts              # Tool bridge
│   │   ├── config.ts            # Config bridge
│   │   └── auth.ts              # Auth bridge
│   ├── client/
│   │   ├── opencode-client.ts   # OpenCode-compatible client
│   │   └── adapter-client.ts    # Adapter HTTP client
│   ├── types/
│   │   ├── opencode.ts          # OpenCode type definitions
│   │   └── bridge.ts            # Bridge type definitions
│   └── utils/
│       ├── id-transform.ts      # ID format conversion
│       └── error-mapper.ts      # Error code mapping
├── package.json
└── tsconfig.json
```

## 3. State Synchronization Strategy

### 3.1 State Mapping

| OpenCode State | Agent-Core State | Sync Strategy |
|---------------|------------------|---------------|
| Session history | Session messages | Bidirectional sync with conflict resolution |
| Tool call results | Tool executions | Agent-core as source of truth |
| File system state | Project state | Lazy sync on access |
| User preferences | Config | Agent-core config with OpenCode overrides |

### 3.2 Synchronization Architecture

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│  OpenCode State │◄───►│  Sync Manager   │◄───►│ Agent-Core State│
│   (Local)       │     │  (Conflict Res) │     │   (Qdrant)      │
└─────────────────┘     └─────────────────┘     └─────────────────┘
         │                       │                       │
         ▼                       ▼                       ▼
  ┌─────────────┐         ┌─────────────┐         ┌─────────────┐
  │  Session    │         │  Event Bus  │         │  Memory     │
  │  Storage    │         │  (WebSocket)│         │  Service    │
  └─────────────┘         └─────────────┘         └─────────────┘
```

### 3.3 Event Synchronization

**Real-time Events:**
- Message streaming (SSE/WebSocket)
- Tool execution progress
- Session status changes

**Periodic Sync:**
- Session metadata (30s interval)
- Configuration changes (on file change)
- Analytics/usage data (60s interval)

### 3.4 Conflict Resolution

```typescript
interface ConflictResolution {
  // Strategy: Last-write-wins with timestamp comparison
  resolve(conflict: StateConflict): Resolution {
    if (conflict.local.timestamp > conflict.remote.timestamp) {
      return { winner: 'local', mergeStrategy: 'overwrite' };
    }
    return { winner: 'remote', mergeStrategy: 'merge' };
  }
  
  // Special handling for session messages
  resolveMessages(local: Message[], remote: Message[]): Message[] {
    // Merge by message ID, prefer agent-core version
    return mergeById(remote, local, { prefer: 'remote' });
  }
}
```

## 4. Authentication Integration Plan

### 4.1 Auth Architecture

```
┌─────────────────┐
│  OpenCode User  │
└────────┬────────┘
         │
         ▼
┌─────────────────────────┐
│  OpenCode Auth Layer    │
│  (Token/API Key)        │
└────────┬────────────────┘
         │
         ▼
┌─────────────────────────┐
│  Adapter Auth Bridge    │
│  (Token translation)    │
└────────┬────────────────┘
         │
         ▼
┌─────────────────────────┐
│  Agent-Core Auth        │
│  (Basic Auth / Token)   │
└─────────────────────────┘
```

### 4.2 Auth Flow

**Option A: Token Passthrough**
1. OpenCode client provides user token
2. Adapter validates with agent-core
3. All requests include `Authorization: Bearer <token>` header
4. Agent-core validates and maps to internal session

**Option B: Basic Auth Bridge**
1. OpenCode provides credentials
2. Adapter translates to agent-core Basic Auth format
3. Agent-core validates against configured password
4. Session-scoped authorization

### 4.3 Implementation

```typescript
// Auth Bridge
class AuthBridge {
  constructor(
    private agentCoreUrl: string,
    private credentials: Credentials
  ) {}
  
  async authenticate(): Promise<AuthToken> {
    const response = await fetch(`${this.agentCoreUrl}/auth/validate`, {
      headers: this.buildAuthHeaders()
    });
    return response.json();
  }
  
  buildAuthHeaders(): Headers {
    const { username, password } = this.credentials;
    const token = Buffer.from(`${username}:${password}`).toString('base64');
    return { 'Authorization': `Basic ${token}` };
  }
}
```

### 4.4 Security Considerations

- Token rotation support
- Session timeout handling
- Secure credential storage (keychain/keyring integration)
- HTTPS enforcement for remote connections

## 5. Deployment Approach

### 5.1 Deployment Options

#### Option 1: Sidecar Deployment (Recommended)

```
┌─────────────────────────────────────────────────────┐
│                   User Machine                       │
│  ┌─────────────────┐    ┌─────────────────────────┐ │
│  │   OpenCode      │◄──►│   Agent-Core Daemon     │ │
│  │   (TUI/CLI)     │    │   (Port 3210)           │ │
│  └─────────────────┘    └─────────────────────────┘ │
│                                │                    │
│                                ▼                    │
│                         ┌─────────────┐             │
│                         │   Qdrant    │             │
│                         │  (Memory)   │             │
│                         └─────────────┘             │
└─────────────────────────────────────────────────────┘
```

**Pros:** Simple, local-first, no network dependencies
**Cons:** Requires both services running locally

#### Option 2: Remote Agent-Core

```
┌─────────────────┐         ┌─────────────────────────┐
│   OpenCode      │◄───────►│   Agent-Core Server     │
│   (Local)       │  HTTPS  │   (Cloud/Remote)        │
└─────────────────┘         └─────────────────────────┘
                                     │
                                     ▼
                              ┌─────────────┐
                              │   Qdrant    │
                              └─────────────┘
```

**Pros:** Centralized memory, multi-device sync
**Cons:** Network dependency, latency concerns

#### Option 3: Hybrid Deployment

```
┌─────────────────┐         ┌─────────────────────────┐
│   OpenCode      │◄───────►│   Agent-Core Edge       │
│   (Local)       │  Local  │   (Local Daemon)        │
└─────────────────┘         └───────────┬─────────────┘
                                        │
                           ┌────────────┼────────────┐
                           │            │            │
                           ▼            ▼            ▼
                    ┌──────────┐  ┌──────────┐  ┌──────────┐
                    │  Local   │  │  Remote  │  │  Remote  │
                    │  Qdrant  │  │  Qdrant  │  │  Backup  │
                    └──────────┘  └──────────┘  └──────────┘
```

**Pros:** Best of both worlds, offline capability with sync
**Cons:** More complex setup

### 5.2 Installation Methods

**Method 1: Bundled Install**
```bash
# OpenCode installer bundles agent-core
brew install opencode
# Agent-core auto-installed as dependency
```

**Method 2: Separate Install**
```bash
# Install agent-core first
npm install -g @adolago/agent-core

# Install opencode
npm install -g opencode-ai

# Configure connection
opencode config set agent-core.url http://localhost:3210
```

**Method 3: Docker Compose**
```yaml
# docker-compose.yml
version: '3.8'
services:
  agent-core:
    image: adolago/agent-core:latest
    ports:
      - "3210:3210"
    volumes:
      - ~/.config/agent-core:/config
      
  qdrant:
    image: qdrant/qdrant:latest
    ports:
      - "6333:6333"
```

### 5.3 Migration Strategy

**Phase 1: Parallel Operation (Weeks 1-2)**
- Run OpenCode and agent-core side by side
- Import existing OpenCode sessions to agent-core
- Validate tool compatibility

**Phase 2: Adapter Integration (Weeks 3-4)**
- Deploy adapter layer
- Route OpenCode requests through adapter
- Monitor for issues

**Phase 3: Full Cutover (Week 5)**
- Switch default to agent-core backend
- Maintain fallback to native OpenCode
- Deprecation notice for native mode

### 5.4 Rollback Plan

```
┌─────────────────┐
│   Detection     │ ──► Error rate > 5% or latency > 10s
└────────┬────────┘
         ▼
┌─────────────────┐
│   Alert User    │ ──► "Switching to fallback mode"
└────────┬────────┘
         ▼
┌─────────────────┐
│   Auto-Rollback │ ──► Use native OpenCode backend
└────────┬────────┘
         ▼
┌─────────────────┐
│   Diagnostic    │ ──► Log collection, error reporting
└─────────────────┘
```

## 6. Implementation Timeline

| Phase | Task | Duration | Dependencies |
|-------|------|----------|--------------|
| 1 | API adapter scaffolding | 3 days | - |
| 1 | Session bridge | 4 days | API adapter |
| 1 | Tool bridge | 5 days | Session bridge |
| 2 | Auth integration | 3 days | API adapter |
| 2 | State sync manager | 5 days | Session bridge |
| 2 | Config bridge | 3 days | - |
| 3 | Integration testing | 5 days | All bridges |
| 3 | Deployment scripts | 3 days | - |
| 4 | Documentation | 2 days | - |
| 4 | User acceptance testing | 5 days | All above |

**Total Estimated Duration: 5 weeks**

## 7. Risk Assessment

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| API incompatibility | High | Medium | Comprehensive mapping document, version negotiation |
| Performance degradation | Medium | Low | Caching layer, async processing |
| Data loss during migration | High | Low | Backup strategy, incremental sync |
| Auth token expiration | Medium | Medium | Refresh token handling, graceful degradation |
| Memory quota exceeded | Medium | Medium | Qdrant optimization, memory limits |

## 8. Success Metrics

- **Latency**: p95 response time < 2s for standard operations
- **Reliability**: 99.9% uptime for agent-core backend
- **Compatibility**: 100% of OpenCode tools functional
- **User Experience**: < 5s additional startup time
- **Data Integrity**: 0 data loss incidents during migration

## Appendix A: API Endpoint Mapping

| OpenCode Endpoint | Agent-Core Endpoint | Notes |
|-------------------|---------------------|-------|
| `POST /v1/sessions` | `POST /session` | Direct mapping |
| `GET /v1/sessions/:id` | `GET /session/:sessionID` | Direct mapping |
| `POST /v1/sessions/:id/messages` | `POST /session/:sessionID/message` | Streaming support |
| `GET /v1/agents` | `GET /agent` | Persona list |
| `POST /v1/tools/execute` | `POST /experimental/tool` | Tool execution |
| `GET /v1/config` | `GET /config` | Config read |
| `PUT /v1/config` | `PUT /config` | Config write |

## Appendix B: Data Models

### Session Mapping
```typescript
// OpenCode Session → Agent-Core Session
{
  id: string;                    // Maps to sessionID
  created_at: string;            // Maps to time.created
  updated_at: string;            // Maps to time.updated
  agent: string;                 // Maps to agent/persona
  messages: Message[];           // Maps to session messages
  metadata: Record<string, any>; // Maps to options
}
```

### Message Mapping
```typescript
// OpenCode Message → Agent-Core MessageV2
{
  id: string;           // Preserved
  role: 'user'|'assistant';  // Maps to sender
  content: string;      // Maps to body/parts
  timestamp: string;    // Maps to time
  tool_calls?: [];      // Maps to tool executions
}
```
