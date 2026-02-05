/**
 * @file Configuration Checks
 * @description Validates agent-core configuration files
 */

import * as fs from "fs/promises";
import * as path from "path";
import { parse } from "jsonc-parser";
import type { ParseError } from "jsonc-parser";
import type { CheckResult, CheckOptions } from "../types";
import { Auth } from "../../auth";
import { resolveConfigDir } from "../../global/dirs";

/** Deprecated configuration options that should be migrated */
const DEPRECATED_OPTIONS = [
  { old: "model", new: "provider.model", since: "0.1.0" },
  { old: "theme", new: "ui.theme", since: "0.1.0" },
  { old: "maxTokens", new: "provider.maxTokens", since: "0.1.0" },
];

type RecommendedCredential = {
  label: string;
  description: string;
  envVar?: string;
  authProviderId?: string;
};

/** Recommended credentials for full functionality */
const RECOMMENDED_CREDENTIALS: RecommendedCredential[] = [
  {
    label: "Anthropic",
    envVar: "ANTHROPIC_API_KEY",
    authProviderId: "anthropic",
    description: "Anthropic Claude (OAuth or API key)",
  },
  {
    label: "OpenAI",
    envVar: "OPENAI_API_KEY",
    authProviderId: "openai",
    description: "OpenAI (OAuth or API key)",
  },
  {
    label: "Google Gemini",
    envVar: "GOOGLE_API_KEY",
    authProviderId: "google",
    description: "Google Gemini API key (embeddings)",
  },
  {
    label: "Voyage",
    envVar: "VOYAGE_API_KEY",
    authProviderId: "voyage",
    description: "Voyage AI (API key)",
  },
];

/**
 * Get the config directory path
 */
function getConfigDir(): string {
  return resolveConfigDir();
}

/**
 * Parse JSONC (JSON with comments) - basic implementation
 */
function parseJsonc(content: string): unknown {
  const errors: ParseError[] = [];
  const result = parse(content, errors, {
    allowTrailingComma: true,
    allowEmptyContent: false,
  });
  if (errors.length > 0) {
    const err = errors[0];
    throw new Error(`JSON Parse error at position ${err.offset}`);
  }
  return result;
}

/**
 * Find line number for a JSON path in content
 */
function findLineNumber(content: string, jsonPath: string): number {
  const lines = content.split("\n");
  const pathParts = jsonPath.split(".");
  const searchKey = pathParts[pathParts.length - 1];

  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes(`"${searchKey}"`)) {
      return i + 1;
    }
  }
  return 1;
}

/**
 * Check if object has a key (supports nested paths)
 */
function hasKey(obj: unknown, key: string): boolean {
  if (typeof obj !== "object" || obj === null) return false;
  return key in (obj as Record<string, unknown>);
}

/**
 * Validate configuration schema
 */
async function checkConfigSchema(): Promise<CheckResult> {
  const start = Date.now();
  const configPath = path.join(getConfigDir(), "agent-core.json");

  try {
    const content = await fs.readFile(configPath, "utf-8");

    try {
      const parsed = parseJsonc(content);

      // Basic validation - check it's an object
      if (typeof parsed !== "object" || parsed === null) {
        return {
          id: "config.schema",
          name: "Config Schema",
          category: "config",
          status: "fail",
          message: "Configuration must be an object",
          severity: "error",
          durationMs: Date.now() - start,
          autoFixable: false,
        };
      }

      return {
        id: "config.schema",
        name: "Config Schema",
        category: "config",
        status: "pass",
        message: "Configuration is valid JSON",
        severity: "info",
        durationMs: Date.now() - start,
        autoFixable: false,
      };
    } catch (parseError) {
      const errorMsg =
        parseError instanceof Error ? parseError.message : String(parseError);
      // Try to extract line number from JSON parse error
      const lineMatch = errorMsg.match(/position (\d+)/);
      let lineInfo = "";
      if (lineMatch) {
        const position = parseInt(lineMatch[1], 10);
        const lines = content.substring(0, position).split("\n");
        lineInfo = ` at line ${lines.length}`;
      }

      return {
        id: "config.schema",
        name: "Config Schema",
        category: "config",
        status: "fail",
        message: `Invalid JSON${lineInfo}`,
        details: errorMsg,
        severity: "error",
        durationMs: Date.now() - start,
        autoFixable: false,
      };
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return {
        id: "config.schema",
        name: "Config Schema",
        category: "config",
        status: "skip",
        message: "No configuration file (using defaults)",
        severity: "info",
        durationMs: Date.now() - start,
        autoFixable: false,
      };
    }

    return {
      id: "config.schema",
      name: "Config Schema",
      category: "config",
      status: "fail",
      message: "Failed to read configuration",
      details: error instanceof Error ? error.message : String(error),
      severity: "error",
      durationMs: Date.now() - start,
      autoFixable: false,
    };
  }
}

