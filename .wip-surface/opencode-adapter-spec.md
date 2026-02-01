# OpenCode Adapter Technical Specification

## 1. Component Architecture

### 1.1 Core Components

```typescript
// packages/opencode-adapter/src/core/

/**
 * Main adapter orchestrator
 */
interface OpenCodeAdapter {
  // Lifecycle
  initialize(): Promise<void>;
  shutdown(): Promise<void>;
  
  // Bridges
  readonly session: SessionBridge;
  readonly tool: ToolBridge;
  readonly config: ConfigBridge;
  readonly auth: AuthBridge;
  readonly state: StateSyncManager;
  
  // Events
  on(event: 'error', handler: (error: AdapterError) => void): void;
  on(event: 'sessionUpdate', handler: (session: Session) => void): void;
}

/**
 * Bridge implementations
 */
interface SessionBridge {
  create(params: CreateSessionParams): Promise<Session>;
  get(id: string): Promise<Session | null>;
  list(filters?: SessionFilters): Promise<Session[]>;
  delete(id: string): Promise<void>;
  sendMessage(sessionId: string, message: Message): Promise<MessageStream>;
}

interface ToolBridge {
  list(): Promise<Tool[]>;
  execute(name: string, params: unknown): Promise<ToolResult>;
  validatePermission(tool: string, context: PermissionContext): Promise<boolean>;
}

interface ConfigBridge {
  get(): Promise<Config>;
  set(config: Partial<Config>): Promise<void>;
  watch(callback: (config: Config) => void): () => void;
}

interface AuthBridge {
  authenticate(credentials: Credentials): Promise<AuthResult>;
  refresh(): Promise<AuthResult>;
  getHeaders(): Record<string, string>;
}
```

## 2. Session Bridge Implementation

### 2.1 Session Translation Layer

```typescript
// packages/opencode-adapter/src/bridge/session.ts

import { createOpencodeClient } from '@adolago/agent-core/sdk';

export class SessionBridgeImpl implements SessionBridge {
  private client: OpencodeClient;
  private sessionCache = new Map<string, Session>();
  
  constructor(private config: AdapterConfig) {
    this.client = createOpencodeClient({
      baseUrl: config.agentCoreUrl,
      headers: config.authHeaders,
    });
  }
  
  async create(params: CreateSessionParams): Promise<Session> {
    // Map OpenCode params to agent-core format
    const agentCoreParams = {
      directory: params.workingDirectory,
      agent: this.mapAgentToPersona(params.agent),
      model: params.model,
      title: params.title,
    };
    
    const response = await this.client.session.create(agentCoreParams);
    
    // Transform response to OpenCode format
    const session = this.transformSession(response);
    this.sessionCache.set(session.id, session);
    
    return session;
  }
  
  async sendMessage(sessionId: string, message: Message): Promise<MessageStream> {
    const agentCoreMessage = this.transformMessage(message);
    
    const stream = await this.client.session.prompt({
      sessionID: sessionId,
      ...agentCoreMessage,
    });
    
    // Transform agent-core stream to OpenCode format
    return this.transformStream(stream);
  }
  
  private mapAgentToPersona(agent: string): string {
    const mapping: Record<string, string> = {
      'build': 'zee',        // Default development persona
      'plan': 'zee',         // Read-only mode handled via permissions
      'general': 'zee',      // Subagent context
    };
    return mapping[agent] || 'zee';
  }
  
  private transformSession(info: AgentCoreSession): Session {
    return {
      id: info.id,
      created_at: info.time.created,
      updated_at: info.time.updated,
      agent: info.agent || 'build',
      title: info.title,
      message_count: info.messageCount,
      working_directory: info.directory,
    };
  }
  
  private transformMessage(message: Message): AgentCoreMessage {
    return {
      role: message.role,
      content: message.content,
      ...(message.tool_calls ? { toolCalls: message.tool_calls } : {}),
    };
  }
  
  private async *transformStream(
    stream: AsyncIterable<AgentCoreStreamChunk>
  ): AsyncIterable<OpenCodeStreamChunk> {
    for await (const chunk of stream) {
      yield {
        type: chunk.type,
        content: chunk.text || chunk.content,
        tool_call: chunk.toolCall ? this.transformToolCall(chunk.toolCall) : undefined,
        done: chunk.type === 'finish',
      };
    }
  }
}
```

## 3. Tool Bridge Implementation

### 3.1 Tool Registry Mapping

