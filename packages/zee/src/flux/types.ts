export type FluxDirection = "inbound" | "outbound" | "internal"

export type FluxDomain =
  | "server"
  | "session"
  | "provider"
  | "gateway"
  | "investing"
  | "auth"
  | "security"
  | "mcp"
  | "memory"
  | "domain"

export type FluxStatus = "ok" | "error" | "denied" | "timeout" | "aborted"

export type FluxKind =
  | "api.inbound.request"
  | "api.inbound.response"
  | "api.outbound.request"
  | "api.outbound.response"
  | "token.usage"
  | "token.input"
  | "token.output"
  | "token.cache_read"
  | "token.cache_write"
  | "token.reasoning"
  | "gateway.auth.validated"
  | "gateway.auth.denied"
  | "gateway.rpc.request"
  | "gateway.rpc.response"
  | "gateway.node.lifecycle"
  | "gateway.node.authorization"
  | "secret.resolved"
  | "oauth.refresh.start"
  | "oauth.refresh.success"
  | "oauth.refresh.fail"
  | "auth.legacy_payload.accepted"
  | "auth.policy.checked"
  | "auth.scope.checked"
  | "auth.scope.fallback"
  | "security.audit.checked"
  | "security.audit.finding"
  | "security.audit.alert"
  | "investing.entity.normalized"
  | "investing.ingestion.run"
  | "investing.ingestion.schedule"
  | "agent.legacy_tools_alias.used"
  | "gateway.fallback.invoked"
  | "provider.fallback.used"
  | "provider.fallback.exhausted"
  | "session.message.accepted"
  | "llm.bridge.stream.start"
  | "llm.bridge.stream.done"
  | "llm.bridge.stream.error"
  | "orchestration.pi_agent_event_schema.used"
  | "event"

export type FluxRedaction = "strict" | "balanced" | "debug"

export interface FluxTokenDelta {
  input?: number
  output?: number
  cacheRead?: number
  cacheWrite?: number
  reasoning?: number
  total?: number
}

export interface FluxEvent {
  id: string
  timestamp: number
  traceID: string
  requestID?: string
  sessionID?: string
  messageID?: string
  providerID?: string
  modelID?: string
  direction: FluxDirection
  domain: FluxDomain
  kind: FluxKind
  status: FluxStatus
  method?: string
  path?: string
  route?: string
  host?: string
  url?: string
  statusCode?: number
  latencyMs?: number
  bytesIn?: number
  bytesOut?: number
  token?: FluxTokenDelta
  error?: {
    code?: string
    message?: string
    retryable?: boolean
  }
  metadata?: Record<string, unknown>
}

export interface FluxQuery {
  traceID?: string
  sessionID?: string
  domain?: FluxDomain
  kind?: FluxKind
  from?: number
  to?: number
  limit?: number
  offset?: number
}

export interface FluxStoreConfig {
  enabled: boolean
  retentionMs: number
  maxEvents: number
  maxEventsPerTrace: number
  redaction: FluxRedaction
  logMirror: boolean
}

export interface FluxSessionPath {
  sessionID: string
  traces: string[]
  events: FluxEvent[]
  totals: {
    input: number
    output: number
    cacheRead: number
    cacheWrite: number
    reasoning: number
    total: number
  }
}
