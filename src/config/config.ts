/**
 * Configuration Loading and Merging
 *
 * Implements the hierarchical configuration system:
 * 1. Defaults (built-in)
 * 2. Global (~/.config/zee/)
 * 3. Project (.zee/ in project root)
 * 4. Environment (ZEE_* variables)
 * 5. Runtime (programmatic overrides)
 *
 * @module config/config
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { parse as parseJsonc, type ParseError as JsoncParseError, printParseErrorCode } from 'jsonc-parser';

import {
  validateConfig,
  type Config,
  type ConfigValidationError,
  type AgentConfig,
} from './schema';
import {
  DEFAULT_CONFIG,
  getGlobalConfigDir,
  CONFIG_FILE_NAMES,
  CONFIG_DIR_NAMES,
  ENV_VAR_MAPPING,
  getDefaultsForSurface,
} from './defaults';
import {
  interpolate,
  maskSensitiveValues,
  type InterpolationContext,
} from './interpolation';

// ========================================================================
// Missing interpolation sentinels
// ========================================================================

const MISSING_ENV_SENTINEL = '__ZEE_MISSING_ENV__';
const MISSING_FILE_SENTINEL = '__ZEE_MISSING_FILE__';

// ============================================================================
// Types
// ============================================================================

export interface ConfigLoadOptions {
  /** Override the project directory (defaults to cwd) */
  projectDir?: string;
  /** Override the global config directory */
  globalDir?: string;
  /** Runtime configuration overrides */
  overrides?: Partial<Config>;
  /** Active surface for surface-specific defaults */
  surface?: 'stanley' | 'zee' | 'cli' | 'web';
  /** Whether to throw on validation errors */
  strict?: boolean;
  /** Custom environment variables */
  env?: Record<string, string | undefined>;
}

export interface LoadedConfig {
  /** The merged and validated configuration */
  config: Config;
  /** Directories that were searched */
  searchedDirs: string[];
  /** Files that were loaded */
  loadedFiles: string[];
  /** Validation warnings (non-fatal) */
  warnings: ConfigWarning[];
  /** Source information for each config key */
  sources: ConfigSources;
}

export interface ConfigWarning {
  message: string;
  path?: string;
  suggestion?: string;
}

export interface ConfigSources {
  [path: string]: 'default' | 'global' | 'project' | 'env' | 'runtime';
}

// ============================================================================
// Config State
// ============================================================================

let cachedConfig: LoadedConfig | null = null;

// ============================================================================
// Main API
// ============================================================================

/**
 * Load configuration with full hierarchy merging
 */
export async function loadConfig(options: ConfigLoadOptions = {}): Promise<LoadedConfig> {
  const projectDir = options.projectDir ?? process.cwd();
  const globalDir = options.globalDir ?? getGlobalConfigDir();
  const env = options.env ?? process.env;

  const searchedDirs: string[] = [];
  const loadedFiles: string[] = [];
  const warnings: ConfigWarning[] = [];
  const sources: ConfigSources = {};

  // Start with defaults
  let config = deepClone(DEFAULT_CONFIG);
  markSources(sources, config, 'default');

  // Apply surface-specific defaults if specified
  if (options.surface) {
    const surfaceDefaults = getDefaultsForSurface(options.surface);
    config = deepMerge(config, surfaceDefaults);
    markSources(sources, surfaceDefaults, 'default');
  }

  // Load global configuration
  const globalConfigs = await loadConfigDirectory(globalDir, env);
  searchedDirs.push(globalDir);
  for (const { file, config: globalConfig } of globalConfigs) {
    loadedFiles.push(file);
    config = deepMerge(config, globalConfig);
    markSources(sources, globalConfig, 'global');
  }

  // Find and load project configuration (search upward)
  const projectConfigDirs = await findProjectConfigDirs(projectDir);
  for (const dir of projectConfigDirs) {
    searchedDirs.push(dir);
    const projectConfigs = await loadConfigDirectory(dir, env);
    for (const { file, config: projectConfig } of projectConfigs) {
      loadedFiles.push(file);
      config = deepMerge(config, projectConfig);
      markSources(sources, projectConfig, 'project');
    }
  }

  // Apply environment variable overrides
  const envOverrides = loadEnvOverrides(env);
  if (Object.keys(envOverrides).length > 0) {
    config = deepMerge(config, envOverrides);
    markSources(sources, envOverrides, 'env');
  }

  // Apply runtime overrides
  if (options.overrides) {
    config = deepMerge(config, options.overrides);
    markSources(sources, options.overrides, 'runtime');
  }

  // Validate the final configuration
  const validation = validateConfig(config);
  if (!validation.success) {
    if (options.strict) {
      throw new ConfigValidationErrorAggregate(validation.errors);
    }

    // Add warnings for validation issues
    for (const error of validation.errors) {
      warnings.push({
        message: error.message,
        path: error.path,
        suggestion: error.suggestion,
      });
    }
  }

  // Ensure required fields have values
  config = applyRequiredDefaults(config);

  const result: LoadedConfig = {
    config: validation.success ? validation.data : config as Config,
    searchedDirs,
    loadedFiles,
    warnings,
    sources,
  };

  return result;
}

