/**
 * @file Diagnostics Module
 * @description Main exports for the health check system
 */

// Types
export type {
  CheckStatus,
  CheckCategory,
  Severity,
  CheckResult,
  FixResult,
  CheckOptions,
  CategorySummary,
  CheckReport,
  CheckFunction,
  CategoryRunner,
} from "./types";

// Engine
export { CheckEngine } from "./check-engine";

// Reporters
export { InteractiveReporter, JsonReporter, MinimalReporter } from "./reporters";

// Check runners (for direct use if needed)
export {
  runRuntimeChecks,
  runConfigChecks,
  runProviderChecks,
  runIntegrityChecks,
} from "./checks";
