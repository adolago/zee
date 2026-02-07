/**
 * @file Diagnostics Types
 * @description Core type definitions for the health check system
 */

/** Result status of a health check */
export type CheckStatus = "pass" | "warn" | "fail" | "skip"

/** Categories for grouping checks */
export type CheckCategory = "runtime" | "config" | "providers" | "integrity" | "skills" | "security"

/** Severity levels for check results */
export type Severity = "info" | "warning" | "error" | "critical"

/**
 * Result of a single health check
 */
export interface CheckResult {
  /** Unique identifier for this check (e.g., 'runtime.bun-version') */
  id: string

  /** Human-readable name */
  name: string

  /** Category for grouping */
  category: CheckCategory

  /** Result status */
  status: CheckStatus

  /** Human-readable message */
  message: string

  /** Detailed explanation (shown with --verbose) */
  details?: string

  /** Severity level */
  severity: Severity

  /** Duration of check in ms */
  durationMs: number

  /** Can this be auto-fixed? */
  autoFixable: boolean

  /** Fix function (only if autoFixable) */
  fix?: () => Promise<FixResult>

  /** Additional metadata for programmatic use */
  metadata?: Record<string, unknown>
}

/**
 * Result of an auto-fix attempt
 */
export interface FixResult {
  /** Whether the fix succeeded */
  success: boolean

  /** Human-readable message about what was done */
  message: string

  /** Optional rollback function */
  rollback?: () => Promise<void>
}

/**
 * Options for running health checks
 */
export interface CheckOptions {
  /** Run extended checks (slower but more thorough) */
  full: boolean

  /** Attempt to auto-fix issues */
  fix: boolean

  /** Show verbose output */
  verbose: boolean

  /** Specific categories to run (undefined = all) */
  categories?: CheckCategory[]

  /** Timeout per category in ms */
  timeout: number

  /** Skip specific check IDs */
  skip?: string[]
}

/**
 * Summary for a single category
 */
export interface CategorySummary {
  /** Overall status for the category */
  status: "ok" | "warning" | "error"

  /** Number of checks that passed */
  passed: number

  /** Total number of checks in this category */
  total: number

  /** Individual check results */
  checks: CheckResult[]
}

/**
 * Complete health check report
 */
export interface CheckReport {
  /** ISO timestamp of when the check was run */
  timestamp: string

  /** Agent-core version */
  version: string

  /** Machine hostname */
  hostname: string

  /** Summary statistics */
  summary: {
    total: number
    passed: number
    warnings: number
    failed: number
    skipped: number
    fixed: number
  }

  /** Per-category summaries */
  categories: Record<CheckCategory, CategorySummary>

  /** All check results */
  checks: CheckResult[]

  /** All fix attempts */
  fixes: FixResult[]

  /** Total duration in ms */
  durationMs: number
}

/**
 * Check function signature
 */
export type CheckFunction = (options: CheckOptions) => Promise<CheckResult>

/**
 * Category check runner signature
 */
export type CategoryRunner = (options: CheckOptions) => Promise<CheckResult[]>