```typescript
// packages/opencode-adapter/src/bridge/tool.ts

const TOOL_MAPPING: Record<string, string> = {
  // OpenCode Tool → Agent-Core Tool
  'BashTool': 'bash',
  'EditTool': 'edit',
  'GlobTool': 'glob',
  'GrepTool': 'grep',
  'LSTool': 'ls',
  'ReadTool': 'read',
  'WriteTool': 'write',
  'MultiEditTool': 'multiedit',
  'WebFetchTool': 'webfetch',
  'WebSearchTool': 'websearch',
  'LSPTool': 'lsp',
  'CodeSearchTool': 'codesearch',
  'TaskTool': 'task',
  'TodoTool': 'todo',
  'PlanTool': 'plan',
  'PatchTool': 'apply_patch',
};

const PERMISSION_MAPPING: Record<string, string> = {
  'BashTool': 'bash',
  'EditTool': 'edit',
  'WriteTool': 'write',
  'TaskTool': 'task',
};

export class ToolBridgeImpl implements ToolBridge {
  private toolCache: Tool[] | null = null;
  
  async list(): Promise<Tool[]> {
    if (this.toolCache) return this.toolCache;
    
    // Fetch from agent-core
    const response = await this.client.tool.list();
    
    // Transform to OpenCode format
    this.toolCache = response.tools.map(t => ({
      name: this.reverseMapToolName(t.name),
      description: t.description,
      parameters: t.parameters,
    }));
    
    return this.toolCache;
  }
  
  async execute(name: string, params: unknown): Promise<ToolResult> {
    const agentCoreTool = TOOL_MAPPING[name] || name;
    
    // Transform parameters
    const transformedParams = this.transformToolParams(name, params);
    
    const result = await this.client.tool.execute({
      name: agentCoreTool,
      params: transformedParams,
    });
    
    return this.transformToolResult(result);
  }
  
  private transformToolParams(toolName: string, params: unknown): unknown {
    // Handle tool-specific parameter transformations
    switch (toolName) {
      case 'ReadTool':
        return {
          path: (params as any).file_path,
          offset: (params as any).offset,
          limit: (params as any).limit,
        };
      case 'BashTool':
        return {
          command: (params as any).command,
          timeout: (params as any).timeout_ms,
        };
      default:
        return params;
    }
  }
  
  private transformToolResult(result: AgentCoreToolResult): ToolResult {
    return {
      success: result.success,
      output: result.output,
      error: result.error,
      duration_ms: result.duration,
    };
  }
}
```

## 4. State Synchronization Manager

### 4.1 Sync Manager Implementation