/**
 * Get cached configuration or load it
 */
export async function getConfig(options?: ConfigLoadOptions): Promise<Config> {
  if (!cachedConfig || options) {
    cachedConfig = await loadConfig(options);
  }
  return cachedConfig.config;
}

/**
 * Get the full loaded config with metadata
 */
export async function getLoadedConfig(options?: ConfigLoadOptions): Promise<LoadedConfig> {
  if (!cachedConfig || options) {
    cachedConfig = await loadConfig(options);
  }
  return cachedConfig;
}

/**
 * Reload configuration (clears cache)
 */
export async function reloadConfig(options?: ConfigLoadOptions): Promise<LoadedConfig> {
  cachedConfig = null;
  return loadConfig(options);
}

/**
 * Clear the configuration cache
 */
export function clearConfigCache(): void {
  cachedConfig = null;
}

// ============================================================================
// File Loading
// ============================================================================

/**
 * Load all configuration files from a directory
 */
async function loadConfigDirectory(
  dir: string,
  env: Record<string, string | undefined>
): Promise<Array<{ file: string; config: Partial<Config> }>> {
  const results: Array<{ file: string; config: Partial<Config> }> = [];

  // Check if directory exists
  try {
    await fs.access(dir);
  } catch {
    return results;
  }

  // Load config files
  for (const fileName of CONFIG_FILE_NAMES) {
    const filePath = path.join(dir, fileName);
    try {
      const config = await loadConfigFile(filePath, env);
      if (config) {
        results.push({ file: filePath, config });
      }
    } catch (error) {
      // File doesn't exist or is invalid - continue
      if (error instanceof ConfigFileError) {
        throw error; // Re-throw parse errors
      }
    }
  }

  // Load agent definitions from agent/ subdirectory
  const agentDir = path.join(dir, 'agent');
  try {
    const agentConfigs = await loadAgentDirectory(agentDir);
    if (Object.keys(agentConfigs).length > 0) {
      results.push({
        file: agentDir,
        config: { agent: agentConfigs },
      });
    }
  } catch {
    // Agent directory doesn't exist - continue
  }

  return results;
}

/**
 * Load a single configuration file
 */
async function loadConfigFile(
  filePath: string,
  env: Record<string, string | undefined>
): Promise<Partial<Config> | null> {
  let text: string;

  try {
    text = await fs.readFile(filePath, 'utf-8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    throw error;
  }

  // Interpolate variables
  const context: InterpolationContext = {
    configDir: path.dirname(filePath),
    env,
    strict: false,
    missingEnvValue: MISSING_ENV_SENTINEL,
    missingFileValue: MISSING_FILE_SENTINEL,
  };

  const interpolated = await interpolate(text, context);

  // Parse JSONC
  const errors: JsoncParseError[] = [];
  const data = parseJsonc(interpolated.text, errors, { allowTrailingComma: true });

  if (errors.length > 0) {
    const errorDetails = formatJsoncErrors(interpolated.text, errors);
    throw new ConfigFileError(filePath, `Invalid JSON:\n${errorDetails}`);
  }

  const cleaned = stripMissingInterpolations(data);
  return cleaned as Partial<Config>;
}

/**
 * Load agent definitions from markdown files
 */
async function loadAgentDirectory(
  dir: string
): Promise<Record<string, AgentConfig>> {
  const agents: Record<string, AgentConfig> = {};

  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.md')) {
        continue;
      }

      const filePath = path.join(dir, entry.name);
      const agentName = entry.name.replace(/\.md$/, '');

      try {
        const content = await fs.readFile(filePath, 'utf-8');
        const agent = parseAgentMarkdown(content);
        if (agent) {
          agents[agentName] = agent;
        }
      } catch {
        // Skip invalid agent files
      }
    }
  } catch {
    // Directory doesn't exist
  }

  return agents;
}

/**
 * Parse agent definition from markdown with YAML frontmatter
 */
