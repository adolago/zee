/**
 * Configuration Interpolation
 *
 * Handles variable interpolation in configuration files:
 * - Environment variables: {env:VAR_NAME}
 * - File includes: {file:path/to/file}
 * - Relative file paths: {file:./relative} or {file:~/home}
 *
 * @module config/interpolation
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

// ============================================================================
// Types
// ============================================================================

export interface InterpolationContext {
  /** Directory containing the config file (for relative file paths) */
  configDir: string;
  /** Environment variables (defaults to process.env) */
  env?: Record<string, string | undefined>;
  /** Whether to throw on missing variables */
  strict?: boolean;
  /** Replacement text for missing env vars when strict=false */
  missingEnvValue?: string;
  /** Replacement text for missing file includes when strict=false */
  missingFileValue?: string;
}

export interface InterpolationResult {
  /** Interpolated text */
  text: string;
  /** Variables that were interpolated */
  interpolated: InterpolatedVariable[];
  /** Variables that were missing (if strict=false) */
  missing: MissingVariable[];
}

export interface InterpolatedVariable {
  type: 'env' | 'file';
  name: string;
  value: string;
  originalMatch: string;
}

export interface MissingVariable {
  type: 'env' | 'file';
  name: string;
  originalMatch: string;
  error?: string;
}

// ============================================================================
// Pattern Matchers
// ============================================================================

/**
 * Pattern for environment variable interpolation: {env:VAR_NAME}
 */
const ENV_PATTERN = /\{env:([^}]+)\}/g;

/**
 * Pattern for file inclusion: {file:path/to/file}
 */
const FILE_PATTERN = /\{file:([^}]+)\}/g;

/**
 * Pattern for escaped braces: \{env:...\} or \{file:...\}
 */
const ESCAPED_PATTERN = /\\(\{(?:env|file):[^}]+\})/g;

// ============================================================================
// Core Interpolation
// ============================================================================

/**
 * Interpolate all variables in a text string
 */
export async function interpolate(
  text: string,
  context: InterpolationContext
): Promise<InterpolationResult> {
  const interpolated: InterpolatedVariable[] = [];
  const missing: MissingVariable[] = [];
  const env = context.env ?? process.env;
  const missingEnvValue = context.missingEnvValue ?? '';
  const missingFileValue = context.missingFileValue ?? '';

  // First, protect escaped patterns by replacing them with placeholders
  const escapedMatches: string[] = [];
  let protectedText = text.replace(ESCAPED_PATTERN, (_, escaped) => {
    escapedMatches.push(escaped);
    return `\x00ESCAPED_${escapedMatches.length - 1}\x00`;
  });

  // Interpolate environment variables
  protectedText = protectedText.replace(ENV_PATTERN, (match, varName) => {
    const value = env[varName];

    if (value !== undefined) {
      interpolated.push({
        type: 'env',
        name: varName,
        value,
        originalMatch: match,
      });
      return value;
    }

    missing.push({
      type: 'env',
      name: varName,
      originalMatch: match,
    });

    if (context.strict) {
      throw new InterpolationError(
        `Missing environment variable: ${varName}`,
        { type: 'env', name: varName }
      );
    }

    return missingEnvValue; // Replace with configured missing value if not strict
  });

  // Interpolate file includes
  const fileMatches = Array.from(protectedText.matchAll(FILE_PATTERN));
  for (const match of fileMatches) {
    const [fullMatch, filePath] = match;

    // Skip if in a comment line (JSONC support)
    const lines = protectedText.split('\n');
    const lineWithMatch = lines.find(line => line.includes(fullMatch));
    if (lineWithMatch?.trim().startsWith('//')) {
      continue;
    }

    try {
      const resolvedPath = resolveFilePath(filePath, context.configDir);
      const fileContent = await fs.readFile(resolvedPath, 'utf-8');

      interpolated.push({
        type: 'file',
        name: filePath,
        value: fileContent.trim(),
        originalMatch: fullMatch,
      });

      // Escape the content for JSON embedding
      const escapedContent = JSON.stringify(fileContent.trim()).slice(1, -1);
      protectedText = protectedText.replace(fullMatch, escapedContent);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      missing.push({
        type: 'file',
        name: filePath,
        originalMatch: fullMatch,
        error: errorMessage,
      });

      if (context.strict) {
        throw new InterpolationError(
          `Failed to read file: ${filePath} (${errorMessage})`,
          { type: 'file', name: filePath }
        );
      }

      // Replace with configured missing value if not strict
      protectedText = protectedText.replace(fullMatch, missingFileValue);
    }
  }

  // Restore escaped patterns (remove escape character)
  let resultText = protectedText;
  escapedMatches.forEach((escaped, index) => {
    resultText = resultText.replace(`\x00ESCAPED_${index}\x00`, escaped);
  });

  return {
    text: resultText,
    interpolated,
    missing,
  };
}

/**
 * Interpolate environment variables only (synchronous)
 */
export function interpolateEnv(
  text: string,
  env: Record<string, string | undefined> = process.env
): string {
  return text.replace(ENV_PATTERN, (_match, varName) => {
    return env[varName] ?? '';
  });
}

/**
 * Check if a string contains interpolation patterns
 */