```typescript
// packages/opencode-adapter/src/sync/manager.ts

interface SyncConfig {
  // Sync intervals
  sessionSyncIntervalMs: number;
  configSyncIntervalMs: number;
  
  // Conflict resolution
  conflictStrategy: 'local-wins' | 'remote-wins' | 'merge';
  
  // Retry
  maxRetries: number;
  retryDelayMs: number;
}

export class StateSyncManager extends EventEmitter {
  private syncIntervals = new Map<string, NodeJS.Timeout>();
  private pendingSyncs = new Map<string, Promise<void>>();
  
  constructor(
    private config: SyncConfig,
    private localStore: LocalStateStore,
    private remoteClient: OpencodeClient
  ) {
    super();
  }
  
  async startSessionSync(sessionId: string): Promise<void> {
    // Immediate sync
    await this.syncSession(sessionId);
    
    // Periodic sync
    const interval = setInterval(
      () => this.syncSession(sessionId),
      this.config.sessionSyncIntervalMs
    );
    
    this.syncIntervals.set(`session:${sessionId}`, interval);
  }
  
  async syncSession(sessionId: string): Promise<void> {
    // Prevent concurrent syncs
    if (this.pendingSyncs.has(sessionId)) {
      return this.pendingSyncs.get(sessionId)!;
    }
    
    const syncPromise = this.doSyncSession(sessionId);
    this.pendingSyncs.set(sessionId, syncPromise);
    
    try {
      await syncPromise;
    } finally {
      this.pendingSyncs.delete(sessionId);
    }
  }
  
  private async doSyncSession(sessionId: string): Promise<void> {
    const local = await this.localStore.getSession(sessionId);
    const remote = await this.remoteClient.session.get({ sessionID: sessionId });
    
    if (!local || !remote) {
      // Handle missing session
      return;
    }
    
    const comparison = this.compareSessions(local, remote);
    
    if (comparison.status === 'identical') {
      return;
    }
    
    if (comparison.status === 'diverged') {
      const resolution = this.resolveConflict(local, remote);
      
      if (resolution.action === 'merge') {
        const merged = this.mergeSessions(local, remote);
        await this.localStore.saveSession(sessionId, merged);
        await this.remoteClient.session.update({ sessionID: sessionId, ...merged });
      } else if (resolution.action === 'use-local') {
        await this.remoteClient.session.update({ sessionID: sessionId, ...local });
      } else {
        await this.localStore.saveSession(sessionId, remote);
      }
      
      this.emit('sessionSynced', { sessionId, resolution });
    }
  }
  
  private compareSessions(local: Session, remote: Session): ComparisonResult {
    const localHash = this.hashSession(local);
    const remoteHash = this.hashSession(remote);
    
    if (localHash === remoteHash) {
      return { status: 'identical' };
    }
    
    // Check if one is strictly newer
    if (remote.time.updated > local.time.updated + 1000) {
      return { status: 'remote-newer' };
    }
    if (local.time.updated > remote.time.updated + 1000) {
      return { status: 'local-newer' };
    }
    
    return { status: 'diverged' };
  }
  
  private resolveConflict(local: Session, remote: Session): ConflictResolution {
    switch (this.config.conflictStrategy) {
      case 'remote-wins':
        return { action: 'use-remote' };
      case 'local-wins':
        return { action: 'use-local' };
      case 'merge':
      default:
        return { action: 'merge' };
    }
  }
  
  private mergeSessions(local: Session, remote: Session): Session {
    // Merge messages by ID, preferring remote for conflicts
    const messages = new Map<string, Message>();
    
    for (const msg of remote.messages) {
      messages.set(msg.id, msg);
    }
    for (const msg of local.messages) {
      if (!messages.has(msg.id)) {
        messages.set(msg.id, msg);
      }
    }
    
    return {
      ...remote,
      messages: Array.from(messages.values()).sort(
        (a, b) => a.timestamp - b.timestamp
      ),
      time: {
        created: remote.time.created,
        updated: Date.now(),
      },
    };
  }
}
```

## 5. Authentication Implementation

### 5.1 Auth Bridge with Token Management