function parseAgentMarkdown(content: string): AgentConfig | null {
  // Check for YAML frontmatter
  const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);

  if (!frontmatterMatch) {
    // No frontmatter - treat entire content as prompt
    return {
      prompt: content.trim(),
    };
  }

  const [, frontmatter, body] = frontmatterMatch;

  // Simple YAML parsing for common fields
  const agent: AgentConfig = {
    prompt: body.trim(),
  };

  // Parse frontmatter lines
  for (const line of frontmatter.split('\n')) {
    const match = line.match(/^(\w+):\s*(.+)$/);
    if (!match) continue;

    const [, key, value] = match;

    switch (key) {
      case 'model':
        agent.model = value;
        break;
      case 'temperature':
        agent.temperature = parseFloat(value);
        break;
      case 'top_p':
        agent.top_p = parseFloat(value);
        break;
      case 'description':
        agent.description = value;
        break;
      case 'mode':
        if (['subagent', 'primary', 'all'].includes(value)) {
          agent.mode = value as 'subagent' | 'primary' | 'all';
        }
        break;
      case 'color':
        agent.color = value;
        break;
      case 'maxSteps':
        agent.maxSteps = parseInt(value, 10);
        break;
      case 'disable':
        agent.disable = value === 'true';
        break;
    }
  }

  return agent;
}

// ============================================================================
// Project Directory Discovery
// ============================================================================

/**
 * Find config directories by searching upward from project directory
 */
async function findProjectConfigDirs(startDir: string): Promise<string[]> {
  const dirs: string[] = [];
  let currentDir = startDir;
  const root = path.parse(currentDir).root;

  while (currentDir !== root) {
    for (const dirName of CONFIG_DIR_NAMES) {
      const configDir = path.join(currentDir, dirName);
      try {
        const stat = await fs.stat(configDir);
        if (stat.isDirectory()) {
          dirs.push(configDir);
        }
      } catch {
        // Directory doesn't exist
      }
    }

    // Also check for config files in the directory itself
    for (const fileName of CONFIG_FILE_NAMES) {
      const filePath = path.join(currentDir, fileName);
      try {
        await fs.access(filePath);
        if (!dirs.includes(currentDir)) {
          dirs.push(currentDir);
        }
      } catch {
        // File doesn't exist
      }
    }

    // Check if we've hit a repository root or home directory
    const gitDir = path.join(currentDir, '.git');
    try {
      await fs.access(gitDir);
      break; // Stop at repository root
    } catch {
      // Not a git repo - continue upward
    }

    if (currentDir === os.homedir()) {
      break; // Don't go above home directory
    }

    currentDir = path.dirname(currentDir);
  }

  // Return in reverse order (most specific last)
  return dirs.reverse();
}

// ============================================================================
// Environment Variable Loading
// ============================================================================

/**
 * Load configuration from environment variables
 */
function loadEnvOverrides(
  env: Record<string, string | undefined>
): Partial<Config> {
  const overrides: Record<string, unknown> = {};

  for (const [envVar, configPath] of Object.entries(ENV_VAR_MAPPING)) {
    const value = env[envVar];
    if (value === undefined) continue;

    setNestedValue(overrides, configPath, parseEnvValue(value));
  }

  // Inline JSON config content override.
  const inlineConfig = env["ZEE_CONFIG_CONTENT"];
  if (inlineConfig) {
    try {
      const parsed = JSON.parse(inlineConfig);
      return deepMerge(overrides as Partial<Config>, parsed);
    } catch {
      // Invalid JSON - ignore
    }
  }

  return overrides as Partial<Config>;
}

/**
 * Parse environment variable value to appropriate type
 */
function parseEnvValue(value: string): unknown {
  // Boolean
  if (value === 'true') return true;
  if (value === 'false') return false;

  // Number
  const num = Number(value);
  if (!isNaN(num) && value.trim() !== '') return num;

  // JSON
  if (value.startsWith('{') || value.startsWith('[')) {
    try {
      return JSON.parse(value);
    } catch {
      // Not valid JSON - return as string
    }
  }

  return value;
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Deep clone an object
 */
function deepClone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj));
}

/**
 * Strip unresolved interpolation values from parsed config.
 */
function stripMissingInterpolations(value: unknown): unknown {
  if (typeof value === 'string') {
    if (value.includes(MISSING_ENV_SENTINEL) || value.includes(MISSING_FILE_SENTINEL)) {
      return undefined;
    }
    return value;
  }

  if (Array.isArray(value)) {
    return value
      .map(stripMissingInterpolations)
      .filter((item) => item !== undefined);
  }

  if (value !== null && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value)) {
      const cleaned = stripMissingInterpolations(val);
      if (cleaned !== undefined) {
        result[key] = cleaned;
      }
    }
    return result;
  }

  return value;
}

/**
 * Deep merge two objects (source into target)
 */