export function hasInterpolation(text: string): boolean {
  return ENV_PATTERN.test(text) || FILE_PATTERN.test(text);
}

/**
 * Extract all interpolation patterns from text without resolving them
 */
export function extractPatterns(text: string): {
  env: string[];
  file: string[];
} {
  const envMatches = Array.from(text.matchAll(ENV_PATTERN));
  const fileMatches = Array.from(text.matchAll(FILE_PATTERN));

  return {
    env: envMatches.map(m => m[1]),
    file: fileMatches.map(m => m[1]),
  };
}

// ============================================================================
// File Path Resolution
// ============================================================================

/**
 * Resolve a file path from interpolation syntax
 * Supports:
 * - Absolute paths: /home/user/file
 * - Relative paths: ./file or ../file
 * - Home directory: ~/file
 */
export function resolveFilePath(filePath: string, configDir: string): string {
  // Handle home directory expansion
  if (filePath.startsWith('~/')) {
    return path.join(os.homedir(), filePath.slice(2));
  }

  // Handle absolute paths
  if (path.isAbsolute(filePath)) {
    return filePath;
  }

  // Handle relative paths
  return path.resolve(configDir, filePath);
}

// ============================================================================
// Deep Interpolation for Objects
// ============================================================================

/**
 * Recursively interpolate all string values in an object
 */
export async function interpolateObject<T extends Record<string, unknown>>(
  obj: T,
  context: InterpolationContext
): Promise<{ result: T; stats: InterpolationStats }> {
  const stats: InterpolationStats = {
    totalInterpolated: 0,
    envVars: 0,
    files: 0,
    missing: 0,
  };

  async function processValue(value: unknown): Promise<unknown> {
    if (typeof value === 'string') {
      if (!hasInterpolation(value)) {
        return value;
      }

      const result = await interpolate(value, context);
      stats.totalInterpolated += result.interpolated.length;
      stats.envVars += result.interpolated.filter(i => i.type === 'env').length;
      stats.files += result.interpolated.filter(i => i.type === 'file').length;
      stats.missing += result.missing.length;

      return result.text;
    }

    if (Array.isArray(value)) {
      return Promise.all(value.map(processValue));
    }

    if (value !== null && typeof value === 'object') {
      const result: Record<string, unknown> = {};
      for (const [key, val] of Object.entries(value)) {
        result[key] = await processValue(val);
      }
      return result;
    }

    return value;
  }

  const result = await processValue(obj) as T;
  return { result, stats };
}

export interface InterpolationStats {
  totalInterpolated: number;
  envVars: number;
  files: number;
  missing: number;
}

// ============================================================================
// Secret Detection
// ============================================================================

/**
 * Common patterns that indicate sensitive values
 */
const SECRET_PATTERNS = [
  /api[_-]?key/i,
  /secret/i,
  /password/i,
  /token/i,
  /credential/i,
  /auth/i,
  /private[_-]?key/i,
];

/**
 * Check if a config key name suggests it contains sensitive data
 */
export function isSensitiveKey(key: string): boolean {
  return SECRET_PATTERNS.some(pattern => pattern.test(key));
}

/**
 * Mask sensitive values in config for logging
 */
export function maskSensitiveValues<T extends Record<string, unknown>>(
  obj: T,
  mask: string = '***'
): T {
  function processValue(value: unknown, key: string): unknown {
    if (typeof value === 'string' && isSensitiveKey(key)) {
      if (value.length > 8) {
        return value.slice(0, 4) + mask + value.slice(-4);
      }
      return mask;
    }

    if (Array.isArray(value)) {
      return value.map((v, i) => processValue(v, `${key}[${i}]`));
    }

    if (value !== null && typeof value === 'object') {
      const result: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value)) {
        result[k] = processValue(v, k);
      }
      return result;
    }

    return value;
  }

  return processValue(obj, '') as T;
}

// ============================================================================
// Error Types
// ============================================================================

export class InterpolationError extends Error {
  public readonly variable: { type: 'env' | 'file'; name: string };

  constructor(message: string, variable: { type: 'env' | 'file'; name: string }) {
    super(message);
    this.name = 'InterpolationError';
    this.variable = variable;
  }
}

// ============================================================================
// Validation Helpers
// ============================================================================

/**
 * Validate that all required environment variables are set
 */
export function validateRequiredEnvVars(
  text: string,
  env: Record<string, string | undefined> = process.env
): { valid: boolean; missing: string[] } {
  const patterns = extractPatterns(text);
  const missing = patterns.env.filter(varName => !env[varName]);

  return {
    valid: missing.length === 0,
    missing,
  };
}

/**
 * Generate a template showing all interpolation patterns
 */
export function generateEnvTemplate(text: string): string {
  const patterns = extractPatterns(text);
  const lines = [
    '# Environment variables required by this configuration',
    '',
  ];

  for (const varName of [...new Set(patterns.env)]) {
    lines.push(`${varName}=`);
  }

  if (patterns.file.length > 0) {
    lines.push('');
    lines.push('# Files referenced by this configuration:');
    for (const filePath of [...new Set(patterns.file)]) {
      lines.push(`# - ${filePath}`);
    }
  }

  return lines.join('\n');
}
