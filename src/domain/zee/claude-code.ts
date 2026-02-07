/**
 * Zee Claude Code Integration Tools
 *
 * Provides tools to spawn and interact with Claude Code CLI as a dependency.
 * Shares skills and MCP servers with agent-core for unified capabilities.
 *
 * Tools:
 * - zee:claude-status - Check Claude CLI availability and auth status
 * - zee:claude-spawn - Spawn Claude Code with a prompt (shares skills/MCPs)
 * - zee:claude-credentials - Check OAuth credential status
 */

import { spawn, execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { z } from "zod";
import type { ToolDefinition, ToolExecutionResult } from "../../mcp/types";
import { Log } from "../../../packages/agent-core/src/util/log";

const log = Log.create({ service: "zee-claude-code" });

// =============================================================================
// Constants
// =============================================================================

const CLAUDE_CLI_CREDENTIALS_PATH = path.join(os.homedir(), ".claude", ".credentials.json");
const DEFAULT_TIMEOUT_MS = 300_000; // 5 minutes (longer for complex tasks)
const MAX_TIMEOUT_MS = 600_000; // 10 minutes

// Agent-core configuration paths
const AGENT_CORE_CONFIG_DIR = path.join(os.homedir(), ".config", "agent-core");
const AGENT_CORE_MCP_CONFIG = path.join(AGENT_CORE_CONFIG_DIR, "mcp.json");
const AGENT_CORE_SKILLS_DIR = path.join(process.cwd(), ".claude", "skills");

// Model aliases for user convenience
const MODEL_ALIASES: Record<string, string> = {
  opus: "opus",
  "opus-4.5": "opus",
  "opus-4": "opus",
  sonnet: "sonnet",
  "sonnet-4.5": "sonnet",
  "sonnet-4": "sonnet",
  haiku: "haiku",
  "haiku-3.5": "haiku",
};

// =============================================================================
// Types
// =============================================================================

type ClaudeCredential =
  | {
      type: "oauth";
      accessToken: string;
      refreshToken: string;
      expiresAt: number;
    }
  | {
      type: "token";
      accessToken: string;
      expiresAt: number;
    };

type ClaudeSpawnResult = {
  success: boolean;
  output?: string;
  sessionId?: string;
  error?: string;
  durationMs: number;
  model?: string;
};

type ClaudeSpawnOptions = {
  prompt: string;
  model?: string;
  sessionId?: string;
  workingDir?: string;
  timeoutMs?: number;
  dangerouslySkipPermissions?: boolean;
  // Sharing options
  shareMcpConfig?: boolean;
  shareSkills?: boolean;
  additionalDirs?: string[];
  allowedTools?: string[];
  disallowedTools?: string[];
  systemPrompt?: string;
};

// =============================================================================
// Configuration Discovery
// =============================================================================

function findMcpConfigPaths(): string[] {
  const paths: string[] = [];

  // Check agent-core MCP config
  if (fs.existsSync(AGENT_CORE_MCP_CONFIG)) {
    paths.push(AGENT_CORE_MCP_CONFIG);
  }

  // Check project-level .claude/mcp.json
  const projectMcpConfig = path.join(process.cwd(), ".claude", "mcp.json");
  if (fs.existsSync(projectMcpConfig)) {
    paths.push(projectMcpConfig);
  }

  // Check ~/.claude/mcp.json (Claude Code's own config)
  const claudeMcpConfig = path.join(os.homedir(), ".claude", "mcp.json");
  if (fs.existsSync(claudeMcpConfig)) {
    paths.push(claudeMcpConfig);
  }

  return paths;
}

function findSkillsDirs(): string[] {
  const dirs: string[] = [];

  // Project skills
  if (fs.existsSync(AGENT_CORE_SKILLS_DIR)) {
    dirs.push(AGENT_CORE_SKILLS_DIR);
  }

  // User skills
  const userSkillsDir = path.join(AGENT_CORE_CONFIG_DIR, "skills");
  if (fs.existsSync(userSkillsDir)) {
    dirs.push(userSkillsDir);
  }

  return dirs;
}

// =============================================================================
// Credential Reading
// =============================================================================

function readCredentialsFromFile(): ClaudeCredential | null {
  try {
    if (!fs.existsSync(CLAUDE_CLI_CREDENTIALS_PATH)) {
      return null;
    }

    const raw = fs.readFileSync(CLAUDE_CLI_CREDENTIALS_PATH, "utf-8");
    const data = JSON.parse(raw) as Record<string, unknown>;
    const claudeOauth = data.claudeAiOauth as Record<string, unknown> | undefined;

    if (!claudeOauth || typeof claudeOauth !== "object") {
      return null;
    }

    const accessToken = claudeOauth.accessToken;
    const refreshToken = claudeOauth.refreshToken;
    const expiresAt = claudeOauth.expiresAt;

    if (typeof accessToken !== "string" || !accessToken) {
      return null;
    }
    if (typeof expiresAt !== "number" || expiresAt <= 0) {
      return null;
    }

    if (typeof refreshToken === "string" && refreshToken) {
      return {
        type: "oauth",
        accessToken,
        refreshToken,
        expiresAt,
      };
    }

    return {
      type: "token",
      accessToken,
      expiresAt,
    };
  } catch {
    return null;
  }
}

function readClaudeCredentials(): ClaudeCredential | null {
  return readCredentialsFromFile();
}

function isClaudeCliInstalled(): boolean {
  try {
    execSync("which claude", { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] });
    return true;
  } catch {
    return false;
  }
}