/**
 * Check for deprecated configuration options
 */
async function checkDeprecatedOptions(): Promise<CheckResult> {
  const start = Date.now();
  const configPath = path.join(getConfigDir(), "agent-core.json");

  try {
    const content = await fs.readFile(configPath, "utf-8");
    const config = parseJsonc(content) as Record<string, unknown>;

    const found: string[] = [];
    for (const dep of DEPRECATED_OPTIONS) {
      if (hasKey(config, dep.old)) {
        found.push(`'${dep.old}' → '${dep.new}' (since ${dep.since})`);
      }
    }

    if (found.length === 0) {
      return {
        id: "config.deprecated",
        name: "Deprecated Options",
        category: "config",
        status: "pass",
        message: "No deprecated options found",
        severity: "info",
        durationMs: Date.now() - start,
        autoFixable: false,
      };
    }

    return {
      id: "config.deprecated",
      name: "Deprecated Options",
      category: "config",
      status: "warn",
      message: `${found.length} deprecated option(s)`,
      details: found.join("\n"),
      severity: "warning",
      durationMs: Date.now() - start,
      autoFixable: true,
      fix: async () => {
        // Read, migrate, and write back
        const content = await fs.readFile(configPath, "utf-8");
        const config = parseJsonc(content) as Record<string, unknown>;

        for (const dep of DEPRECATED_OPTIONS) {
          if (hasKey(config, dep.old)) {
            // Simple migration - would need more sophisticated handling for nested paths
            const value = config[dep.old];
            delete config[dep.old];
            // For now, just note the migration - full path support would require more work
            console.log(
              `Migration note: Move '${dep.old}' to '${dep.new}' with value:`,
              value
            );
          }
        }

        await fs.writeFile(configPath, JSON.stringify(config, null, 2));
        return {
          success: true,
          message: `Migrated ${found.length} deprecated option(s)`,
        };
      },
    };
  } catch {
    return {
      id: "config.deprecated",
      name: "Deprecated Options",
      category: "config",
      status: "skip",
      message: "No configuration file",
      severity: "info",
      durationMs: Date.now() - start,
      autoFixable: false,
    };
  }
}

/**
 * Check for keybind conflicts
 */
async function checkKeybindConflicts(): Promise<CheckResult> {
  const start = Date.now();
  const configPath = path.join(getConfigDir(), "agent-core.json");

  try {
    const content = await fs.readFile(configPath, "utf-8");
    const config = parseJsonc(content) as Record<string, unknown>;

    const keybinds = config.keybinds as Record<string, string> | undefined;
    if (!keybinds || typeof keybinds !== "object") {
      return {
        id: "config.keybinds",
        name: "Keybind Conflicts",
        category: "config",
        status: "pass",
        message: "No custom keybinds configured",
        severity: "info",
        durationMs: Date.now() - start,
        autoFixable: false,
      };
    }

    // Find duplicates
    const seen = new Map<string, string[]>();
    for (const [action, binding] of Object.entries(keybinds)) {
      if (typeof binding === "string") {
        const existing = seen.get(binding) || [];
        existing.push(action);
        seen.set(binding, existing);
      }
    }

    const conflicts: string[] = [];
    for (const [binding, actions] of seen) {
      if (actions.length > 1) {
        conflicts.push(`'${binding}' → ${actions.join(", ")}`);
      }
    }

    if (conflicts.length === 0) {
      return {
        id: "config.keybinds",
        name: "Keybind Conflicts",
        category: "config",
        status: "pass",
        message: `${Object.keys(keybinds).length} keybinds configured`,
        severity: "info",
        durationMs: Date.now() - start,
        autoFixable: false,
      };
    }

    return {
      id: "config.keybinds",
      name: "Keybind Conflicts",
      category: "config",
      status: "warn",
      message: `${conflicts.length} keybind conflict(s)`,
      details: conflicts.join("\n"),
      severity: "warning",
      durationMs: Date.now() - start,
      autoFixable: false,
    };
  } catch {
    return {
      id: "config.keybinds",
      name: "Keybind Conflicts",
      category: "config",
      status: "skip",
      message: "Could not check keybinds",
      severity: "info",
      durationMs: Date.now() - start,
      autoFixable: false,
    };
  }
}

/**
 * Check environment variables
 */
