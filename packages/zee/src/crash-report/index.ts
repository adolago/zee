/**
 * @file Crash Report Module
 * @description Main exports for the crash report system
 */

// Types
export type {
  CrashReportOptions,
  CrashReport,
  ReportMeta,
  SystemInfo,
  ConfigSummary,
  SessionReplay,
  SanitizedMessage,
  SanitizedToolCall,
  DiagnosticSummary,
  LogEntry,
  RedactionStats,
  RedactionPattern,
  RedactionResult,
} from "./types";

// Generator
export { ReportGenerator } from "./report-generator";

// Privacy
export { PrivacyRedactor, getPatterns } from "./privacy";

// Archive
export { ZipBuilder } from "./archive";

// Collectors
export {
  collectSystemInfo,
  collectConfig,
  collectLogs,
  collectSession,
  collectDiagnostics,
} from "./collectors";