function getClaudeCliVersion(): string | null {
  try {
    const result = execSync("claude --version", {
      encoding: "utf8",
      timeout: 5000,
      stdio: ["pipe", "pipe", "pipe"],
    });
    return result.trim();
  } catch {
    return null;
  }
}

// =============================================================================
// Claude Spawn with Shared Configuration
// =============================================================================

async function spawnClaudeCli(options: ClaudeSpawnOptions): Promise<ClaudeSpawnResult> {
  const startTime = Date.now();
  const {
    prompt,
    model = "sonnet",
    sessionId,
    workingDir = process.cwd(),
    timeoutMs = DEFAULT_TIMEOUT_MS,
    dangerouslySkipPermissions = true,
    shareMcpConfig = true,
    shareSkills = true,
    additionalDirs = [],
    allowedTools,
    disallowedTools,
    systemPrompt,
  } = options;

  const resolvedModel = MODEL_ALIASES[model.toLowerCase()] || model;

  // Build CLI arguments
  const args: string[] = [
    "-p", // Print mode (non-interactive)
    "--output-format", "json",
    "--model", resolvedModel,
  ];

  if (dangerouslySkipPermissions) {
    args.push("--dangerously-skip-permissions");
  }

  if (sessionId) {
    args.push("--session-id", sessionId);
  }

  // Share MCP configuration
  if (shareMcpConfig) {
    const mcpConfigs = findMcpConfigPaths();
    for (const configPath of mcpConfigs) {
      args.push("--mcp-config", configPath);
    }
  }

  // Add directories for tool access (skills, workspace)
  const dirsToAdd = [...additionalDirs];

  if (shareSkills) {
    const skillsDirs = findSkillsDirs();
    dirsToAdd.push(...skillsDirs);
  }

  // Add working directory and common paths
  dirsToAdd.push(workingDir);

  // Dedupe and filter existing directories
  const uniqueDirs = [...new Set(dirsToAdd)].filter(d => fs.existsSync(d));
  if (uniqueDirs.length > 0) {
    args.push("--add-dir", ...uniqueDirs);
  }

  // Tool restrictions
  if (allowedTools && allowedTools.length > 0) {
    args.push("--allowedTools", ...allowedTools);
  }

  if (disallowedTools && disallowedTools.length > 0) {
    args.push("--disallowedTools", ...disallowedTools);
  }

  // System prompt
  if (systemPrompt) {
    args.push("--append-system-prompt", systemPrompt);
  }

  // Add prompt as final argument
  args.push(prompt);

  log.info("Spawning Claude Code", {
    model: resolvedModel,
    workingDir,
    mcpConfigCount: shareMcpConfig ? findMcpConfigPaths().length : 0,
    additionalDirsCount: uniqueDirs.length,
    promptLength: prompt.length,
  });

  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let timedOut = false;

    const child = spawn("claude", args, {
      cwd: workingDir,
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...process.env,
        // Clear API key to force OAuth
        ANTHROPIC_API_KEY: undefined,
      },
    });

    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 5000);
    }, timeoutMs);

    child.stdout?.on("data", (data) => {
      stdout += data.toString();
    });

    child.stderr?.on("data", (data) => {
      stderr += data.toString();
    });

    child.on("close", (code) => {
      clearTimeout(timeout);
      const durationMs = Date.now() - startTime;

      if (timedOut) {
        resolve({
          success: false,
          error: `Claude Code timed out after ${Math.round(timeoutMs / 1000)}s`,
          durationMs,
          model: resolvedModel,
        });
        return;
      }

      if (code !== 0) {
        resolve({
          success: false,
          error: stderr || stdout || `Claude Code exited with code ${code}`,
          durationMs,
          model: resolvedModel,
        });
        return;
      }

      // Try to parse JSON output
      try {
        const parsed = JSON.parse(stdout.trim()) as Record<string, unknown>;
        const result = parsed.result ?? parsed.response ?? parsed.content ?? parsed.text;
        const outputSessionId =
          parsed.session_id ?? parsed.sessionId ?? parsed.conversation_id;

        resolve({
          success: true,
          output: typeof result === "string" ? result : stdout.trim(),
          sessionId: typeof outputSessionId === "string" ? outputSessionId : undefined,
          durationMs,
          model: resolvedModel,
        });
      } catch {
        // Not JSON, return raw output
        resolve({
          success: true,
          output: stdout.trim(),
          durationMs,
          model: resolvedModel,
        });
      }
    });

    child.on("error", (err) => {
      clearTimeout(timeout);
      resolve({
        success: false,
        error: `Failed to spawn Claude Code: ${err.message}`,
        durationMs: Date.now() - startTime,
        model: resolvedModel,
      });
    });
  });
}