```typescript
// packages/opencode-adapter/src/bridge/auth.ts

interface TokenSet {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
}

export class AuthBridgeImpl implements AuthBridge {
  private token: TokenSet | null = null;
  private refreshPromise: Promise<AuthResult> | null = null;
  
  constructor(
    private config: AuthConfig,
    private tokenStore: TokenStore
  ) {}
  
  async authenticate(credentials: Credentials): Promise<AuthResult> {
    try {
      // Try to authenticate with agent-core
      const response = await fetch(`${this.config.agentCoreUrl}/auth/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: credentials.username,
          password: credentials.password,
        }),
      });
      
      if (!response.ok) {
        return { success: false, error: 'Invalid credentials' };
      }
      
      const token = await response.json();
      this.token = {
        accessToken: token.access_token,
        refreshToken: token.refresh_token,
        expiresAt: token.expires_at,
      };
      
      // Persist token
      await this.tokenStore.save(this.token);
      
      return { success: true };
    } catch (error) {
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      };
    }
  }
  
  async refresh(): Promise<AuthResult> {
    // Prevent concurrent refresh
    if (this.refreshPromise) {
      return this.refreshPromise;
    }
    
    this.refreshPromise = this.doRefresh();
    
    try {
      return await this.refreshPromise;
    } finally {
      this.refreshPromise = null;
    }
  }
  
  private async doRefresh(): Promise<AuthResult> {
    if (!this.token?.refreshToken) {
      return { success: false, error: 'No refresh token' };
    }
    
    try {
      const response = await fetch(`${this.config.agentCoreUrl}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: this.token.refreshToken }),
      });
      
      if (!response.ok) {
        // Clear invalid token
        this.token = null;
        await this.tokenStore.clear();
        return { success: false, error: 'Refresh failed' };
      }
      
      const newToken = await response.json();
      this.token = {
        accessToken: newToken.access_token,
        refreshToken: newToken.refresh_token || this.token.refreshToken,
        expiresAt: newToken.expires_at,
      };
      
      await this.tokenStore.save(this.token);
      return { success: true };
    } catch (error) {
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      };
    }
  }
  
  getHeaders(): Record<string, string> {
    if (!this.token) {
      // Fall back to Basic Auth
      if (this.config.username && this.config.password) {
        const creds = Buffer.from(`${this.config.username}:${this.config.password}`).toString('base64');
        return { 'Authorization': `Basic ${creds}` };
      }
      return {};
    }
    
    return { 'Authorization': `Bearer ${this.token.accessToken}` };
  }
  
  isTokenExpired(): boolean {
    if (!this.token?.expiresAt) return false;
    return Date.now() >= this.token.expiresAt - 60000; // 1 min buffer
  }
}
```

## 6. Configuration Bridge

### 6.1 Config Translation Layer

```typescript
// packages/opencode-adapter/src/bridge/config.ts

const CONFIG_MAPPING: ConfigMapping = {
  // OpenCode config key → Agent-Core config key
  'models.default': 'provider.model',
  'models.fallback': 'provider.fallback',
  'agent.default': 'agent.name',
  'agent.permissions': 'permission',
  'instructions.system': 'instructions',
  'ui.theme': 'mode.theme',
  'ui.compact': 'mode.compact',
};

export class ConfigBridgeImpl implements ConfigBridge {
  private currentConfig: Config | null = null;
  private watchers = new Set<ConfigWatcher>();
  private fileWatcher: FileWatcher | null = null;
  
  async get(): Promise<Config> {
    if (this.currentConfig) return this.currentConfig;
    
    // Load from agent-core
    const agentCoreConfig = await this.client.config.get();
    
    // Transform to OpenCode format
    this.currentConfig = this.transformToOpenCode(agentCoreConfig);
    
    return this.currentConfig;
  }
  
  async set(config: Partial<Config>): Promise<void> {
    // Merge with current config
    const merged = { ...this.currentConfig, ...config };
    
    // Transform to agent-core format
    const agentCoreConfig = this.transformToAgentCore(merged);
    
    // Save to agent-core
    await this.client.config.set(agentCoreConfig);
    
    // Update local cache
    this.currentConfig = merged;
    
    // Notify watchers
    this.watchers.forEach(w => w(merged));
  }
  
  watch(callback: ConfigWatcher): () => void {
    this.watchers.add(callback);
    
    // Setup file watcher if not already watching
    if (!this.fileWatcher) {
      this.setupFileWatcher();
    }
    
    return () => {
      this.watchers.delete(callback);
      if (this.watchers.size === 0 && this.fileWatcher) {
        this.fileWatcher.close();
        this.fileWatcher = null;
      }
    };
  }
  
  private transformToOpenCode(agentCore: AgentCoreConfig): Config {
    return {
      models: {
        default: this.resolveModel(agentCore.provider?.model),
        fallback: agentCore.provider?.fallback ? 
          this.resolveModel(agentCore.provider.fallback) : undefined,
      },
      agent: {
        default: this.resolveAgent(agentCore.agent?.name),
        permissions: this.transformPermissions(agentCore.permission),
      },
      instructions: {
        system: agentCore.instructions?.join('\n'),
      },
      ui: {
        theme: agentCore.mode?.theme,
        compact: agentCore.mode?.compact,
      },
    };
  }
  
  private transformToAgentCore(opencode: Config): AgentCoreConfig {
    return {
      provider: {
        model: opencode.models?.default,
        fallback: opencode.models?.fallback,
      },
      agent: {
        name: opencode.agent?.default,
      },
      permission: this.reverseTransformPermissions(opencode.agent?.permissions),
      instructions: opencode.instructions?.system?.split('\n'),
      mode: {
        theme: opencode.ui?.theme,
        compact: opencode.ui?.compact,
      },
    };
  }
  
  private resolveModel(modelId?: string): ModelConfig {
    // Map agent-core model ID to OpenCode format
    const [provider, model] = (modelId || '').split('/');
    return {
      provider: provider || 'anthropic',
      model: model || 'claude-3-5-sonnet',
    };
  }
  
  private resolveAgent(personaName?: string): string {
    // Map persona back to agent mode
    const mapping: Record<string, string> = {
      'zee': 'build',
      'stanley': 'build',
      'johny': 'build',
    };
    return mapping[personaName || ''] || 'build';
  }
}
```

## 7. Error Handling Strategy

### 7.1 Error Mapping

```typescript
// packages/opencode-adapter/src/errors/mapping.ts

const ERROR_MAPPING: Record<string, string> = {
  // Agent-Core errors → OpenCode errors
  'Session.NotFound': 'SESSION_NOT_FOUND',
  'Session.Expired': 'SESSION_EXPIRED',
  'Tool.NotFound': 'TOOL_NOT_FOUND',
  'Tool.PermissionDenied': 'PERMISSION_DENIED',
  'Provider.ModelNotFound': 'MODEL_NOT_FOUND',
  'Provider.RateLimited': 'RATE_LIMITED',
  'Auth.Unauthorized': 'UNAUTHORIZED',
  'Auth.TokenExpired': 'TOKEN_EXPIRED',
};

export class ErrorMapper {
  map(agentCoreError: AgentCoreError): OpenCodeError {
    const code = ERROR_MAPPING[agentCoreError.name] || 'UNKNOWN_ERROR';
    
    return {
      code,
      message: agentCoreError.message,
      details: agentCoreError.details,
      retryable: this.isRetryable(agentCoreError),
    };
  }
  
  private isRetryable(error: AgentCoreError): boolean {
    const retryableCodes = [
      'Provider.RateLimited',
      'Network.Timeout',
      'Network.Error',
    ];
    return retryableCodes.includes(error.name);
  }
}
```

### 7.2 Retry Logic

```typescript
// packages/opencode-adapter/src/utils/retry.ts

interface RetryConfig {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
  retryableErrors: string[];
}

export async function withRetry<T>(
  operation: () => Promise<T>,
  config: RetryConfig,
  errorMapper: ErrorMapper
): Promise<T> {
  let lastError: Error;
  
  for (let attempt = 1; attempt <= config.maxAttempts; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error as Error;
      
      const mappedError = errorMapper.map(error as AgentCoreError);
      
      if (!mappedError.retryable || attempt === config.maxAttempts) {
        throw mappedError;
      }
      
      const delay = Math.min(
        config.baseDelayMs * Math.pow(config.backoffMultiplier, attempt - 1),
        config.maxDelayMs
      );
      
      await sleep(delay);
    }
  }
  
  throw lastError!;
}
```

## 8. Testing Strategy

### 8.1 Test Structure

```
packages/opencode-adapter/
├── tests/
│   ├── unit/
│   │   ├── bridge/
│   │   │   ├── session.test.ts
│   │   │   ├── tool.test.ts
│   │   │   └── config.test.ts
│   │   ├── sync/
│   │   │   └── manager.test.ts
│   │   └── utils/
│   │       └── retry.test.ts
│   ├── integration/
│   │   ├── adapter.test.ts
│   │   └── end-to-end.test.ts
│   └── fixtures/
│       ├── sessions.ts
│       ├── messages.ts
│       └── configs.ts
```

### 8.2 Mock Server

```typescript
// tests/mock/agent-core-server.ts

export class MockAgentCoreServer {
  private app: Hono;
  private sessions = new Map<string, Session>();
  
  constructor() {
    this.app = new Hono();
    this.setupRoutes();
  }
  
  private setupRoutes() {
    this.app.post('/session', async (c) => {
      const body = await c.req.json();
      const session = this.createSession(body);
      return c.json(session);
    });
    
    this.app.get('/session/:id', async (c) => {
      const session = this.sessions.get(c.req.param('id'));
      if (!session) return c.json({ error: 'Not found' }, 404);
      return c.json(session);
    });
    
    // ... more routes
  }
  
  listen(port: number): Server {
    return Bun.serve({
      port,
      fetch: this.app.fetch,
    });
  }
}
```

## 9. Package Structure

```
packages/opencode-adapter/
├── package.json
├── tsconfig.json
├── README.md
├── src/
│   ├── index.ts                    # Main exports
│   ├── adapter.ts                  # Core adapter class
│   ├── types.ts                    # Type definitions
│   ├── bridge/
│   │   ├── index.ts
│   │   ├── session.ts
│   │   ├── tool.ts
│   │   ├── config.ts
│   │   └── auth.ts
│   ├── sync/
│   │   ├── index.ts
│   │   ├── manager.ts
│   │   └── conflict.ts
│   ├── client/
│   │   ├── index.ts
│   │   └── http.ts
│   ├── errors/
│   │   ├── index.ts
│   │   └── mapping.ts
│   └── utils/
│       ├── id.ts
│       ├── retry.ts
│       └── transform.ts
├── tests/
│   ├── unit/
│   ├── integration/
│   └── fixtures/
└── scripts/
    └── build.ts
```

## 10. Dependencies

```json
{
  "name": "@adolago/opencode-adapter",
  "version": "0.1.0",
  "dependencies": {
    "@adolago/agent-core": "workspace:*",
    "zod": "^3.x",
    "hono": "^4.x"
  },
  "devDependencies": {
    "@types/bun": "latest",
    "typescript": "^5.x"
  }
}
```
