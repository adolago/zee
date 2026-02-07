/**
 * @file Crash Report Types
 * @description Type definitions for the crash report generator
 */

/**
 * Options for generating a crash report
 */
export interface CrashReportOptions {
  /** Include session conversation data */
  includeSession: boolean

  /** Number of log lines to include */
  logLines: number

  /** Output path for the report archive */
  outputPath?: string

  /** Skip running diagnostics */
  skipDiagnostics: boolean

  /** Anonymization level */
  anonymization: "minimal" | "standard" | "aggressive"

  /** Non-interactive mode (skip prompts) */
  nonInteractive: boolean
}

/**
 * Complete crash report structure
 */
export interface CrashReport {
  meta: ReportMeta
  system: SystemInfo
  config: ConfigSummary
  session?: SessionReplay
  diagnostics?: DiagnosticSummary
  logs: LogEntry[]
  redactionStats: RedactionStats
}

/**
 * Report metadata
 */
export interface ReportMeta {
  /** Report format version */
  version: string

  /** Generation timestamp */
  generatedAt: string

  /** Report ID */
  id: string

  /** agent-core version */
  agentCoreVersion: string

  /** Anonymization level used */
  anonymization: string
}

/**
 * System information
 */
export interface SystemInfo {
  os: {
    type: string
    platform: string
    release: string
    arch: string
  }
  runtime: {
    bun: string
    node?: string
  }
  shell: string
  terminal?: string
  environment: {
    isDocker: boolean
    isWSL: boolean
    isSSH: boolean
    isTTY: boolean
  }
  resources: {
    memoryMB: number
    cpuCores: number
    loadAverage: number[]
  }
  git?: {
    branch: string
    commit: string
    dirty: boolean
  }
}

/**
 * Sanitized configuration summary
 */
export interface ConfigSummary {
  /** Provider names (no keys) */
  providers: string[]

  /** Enabled features */
  features: string[]

  /** UI theme */
  theme: string

  /** Number of custom keybinds */
  customKeybinds: number

  /** Number of MCP servers */
  mcpServerCount: number

  /** Loaded skill names */
  skills: string[]
}

/**
 * Sanitized session replay
 */
export interface SessionReplay {
  /** Session ID */
  id: string

  /** Session start time */
  startedAt: string

  /** Number of messages */
  messageCount: number

  /** Sanitized messages */
  messages: SanitizedMessage[]

  /** Tool calls made */
  toolCalls: SanitizedToolCall[]
}

/**
 * Sanitized message (content hashed)
 */
export interface SanitizedMessage {
  role: "user" | "assistant" | "system"
  contentHash: string
  contentPreview: string
  timestamp: string
}

/**
 * Sanitized tool call
 */
export interface SanitizedToolCall {
  tool: string
  success: boolean
  durationMs: number
  timestamp: string
}

/**
 * Diagnostic summary
 */
export interface DiagnosticSummary {
  status: "ok" | "warning" | "error"
  passed: number
  warnings: number
  failed: number
  checks: Array<{
    id: string
    status: string
    message: string
  }>
}

/**
 * Log entry for crash report
 */
export interface LogEntry {
  timestamp: string
  level: string
  message: string
  component?: string
}

/**
 * Redaction statistics
 */
export interface RedactionStats {
  totalRedactions: number
  byPattern: Record<string, number>
}

/**
 * Redaction pattern definition
 */
export interface RedactionPattern {
  name: string
  pattern: RegExp
  replacement: string
}

/**
 * Result of redacting content
 */
export interface RedactionResult {
  text: string
  redactionCount: number
}