// =============================================================================
// Tool: zee:claude-status
// =============================================================================

const ClaudeStatusParams = z.object({});

export const claudeStatusTool: ToolDefinition = {
  id: "zee:claude-status",
  category: "domain",
  init: async () => ({
    description: `Check Claude Code CLI availability, authentication, and shared configuration.

Returns:
- Whether Claude CLI is installed
- CLI version
- Authentication status (OAuth vs token)
- Token expiration time
- Shared MCP configurations found
- Shared skills directories found

Use this to verify Claude Code is ready and properly integrated.`,
    parameters: ClaudeStatusParams,
    execute: async (_args, ctx): Promise<ToolExecutionResult> => {
      ctx.metadata({ title: "Claude Code Status" });

      const installed = isClaudeCliInstalled();
      const version = installed ? getClaudeCliVersion() : null;
      const credentials = installed ? readClaudeCredentials() : null;

      const isAuthenticated = credentials !== null;
      const authType = credentials?.type ?? "none";
      const expiresAt = credentials?.expiresAt;
      const isExpired = expiresAt ? expiresAt < Date.now() : true;
      const expiresIn = expiresAt ? Math.max(0, expiresAt - Date.now()) : 0;
      const expiresInMinutes = Math.floor(expiresIn / 60000);

      // Check shared configuration
      const mcpConfigs = findMcpConfigPaths();
      const skillsDirs = findSkillsDirs();

      const status = {
        installed,
        version,
        authenticated: isAuthenticated && !isExpired,
        authType,
        expired: isExpired,
        expiresInMinutes: isAuthenticated ? expiresInMinutes : null,
        mcpConfigs: mcpConfigs.length,
        skillsDirs: skillsDirs.length,
      };

      let output = `Claude Code Status:
- Installed: ${installed ? "Yes" : "No"}`;

      if (version) {
        output += `\n- Version: ${version}`;
      }

      if (installed) {
        output += `\n- Authenticated: ${isAuthenticated && !isExpired ? "Yes" : "No"}`;
        if (isAuthenticated) {
          output += `\n- Auth Type: ${authType}`;
          if (isExpired) {
            output += `\n- Token Status: Expired (refresh required)`;
          } else {
            output += `\n- Token Expires In: ${expiresInMinutes} minutes`;
          }
        } else {
          output += `\n\nTo authenticate, run: claude login`;
        }

        // Shared configuration status
        output += `\n\nShared Configuration:`;
        output += `\n- MCP Config Files: ${mcpConfigs.length}`;
        for (const configPath of mcpConfigs) {
          output += `\n  • ${configPath}`;
        }
        output += `\n- Skills Directories: ${skillsDirs.length}`;
        for (const dir of skillsDirs) {
          output += `\n  • ${dir}`;
        }
      } else {
        output += `\n\nTo install Claude Code CLI:
  npm install -g @anthropic-ai/claude-code@latest

Then authenticate:
  claude login`;
      }

      return {
        title: "Claude Code Status",
        metadata: status,
        output,
      };
    },
  }),
};