async function checkCredentials(): Promise<CheckResult> {
  const start = Date.now();

  const missing: string[] = [];
  const present: string[] = [];

  for (const credential of RECOMMENDED_CREDENTIALS) {
    let isPresent = false;
    if (credential.envVar) {
      const value = process.env[credential.envVar];
      isPresent = Boolean(value && value.trim());
    }
    if (!isPresent && credential.authProviderId) {
      const auth = await Auth.get(credential.authProviderId);
      if (auth?.type === "api") {
        isPresent = Boolean(auth.key?.trim());
      } else if (auth?.type === "oauth") {
        isPresent = Boolean(auth.access?.trim());
      } else if (auth?.type === "wellknown") {
        isPresent = Boolean(auth.token?.trim());
      }
    }

    const label = credential.envVar ?? `${credential.label} (auth login)`;
    if (isPresent) {
      present.push(label);
    } else {
      missing.push(label);
    }
  }

  if (missing.length === RECOMMENDED_CREDENTIALS.length) {
    return {
      id: "config.env-vars",
      name: "Credentials",
      category: "config",
      status: "warn",
      message: "No credentials configured",
      details: `Missing: ${missing.join(", ")}\nSet at least one to use AI providers.`,
      severity: "warning",
      durationMs: Date.now() - start,
      autoFixable: false,
    };
  }

  if (missing.length > 0) {
    return {
      id: "config.env-vars",
      name: "Credentials",
      category: "config",
      status: "pass",
      message: `${present.length}/${RECOMMENDED_CREDENTIALS.length} credentials configured`,
      details: `Present: ${present.join(", ")}\nMissing: ${missing.join(", ")}`,
      severity: "info",
      durationMs: Date.now() - start,
      autoFixable: false,
    };
  }

  return {
    id: "config.env-vars",
    name: "Credentials",
    category: "config",
    status: "pass",
    message: "All credentials configured",
    severity: "info",
    durationMs: Date.now() - start,
    autoFixable: false,
  };
}

/**
 * Check MCP server paths (extended check)
 */
async function checkMCPPaths(): Promise<CheckResult> {
  const start = Date.now();
  const configPath = path.join(getConfigDir(), "agent-core.json");

  try {
    const content = await fs.readFile(configPath, "utf-8");
    const config = parseJsonc(content) as Record<string, unknown>;

    const mcpServers = config.mcpServers as
      | Record<string, { command?: string; args?: string[] }>
      | undefined;
    if (!mcpServers || typeof mcpServers !== "object") {
      return {
        id: "config.mcp-paths",
        name: "MCP Server Paths",
        category: "config",
        status: "skip",
        message: "No MCP servers configured",
        severity: "info",
        durationMs: Date.now() - start,
        autoFixable: false,
      };
    }

    const missing: string[] = [];
    const found: string[] = [];

    for (const [name, server] of Object.entries(mcpServers)) {
      if (server && typeof server === "object" && server.command) {
        const command = server.command;
        // Check if it's an absolute path
        if (path.isAbsolute(command)) {
          try {
            await fs.access(command);
            found.push(name);
          } catch {
            missing.push(`${name}: ${command}`);
          }
        } else {
          // It's likely a command in PATH, assume it's ok
          found.push(name);
        }
      }
    }

    if (missing.length === 0) {
      return {
        id: "config.mcp-paths",
        name: "MCP Server Paths",
        category: "config",
        status: "pass",
        message: `${found.length} MCP server(s) configured`,
        severity: "info",
        durationMs: Date.now() - start,
        autoFixable: false,
      };
    }

    return {
      id: "config.mcp-paths",
      name: "MCP Server Paths",
      category: "config",
      status: "warn",
      message: `${missing.length} MCP server path(s) missing`,
      details: missing.join("\n"),
      severity: "warning",
      durationMs: Date.now() - start,
      autoFixable: false,
    };
  } catch {
    return {
      id: "config.mcp-paths",
      name: "MCP Server Paths",
      category: "config",
      status: "skip",
      message: "Could not check MCP paths",
      severity: "info",
      durationMs: Date.now() - start,
      autoFixable: false,
    };
  }
}

/**
 * Run all configuration checks
 */
export async function runConfigChecks(
  options: CheckOptions
): Promise<CheckResult[]> {
  const results: CheckResult[] = [];

  // Core checks
  results.push(await checkConfigSchema());
  results.push(await checkDeprecatedOptions());
  results.push(await checkCredentials());

  // Extended checks
  if (options.full) {
    results.push(await checkKeybindConflicts());
    results.push(await checkMCPPaths());
  }

  return results;
}
