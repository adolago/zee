/**
 * Common Tool Utilities
 *
 * Shared utilities for tool parameter parsing and result formatting.
 * Ported from zee's tools/common.ts for cross-context reuse.
 */

import type { ToolExecutionResult, ToolMetadata } from '../types';

// ============================================================================
// Parameter Parsing
// ============================================================================

export interface StringParamOptions {
  required?: boolean;
  trim?: boolean;
  label?: string;
}

/**
 * Safely extract a string parameter with validation
 */
export function readStringParam(
  params: Record<string, unknown>,
  key: string,
  options: StringParamOptions & { required: true }
): string;
export function readStringParam(
  params: Record<string, unknown>,
  key: string,
  options?: StringParamOptions
): string | undefined;
export function readStringParam(
  params: Record<string, unknown>,
  key: string,
  options: StringParamOptions = {}
): string | undefined {
  const { required = false, trim = true, label = key } = options;
  const raw = params[key];
  if (typeof raw !== 'string') {
    if (required) throw new Error(`${label} required`);
    return undefined;
  }
  const value = trim ? raw.trim() : raw;
  if (!value) {
    if (required) throw new Error(`${label} required`);
    return undefined;
  }
  return value;
}

/**
 * Safely extract a string array parameter (also handles single string → array)
 */
export function readStringArrayParam(
  params: Record<string, unknown>,
  key: string,
  options: StringParamOptions & { required: true }
): string[];
export function readStringArrayParam(
  params: Record<string, unknown>,
  key: string,
  options?: StringParamOptions
): string[] | undefined;
export function readStringArrayParam(
  params: Record<string, unknown>,
  key: string,
  options: StringParamOptions = {}
): string[] | undefined {
  const { required = false, label = key } = options;
  const raw = params[key];
  if (Array.isArray(raw)) {
    const values = raw
      .filter((entry) => typeof entry === 'string')
      .map((entry) => entry.trim())
      .filter(Boolean);
    if (values.length === 0) {
      if (required) throw new Error(`${label} required`);
      return undefined;
    }
    return values;
  }
  if (typeof raw === 'string') {
    const value = raw.trim();
    if (!value) {
      if (required) throw new Error(`${label} required`);
      return undefined;
    }
    return [value];
  }
  if (required) throw new Error(`${label} required`);
  return undefined;
}

/**
 * Safely extract a number parameter with validation
 */
export function readNumberParam(
  params: Record<string, unknown>,
  key: string,
  options: StringParamOptions & { required: true }
): number;
export function readNumberParam(
  params: Record<string, unknown>,
  key: string,
  options?: StringParamOptions
): number | undefined;
export function readNumberParam(
  params: Record<string, unknown>,
  key: string,
  options: StringParamOptions = {}
): number | undefined {
  const { required = false, label = key } = options;
  const raw = params[key];
  if (typeof raw === 'number' && !Number.isNaN(raw)) {
    return raw;
  }
  if (typeof raw === 'string') {
    const parsed = Number(raw);
    if (!Number.isNaN(parsed)) return parsed;
  }
  if (required) throw new Error(`${label} required`);
  return undefined;
}

/**
 * Safely extract a boolean parameter with validation
 */
export function readBooleanParam(
  params: Record<string, unknown>,
  key: string,
  defaultValue?: boolean
): boolean {
  const raw = params[key];
  if (typeof raw === 'boolean') return raw;
  if (typeof raw === 'string') {
    const lower = raw.toLowerCase();
    if (lower === 'true' || lower === '1' || lower === 'yes') return true;
    if (lower === 'false' || lower === '0' || lower === 'no') return false;
  }
  return defaultValue ?? false;
}

// ============================================================================
// Result Formatting
// ============================================================================

/**
 * Create a JSON-formatted tool result
 */
export function jsonResult<M extends ToolMetadata = ToolMetadata>(
  payload: unknown,
  options: { title?: string } = {}
): ToolExecutionResult<M> {
  return {
    title: options.title ?? 'Result',
    metadata: (payload && typeof payload === 'object' ? payload : {}) as M,
    output: JSON.stringify(payload, null, 2),
  };
}

/**
 * Create a text tool result
 */
export function textResult<M extends ToolMetadata = ToolMetadata>(
  text: string,
  options: { title?: string; metadata?: M } = {}
): ToolExecutionResult<M> {
  return {
    title: options.title ?? 'Result',
    metadata: options.metadata ?? ({} as M),
    output: text,
  };
}

/**
 * Create an error result
 */
export function errorResult(
  error: Error | string,
  options: { title?: string } = {}
): ToolExecutionResult<{ error: string }> {
  const message = error instanceof Error ? error.message : error;
  return {
    title: options.title ?? 'Error',
    metadata: { error: message },
    output: `Error: ${message}`,
  };
}

/**
 * Create a success/status result
 */
export function statusResult(
  status: 'ok' | 'accepted' | 'pending' | 'failed',
  details?: Record<string, unknown>
): ToolExecutionResult<{ status: string } & Record<string, unknown>> {
  const payload = { status, ...details };
  return {
    title: status === 'ok' ? 'Success' : status.charAt(0).toUpperCase() + status.slice(1),
    metadata: payload,
    output: JSON.stringify(payload, null, 2),
  };
}