// =============================================================================
// Tool: zee:claude-spawn
// =============================================================================

const ClaudeSpawnParams = z.object({
  prompt: z.string().describe("The prompt to send to Claude Code"),
  model: z.enum(["opus", "sonnet", "haiku"]).optional()
    .describe("Model to use (default: sonnet)"),
  sessionId: z.string().optional()
    .describe("Session ID to continue a conversation"),
  workingDir: z.string().optional()
    .describe("Working directory for Claude Code (default: current directory)"),
  timeoutMs: z.number().optional()
    .describe(`Timeout in milliseconds (default: ${DEFAULT_TIMEOUT_MS}, max: ${MAX_TIMEOUT_MS})`),
  skipPermissions: z.boolean().optional()
    .describe("Skip permission prompts (default: true)"),
  shareMcpConfig: z.boolean().optional()
    .describe("Share MCP server configuration with Claude Code (default: true)"),
  shareSkills: z.boolean().optional()
    .describe("Share skills directories with Claude Code (default: true)"),
  additionalDirs: z.array(z.string()).optional()
    .describe("Additional directories to allow tool access to"),
  allowedTools: z.array(z.string()).optional()
    .describe('Tools to allow (e.g., ["Bash(git:*)", "Edit"])'),
  disallowedTools: z.array(z.string()).optional()
    .describe("Tools to disallow"),
  systemPrompt: z.string().optional()
    .describe("Additional system prompt to append"),
});

export const claudeSpawnTool: ToolDefinition = {
  id: "zee:claude-spawn",
  category: "domain",
  init: async () => ({
    description: `Spawn Claude Code CLI with a prompt, sharing skills and MCP servers with agent-core.

This tool runs Claude Code as a subprocess with unified configuration:
- Shares MCP servers from agent-core (--mcp-config)
- Shares skills directories (--add-dir)
- Supports tool restrictions (--allowedTools, --disallowedTools)
- Can continue conversations with session IDs

The Claude Code instance has access to the same capabilities as agent-core.

Examples:
- Simple task: { prompt: "Explain this codebase structure" }
- Complex coding: { prompt: "Fix the bug in src/app.ts", model: "opus" }
- Restricted tools: { prompt: "Review this code", allowedTools: ["Read", "Grep"], disallowedTools: ["Write", "Edit"] }
- Continue session: { prompt: "Continue", sessionId: "abc123" }`,
    parameters: ClaudeSpawnParams,
    execute: async (args, ctx): Promise<ToolExecutionResult> => {
      const {
        prompt,
        model = "sonnet",
        sessionId,
        workingDir,
        timeoutMs = DEFAULT_TIMEOUT_MS,
        skipPermissions = true,
        shareMcpConfig = true,
        shareSkills = true,
        additionalDirs = [],
        allowedTools,
        disallowedTools,
        systemPrompt,
      } = args;

      ctx.metadata({ title: `Claude: ${model}` });

      // Validate timeout
      const effectiveTimeout = Math.min(timeoutMs, MAX_TIMEOUT_MS);

      // Check if CLI is available
      if (!isClaudeCliInstalled()) {
        return {
          title: "Claude CLI Not Installed",
          metadata: { error: "not_installed" },
          output: `Claude Code CLI is not installed.

To install:
  npm install -g @anthropic-ai/claude-code@latest

Then authenticate:
  claude login`,
        };
      }

      // Check authentication
      const credentials = readClaudeCredentials();
      if (!credentials) {
        return {
          title: "Not Authenticated",
          metadata: { error: "not_authenticated" },
          output: `Claude Code is not authenticated.

Run: claude login`,
        };
      }

      if (credentials.expiresAt < Date.now()) {
        log.warn("Claude Code OAuth token expired, CLI will attempt refresh");
      }

      // Spawn Claude CLI with shared configuration
      const result = await spawnClaudeCli({
        prompt,
        model,
        sessionId,
        workingDir,
        timeoutMs: effectiveTimeout,
        dangerouslySkipPermissions: skipPermissions,
        shareMcpConfig,
        shareSkills,
        additionalDirs,
        allowedTools,
        disallowedTools,
        systemPrompt,
      });

      if (!result.success) {
        return {
          title: "Claude Code Error",
          metadata: {
            error: result.error,
            durationMs: result.durationMs,
            model: result.model,
          },
          output: `Claude Code failed: ${result.error}`,
        };
      }

      const durationSec = (result.durationMs / 1000).toFixed(1);

      return {
        title: "Claude Code Response",
        metadata: {
          sessionId: result.sessionId,
          durationMs: result.durationMs,
          model: result.model,
        },
        output: `${result.output || "(No output)"}

---
Model: ${result.model} | Duration: ${durationSec}s${result.sessionId ? ` | Session: ${result.sessionId}` : ""}`,
      };
    },
  }),
};