function deepMerge<T extends Record<string, unknown>>(
  target: T,
  source: Partial<T>
): T {
  const result = { ...target };

  for (const key of Object.keys(source) as Array<keyof T>) {
    const sourceValue = source[key];
    const targetValue = result[key];

    if (
      sourceValue !== null &&
      typeof sourceValue === 'object' &&
      !Array.isArray(sourceValue) &&
      targetValue !== null &&
      typeof targetValue === 'object' &&
      !Array.isArray(targetValue)
    ) {
      result[key] = deepMerge(
        targetValue as Record<string, unknown>,
        sourceValue as Record<string, unknown>
      ) as T[keyof T];
    } else if (Array.isArray(sourceValue) && Array.isArray(targetValue)) {
      // Concatenate arrays (e.g., plugins)
      result[key] = [...new Set([...targetValue, ...sourceValue])] as T[keyof T];
    } else if (sourceValue !== undefined) {
      result[key] = sourceValue as T[keyof T];
    }
  }

  return result;
}

/**
 * Set a nested value in an object using dot notation path
 */
function setNestedValue(
  obj: Record<string, unknown>,
  path: string,
  value: unknown
): void {
  const parts = path.split('.');
  let current = obj;

  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    if (!(part in current) || typeof current[part] !== 'object') {
      current[part] = {};
    }
    current = current[part] as Record<string, unknown>;
  }

  current[parts[parts.length - 1]] = value;
}

/**
 * Mark config sources for debugging
 */
function markSources(
  sources: ConfigSources,
  config: Partial<Config>,
  source: ConfigSources[string],
  prefix: string = ''
): void {
  for (const [key, value] of Object.entries(config)) {
    const path = prefix ? `${prefix}.${key}` : key;

    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      markSources(sources, value as Partial<Config>, source, path);
    } else {
      sources[path] = source;
    }
  }
}

/**
 * Apply required defaults for missing values
 */
function applyRequiredDefaults(config: Partial<Config>): Config {
  return {
    ...DEFAULT_CONFIG,
    ...config,
    agent: {
      ...DEFAULT_CONFIG.agent,
      ...config.agent,
    },
    surface: {
      ...DEFAULT_CONFIG.surface,
      ...config.surface,
    },
    memory: {
      ...DEFAULT_CONFIG.memory,
      ...config.memory,
    },
    permission: {
      ...DEFAULT_CONFIG.permission,
      ...config.permission,
    },
  } as Config;
}

/**
 * Format JSONC parse errors for display
 */
function formatJsoncErrors(text: string, errors: JsoncParseError[]): string {
  const lines = text.split('\n');

  return errors.map(error => {
    const beforeOffset = text.substring(0, error.offset).split('\n');
    const line = beforeOffset.length;
    const column = beforeOffset[beforeOffset.length - 1].length + 1;
    const problemLine = lines[line - 1] || '';

    const errorMsg = `${printParseErrorCode(error.error)} at line ${line}, column ${column}`;
    const pointer = ' '.repeat(column + 9) + '^';

    return `${errorMsg}\n   Line ${line}: ${problemLine}\n${pointer}`;
  }).join('\n\n');
}

// ============================================================================
// Error Types
// ============================================================================

export class ConfigFileError extends Error {
  constructor(
    public readonly filePath: string,
    message: string
  ) {
    super(`Configuration error in ${filePath}: ${message}`);
    this.name = 'ConfigFileError';
  }
}

export class ConfigValidationErrorAggregate extends Error {
  constructor(public readonly errors: ConfigValidationError[]) {
    const messages = errors.map(e =>
      `  - ${e.path}: ${e.message}${e.suggestion ? ` (${e.suggestion})` : ''}`
    ).join('\n');
    super(`Configuration validation failed:\n${messages}`);
    this.name = 'ConfigValidationError';
  }
}

// ============================================================================
// Debug Utilities
// ============================================================================

/**
 * Get a debug view of the loaded configuration
 */
export async function debugConfig(options?: ConfigLoadOptions): Promise<{
  config: Config;
  masked: Config;
  sources: ConfigSources;
  loadedFiles: string[];
  searchedDirs: string[];
  warnings: ConfigWarning[];
}> {
  const loaded = await getLoadedConfig(options);

  return {
    config: loaded.config,
    masked: maskSensitiveValues(loaded.config),
    sources: loaded.sources,
    loadedFiles: loaded.loadedFiles,
    searchedDirs: loaded.searchedDirs,
    warnings: loaded.warnings,
  };
}

/**
 * Get the effective value for a config path with source info
 */
export async function getConfigValue(
  path: string,
  options?: ConfigLoadOptions
): Promise<{ value: unknown; source: string }> {
  const loaded = await getLoadedConfig(options);

  const parts = path.split('.');
  let value: unknown = loaded.config;

  for (const part of parts) {
    if (value === null || typeof value !== 'object') {
      return { value: undefined, source: 'not found' };
    }
    value = (value as Record<string, unknown>)[part];
  }

  return {
    value,
    source: loaded.sources[path] || 'default',
  };
}