// =============================================================================
// Tool: zee:claude-credentials
// =============================================================================

const ClaudeCredentialsParams = z.object({
  showTokens: z.boolean().optional()
    .describe("Show partial token values for debugging (default: false)"),
});

export const claudeCredentialsTool: ToolDefinition = {
  id: "zee:claude-credentials",
  category: "domain",
  init: async () => ({
    description: `Check Claude Code OAuth credential details.

Returns detailed information about stored credentials:
- Credential source (file or keychain)
- Token type (OAuth with refresh or token-only)
- Expiration time
- Partial token preview (if showTokens is true)

Use this for debugging authentication issues.`,
    parameters: ClaudeCredentialsParams,
    execute: async (args, ctx): Promise<ToolExecutionResult> => {
      const { showTokens = false } = args;
      ctx.metadata({ title: "Claude Credentials" });

      const fileCreds = readCredentialsFromFile();
      const activeCreds = fileCreds;

      const source = fileCreds ? "file" : "none";
      const hasFile = fs.existsSync(CLAUDE_CLI_CREDENTIALS_PATH);

      let output = `Claude Code Credentials:
- Source: ${source}
- Credentials File: ${hasFile ? "exists" : "not found"} (${CLAUDE_CLI_CREDENTIALS_PATH})`;

      if (activeCreds) {
        const isExpired = activeCreds.expiresAt < Date.now();
        const expiresIn = Math.max(0, activeCreds.expiresAt - Date.now());
        const expiresInMinutes = Math.floor(expiresIn / 60000);

        output += `\n
Active Credentials:
- Type: ${activeCreds.type}
- Expired: ${isExpired ? "Yes" : "No"}
- Expires At: ${new Date(activeCreds.expiresAt).toISOString()}
- Expires In: ${isExpired ? "already expired" : `${expiresInMinutes} minutes`}`;

        if (activeCreds.type === "oauth") {
          output += `\n- Has Refresh Token: Yes`;
        }

        if (showTokens) {
          const masked = (token: string) =>
            token.length > 20
              ? `${token.slice(0, 8)}...${token.slice(-8)}`
              : "***";

          output += `\n
Token Preview (masked):
- Access Token: ${masked(activeCreds.accessToken)}`;

          if (activeCreds.type === "oauth") {
            output += `\n- Refresh Token: ${masked(activeCreds.refreshToken)}`;
          }
        }
      } else {
        output += `\n
No credentials found. To authenticate:
  claude login`;
      }

      return {
        title: "Claude Credentials",
	        metadata: {
	          source,
	          hasFile,
	          hasKeychain: false,
	          type: activeCreds?.type ?? "none",
	          expired: activeCreds ? activeCreds.expiresAt < Date.now() : true,
	        },
	        output,
	      };
    },
  }),
};

// =============================================================================
// Exports
// =============================================================================

export const CLAUDE_CODE_TOOLS = [
  claudeStatusTool,
  claudeSpawnTool,
  claudeCredentialsTool,
];

export function registerClaudeCodeTools(
  registry: { register: (tool: ToolDefinition, options: { source: string }) => void }
): void {
  for (const tool of CLAUDE_CODE_TOOLS) {
    registry.register(tool, { source: "domain" });
  }
}
