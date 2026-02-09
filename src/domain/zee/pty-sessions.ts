/**
 * Zee PTY Session Management Tools
 *
 * Provides interactive terminal sessions via the Zee gateway:
 * - Create PTY sessions for TTY-required commands (vim, python -i, etc.)
 * - Send keystrokes and input to running sessions
 * - Poll output and check session status
 * - Manage session lifecycle (background, kill, clear)
 *
 * PTY sessions enable:
 * - Full terminal emulation (escape sequences, colors)
 * - Interactive CLI tools that require TTY
 * - Long-running processes with periodic polling
 * - Key sequence encoding (arrows, function keys, ctrl+c)
 */

import { z } from "zod";
import type { ToolDefinition, ToolExecutionResult } from "../../mcp/types.js";
import { Log } from "../../../packages/zee-core/src/util/log.js";

const log = Log.create({ service: "zee-pty-sessions" });

// =============================================================================
// Gateway Client
// =============================================================================

const DEFAULT_GATEWAY_URL = "ws://127.0.0.1:18789";
const DEFAULT_TIMEOUT_MS = 30000;

function resolveGatewayHttpUrl(): string {
  const envUrl = process.env.ZEE_GATEWAY_URL || process.env.GATEWAY_URL;
  if (envUrl) {
    return envUrl.replace(/^ws:/, "http:").replace(/^wss:/, "https:");
  }
  const port = process.env.ZEE_GATEWAY_PORT || "18789";
  return `http://127.0.0.1:${port}`;
}

async function callGatewayRpc<T = unknown>(
  method: string,
  params: Record<string, unknown>,
  timeoutMs?: number,
): Promise<T> {
  const baseUrl = resolveGatewayHttpUrl();
  const timeout = timeoutMs || DEFAULT_TIMEOUT_MS;

  const url = `${baseUrl}/rpc`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: Date.now(),
        method,
        params,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Gateway error: ${response.status} ${text}`);
    }

    const result = await response.json() as { result?: T; error?: { message: string } };

    if (result.error) {
      throw new Error(result.error.message);
    }

    return result.result as T;
  } catch (error) {
    clearTimeout(timeoutId);
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`Gateway request timed out after ${timeout}ms`);
    }
    throw error;
  }
}

function formatConnectionError(errorMsg: string): string {
  return `Could not connect to Zee gateway.

Ensure zee daemon is running:
  zee daemon

Error: ${errorMsg}`;
}

// =============================================================================
// Types
// =============================================================================

interface SessionInfo {
  id: string;
  command: string;
  pid?: number;
  cwd?: string;
  startedAt: number;
  exited: boolean;
  exitCode?: number;
  exitSignal?: string;
  backgrounded: boolean;
  truncated: boolean;
  totalOutputChars: number;
}

interface PollResult {
  sessionId: string;
  status: "running" | "completed" | "failed";
  stdout: string;
  stderr: string;
  exitCode?: number;
  exitSignal?: string;
  truncated: boolean;
}

// =============================================================================
// PTY Session Start Tool
// =============================================================================

const PtyStartParams = z.object({
  command: z.string().describe("Shell command to execute"),
  pty: z.boolean().default(true).describe("Use PTY for interactive terminals (default: true)"),
  background: z.boolean().default(true).describe("Run in background for polling (default: true)"),
  workdir: z.string().optional().describe("Working directory"),
  env: z.record(z.string(), z.string()).optional().describe("Environment variables"),
  timeoutSeconds: z.number().optional().describe("Kill process after N seconds"),
  yieldMs: z.number().optional().describe("Wait before backgrounding (default: 1000ms)"),
});

export const ptyStartTool: ToolDefinition = {
  id: "zee:pty-start",
  category: "domain",
  init: async () => ({
    description: `Start an interactive PTY session.

Use this for commands that require a terminal (TTY):
- Interactive interpreters: python -i, node, irb
- Text editors: vim, nano, emacs
- TUI applications: htop, ncdu, lazygit
- Debuggers: gdb, pdb, lldb

The session runs in background and can be controlled with:
- zee:pty-send-keys: Send keystrokes
- zee:pty-poll: Get output
- zee:pty-kill: Terminate

Examples:
- Interactive Python: { command: "python3 -i" }
- Vim editor: { command: "vim file.txt" }
- With workdir: { command: "npm start", workdir: "/app" }`,
    parameters: PtyStartParams,
    execute: async (args, ctx): Promise<ToolExecutionResult> => {
      ctx.metadata({ title: `PTY: ${args.command.substring(0, 30)}...` });

      try {
        const result = await callGatewayRpc<{
          sessionId: string;
          status: "running" | "completed";
          pid?: number;
          stdout?: string;
          exitCode?: number;
        }>("bash.exec", {
          command: args.command,
          pty: args.pty,
          background: args.background,
          workdir: args.workdir,
          env: args.env,
          timeout: args.timeoutSeconds,
          yieldMs: args.yieldMs ?? 1000,
        }, args.timeoutSeconds ? (args.timeoutSeconds + 5) * 1000 : undefined);

        const initialOutput = result.stdout?.trim();

        return {
          title: "PTY Session Started",
          metadata: {
            sessionId: result.sessionId,
            status: result.status,
            pid: result.pid,
          },
          output: `Started PTY session: ${result.sessionId}

Command: ${args.command}
Status: ${result.status}
PID: ${result.pid || "N/A"}
${initialOutput ? `\nInitial output:\n${initialOutput.substring(0, 500)}${initialOutput.length > 500 ? "..." : ""}` : ""}

Control the session with:
- zee:pty-send-keys { sessionId: "${result.sessionId}", keys: ["h", "i", "enter"] }
- zee:pty-poll { sessionId: "${result.sessionId}" }
- zee:pty-kill { sessionId: "${result.sessionId}" }`,
        };
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);

        if (errorMsg.includes("ECONNREFUSED") || errorMsg.includes("fetch failed")) {
          return {
            title: "Gateway Not Running",
            metadata: { error: "connection_failed" },
            output: formatConnectionError(errorMsg),
          };
        }

        return {
          title: "PTY Start Error",
          metadata: { error: errorMsg },
          output: `Failed to start PTY session: ${errorMsg}`,
        };
      }
    },
  }),
};

// =============================================================================
// PTY Session List Tool
// =============================================================================

const PtyListParams = z.object({
  includeFinished: z.boolean().default(true).describe("Include finished sessions"),
});

export const ptyListTool: ToolDefinition = {
  id: "zee:pty-list",
  category: "domain",
  init: async () => ({
    description: `List all PTY sessions.

Shows running and finished sessions with status info.

Example:
- { }
- { includeFinished: false }`,
    parameters: PtyListParams,
    execute: async (args, ctx): Promise<ToolExecutionResult> => {
      ctx.metadata({ title: "PTY Sessions" });

      try {
        const result = await callGatewayRpc<{
          running: SessionInfo[];
          finished: SessionInfo[];
        }>("bash.process", {
          action: "list",
        });

        const running = result.running || [];
        const finished = args.includeFinished ? (result.finished || []) : [];

        if (running.length === 0 && finished.length === 0) {
          return {
            title: "No Sessions",
            metadata: { running: 0, finished: 0 },
            output: `No PTY sessions found.

Start one with:
zee:pty-start { command: "python3 -i" }`,
          };
        }

        const formatSession = (s: SessionInfo, idx: number) => {
          const status = s.exited
            ? (s.exitCode === 0 ? "completed" : `failed (${s.exitCode})`)
            : "running";
          const duration = Math.round((Date.now() - s.startedAt) / 1000);
          return `${idx + 1}. [${status}] ${s.command.substring(0, 50)}
   ID: ${s.id}
   PID: ${s.pid || "N/A"} | Duration: ${duration}s | Output: ${s.totalOutputChars} chars`;
        };

        let output = "";

        if (running.length > 0) {
          output += `Running Sessions (${running.length}):\n\n`;
          output += running.map((s, i) => formatSession(s, i)).join("\n\n");
        }

        if (finished.length > 0) {
          if (output) output += "\n\n";
          output += `Finished Sessions (${finished.length}):\n\n`;
          output += finished.map((s, i) => formatSession(s, i)).join("\n\n");
        }

        return {
          title: `${running.length} Running, ${finished.length} Finished`,
          metadata: {
            running: running.length,
            finished: finished.length,
            sessions: running.map(s => s.id),
          },
          output,
        };
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);

        if (errorMsg.includes("ECONNREFUSED") || errorMsg.includes("fetch failed")) {
          return {
            title: "Gateway Not Running",
            metadata: { error: "connection_failed" },
            output: formatConnectionError(errorMsg),
          };
        }

        return {
          title: "PTY List Error",
          metadata: { error: errorMsg },
          output: `Failed to list sessions: ${errorMsg}`,
        };
      }
    },
  }),
};

// =============================================================================
// PTY Poll Tool
// =============================================================================

const PtyPollParams = z.object({
  sessionId: z.string().describe("Session ID to poll"),
});

export const ptyPollTool: ToolDefinition = {
  id: "zee:pty-poll",
  category: "domain",
  init: async () => ({
    description: `Poll a PTY session for new output.

Returns output since last poll and current status.
Use this to check on background sessions.

Example:
- { sessionId: "abc123" }`,
    parameters: PtyPollParams,
    execute: async (args, ctx): Promise<ToolExecutionResult> => {
      ctx.metadata({ title: `Poll: ${args.sessionId.substring(0, 8)}...` });

      try {
        const result = await callGatewayRpc<PollResult>("bash.process", {
          action: "poll",
          sessionId: args.sessionId,
        });

        const hasOutput = result.stdout || result.stderr;
        const output = [result.stdout, result.stderr].filter(Boolean).join("\n---stderr---\n");

        return {
          title: `Session: ${result.status}`,
          metadata: {
            sessionId: result.sessionId,
            status: result.status,
            exitCode: result.exitCode,
            hasOutput: !!hasOutput,
          },
          output: `Session: ${args.sessionId}
Status: ${result.status}${result.exitCode !== undefined ? ` (exit: ${result.exitCode})` : ""}
${result.truncated ? "⚠️ Output truncated\n" : ""}
${hasOutput ? `Output:\n${output}` : "No new output"}`,
        };
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);

        if (errorMsg.includes("not found") || errorMsg.includes("404")) {
          return {
            title: "Session Not Found",
            metadata: { error: "not_found", sessionId: args.sessionId },
            output: `Session "${args.sessionId}" not found.

Use zee:pty-list to see available sessions.`,
          };
        }

        if (errorMsg.includes("ECONNREFUSED") || errorMsg.includes("fetch failed")) {
          return {
            title: "Gateway Not Running",
            metadata: { error: "connection_failed" },
            output: formatConnectionError(errorMsg),
          };
        }

        return {
          title: "PTY Poll Error",
          metadata: { error: errorMsg },
          output: `Failed to poll session: ${errorMsg}`,
        };
      }
    },
  }),
};

// =============================================================================
// PTY Send Keys Tool
// =============================================================================

const PtySendKeysParams = z.object({
  sessionId: z.string().describe("Session ID"),
  keys: z.array(z.string()).optional()
    .describe("Named keys: 'enter', 'tab', 'escape', 'up', 'down', 'c-c' (ctrl+c), 'c-d', 'f1'-'f12'"),
  literal: z.string().optional()
    .describe("Literal text to type"),
  hex: z.array(z.string()).optional()
    .describe("Raw hex bytes: ['0x1b', '0x5b', '0x41']"),
});

export const ptySendKeysTool: ToolDefinition = {
  id: "zee:pty-send-keys",
  category: "domain",
  init: async () => ({
    description: `Send keystrokes to a PTY session.

**Named Keys:**
- Basic: enter, tab, escape, space, backspace, delete
- Arrows: up, down, left, right
- Navigation: home, end, pageup, pagedown
- Function: f1-f12
- Modifiers: c-KEY (ctrl), m-KEY (alt), s-KEY (shift)
  - c-c = Ctrl+C (SIGINT)
  - c-d = Ctrl+D (EOF)
  - c-z = Ctrl+Z (SIGTSTP)
  - m-x = Alt+X

**Literal Text:**
Type exact characters including newlines.

**Hex Bytes:**
Send raw escape sequences.

Examples:
- Type and submit: { sessionId: "abc", literal: "print('hi')", keys: ["enter"] }
- Navigate: { sessionId: "abc", keys: ["up", "up", "enter"] }
- Interrupt: { sessionId: "abc", keys: ["c-c"] }
- Quit vim: { sessionId: "abc", keys: ["escape"], literal: ":q!" }`,
    parameters: PtySendKeysParams,
    execute: async (args, ctx): Promise<ToolExecutionResult> => {
      const keyCount = (args.keys?.length || 0) + (args.literal?.length || 0) + (args.hex?.length || 0);
      ctx.metadata({ title: `Keys: ${keyCount} inputs` });

      if (!args.keys && !args.literal && !args.hex) {
        return {
          title: "No Input",
          metadata: { error: "no_input" },
          output: `No keys, literal text, or hex bytes provided.

Examples:
- { sessionId: "abc", keys: ["enter"] }
- { sessionId: "abc", literal: "hello" }`,
        };
      }

      try {
        const result = await callGatewayRpc<{
          ok: boolean;
          bytesWritten?: number;
          warnings?: string[];
        }>("bash.process", {
          action: "send-keys",
          sessionId: args.sessionId,
          keys: args.keys,
          literal: args.literal,
          hex: args.hex,
        });

        const warnings = result.warnings?.length ? `\nWarnings: ${result.warnings.join(", ")}` : "";

        return {
          title: "Keys Sent",
          metadata: {
            sessionId: args.sessionId,
            bytesWritten: result.bytesWritten,
          },
          output: `Sent input to session ${args.sessionId}

${args.keys?.length ? `Keys: ${args.keys.join(", ")}` : ""}
${args.literal ? `Literal: "${args.literal.substring(0, 50)}${args.literal.length > 50 ? "..." : ""}"` : ""}
${args.hex?.length ? `Hex: ${args.hex.join(" ")}` : ""}
Bytes written: ${result.bytesWritten || 0}${warnings}

Poll for output with:
zee:pty-poll { sessionId: "${args.sessionId}" }`,
        };
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);

        if (errorMsg.includes("not found") || errorMsg.includes("404")) {
          return {
            title: "Session Not Found",
            metadata: { error: "not_found" },
            output: `Session "${args.sessionId}" not found.`,
          };
        }

        if (errorMsg.includes("stdin") || errorMsg.includes("writable")) {
          return {
            title: "Cannot Write",
            metadata: { error: "stdin_closed" },
            output: `Cannot write to session - stdin may be closed or session ended.`,
          };
        }

        if (errorMsg.includes("ECONNREFUSED") || errorMsg.includes("fetch failed")) {
          return {
            title: "Gateway Not Running",
            metadata: { error: "connection_failed" },
            output: formatConnectionError(errorMsg),
          };
        }

        return {
          title: "Send Keys Error",
          metadata: { error: errorMsg },
          output: `Failed to send keys: ${errorMsg}`,
        };
      }
    },
  }),
};

// =============================================================================
// PTY Paste Tool
// =============================================================================

const PtyPasteParams = z.object({
  sessionId: z.string().describe("Session ID"),
  text: z.string().describe("Text to paste"),
  bracketed: z.boolean().default(true)
    .describe("Use bracketed paste mode (prevents command injection in most terminals)"),
});

export const ptyPasteTool: ToolDefinition = {
  id: "zee:pty-paste",
  category: "domain",
  init: async () => ({
    description: `Paste text into a PTY session.

Bracketed paste mode (default: on) wraps text in escape sequences
that tell the terminal this is pasted content, not typed input.
This prevents accidental command execution in editors/shells.

Examples:
- Paste code: { sessionId: "abc", text: "def hello():\\n  print('hi')" }
- Raw paste: { sessionId: "abc", text: "...", bracketed: false }`,
    parameters: PtyPasteParams,
    execute: async (args, ctx): Promise<ToolExecutionResult> => {
      ctx.metadata({ title: `Paste: ${args.text.length} chars` });

      try {
        const result = await callGatewayRpc<{
          ok: boolean;
          bytesWritten?: number;
        }>("bash.process", {
          action: "paste",
          sessionId: args.sessionId,
          text: args.text,
          bracketed: args.bracketed,
        });

        return {
          title: "Text Pasted",
          metadata: {
            sessionId: args.sessionId,
            bytesWritten: result.bytesWritten,
            bracketed: args.bracketed,
          },
          output: `Pasted ${args.text.length} characters to session ${args.sessionId}

Mode: ${args.bracketed ? "bracketed (safe)" : "raw"}
Preview: "${args.text.substring(0, 100)}${args.text.length > 100 ? "..." : ""}"

Poll for output with:
zee:pty-poll { sessionId: "${args.sessionId}" }`,
        };
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);

        if (errorMsg.includes("ECONNREFUSED") || errorMsg.includes("fetch failed")) {
          return {
            title: "Gateway Not Running",
            metadata: { error: "connection_failed" },
            output: formatConnectionError(errorMsg),
          };
        }

        return {
          title: "Paste Error",
          metadata: { error: errorMsg },
          output: `Failed to paste: ${errorMsg}`,
        };
      }
    },
  }),
};

// =============================================================================
// PTY Kill Tool
// =============================================================================

const PtyKillParams = z.object({
  sessionId: z.string().describe("Session ID to kill"),
});

export const ptyKillTool: ToolDefinition = {
  id: "zee:pty-kill",
  category: "domain",
  init: async () => ({
    description: `Terminate a PTY session.

Sends SIGKILL to the process, forcefully ending it.

Example:
- { sessionId: "abc123" }`,
    parameters: PtyKillParams,
    execute: async (args, ctx): Promise<ToolExecutionResult> => {
      ctx.metadata({ title: `Kill: ${args.sessionId.substring(0, 8)}...` });

      try {
        await callGatewayRpc<{ ok: boolean }>("bash.process", {
          action: "kill",
          sessionId: args.sessionId,
        });

        return {
          title: "Session Killed",
          metadata: { sessionId: args.sessionId },
          output: `Terminated session: ${args.sessionId}

The process has been forcefully killed (SIGKILL).`,
        };
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);

        if (errorMsg.includes("not found") || errorMsg.includes("404")) {
          return {
            title: "Session Not Found",
            metadata: { error: "not_found" },
            output: `Session "${args.sessionId}" not found.`,
          };
        }

        if (errorMsg.includes("ECONNREFUSED") || errorMsg.includes("fetch failed")) {
          return {
            title: "Gateway Not Running",
            metadata: { error: "connection_failed" },
            output: formatConnectionError(errorMsg),
          };
        }

        return {
          title: "Kill Error",
          metadata: { error: errorMsg },
          output: `Failed to kill session: ${errorMsg}`,
        };
      }
    },
  }),
};

// =============================================================================
// PTY Clear Tool
// =============================================================================

const PtyClearParams = z.object({
  sessionId: z.string().describe("Session ID to clear from registry"),
});

export const ptyClearTool: ToolDefinition = {
  id: "zee:pty-clear",
  category: "domain",
  init: async () => ({
    description: `Clear a finished PTY session from the registry.

Removes the session record and frees memory.
Only works on finished (exited) sessions.

Example:
- { sessionId: "abc123" }`,
    parameters: PtyClearParams,
    execute: async (args, ctx): Promise<ToolExecutionResult> => {
      ctx.metadata({ title: `Clear: ${args.sessionId.substring(0, 8)}...` });

      try {
        await callGatewayRpc<{ ok: boolean }>("bash.process", {
          action: "clear",
          sessionId: args.sessionId,
        });

        return {
          title: "Session Cleared",
          metadata: { sessionId: args.sessionId },
          output: `Cleared session: ${args.sessionId}

The session record has been removed from the registry.`,
        };
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);

        if (errorMsg.includes("ECONNREFUSED") || errorMsg.includes("fetch failed")) {
          return {
            title: "Gateway Not Running",
            metadata: { error: "connection_failed" },
            output: formatConnectionError(errorMsg),
          };
        }

        return {
          title: "Clear Error",
          metadata: { error: errorMsg },
          output: `Failed to clear session: ${errorMsg}`,
        };
      }
    },
  }),
};

// =============================================================================
// PTY Log Tool
// =============================================================================

const PtyLogParams = z.object({
  sessionId: z.string().describe("Session ID"),
  offset: z.number().default(0).describe("Start position in output"),
  limit: z.number().optional().describe("Max characters to return"),
});

export const ptyLogTool: ToolDefinition = {
  id: "zee:pty-log",
  category: "domain",
  init: async () => ({
    description: `Fetch log output from a PTY session.

Unlike poll (which returns new output), log fetches from
the full output buffer with offset/limit controls.

Examples:
- Full log: { sessionId: "abc" }
- Last 1000 chars: { sessionId: "abc", offset: -1000 }
- First 500 chars: { sessionId: "abc", offset: 0, limit: 500 }`,
    parameters: PtyLogParams,
    execute: async (args, ctx): Promise<ToolExecutionResult> => {
      ctx.metadata({ title: `Log: ${args.sessionId.substring(0, 8)}...` });

      try {
        const result = await callGatewayRpc<{
          sessionId: string;
          output: string;
          totalChars: number;
          offset: number;
          truncated: boolean;
        }>("bash.process", {
          action: "log",
          sessionId: args.sessionId,
          offset: args.offset,
          limit: args.limit,
        });

        return {
          title: `Log: ${result.output.length} chars`,
          metadata: {
            sessionId: result.sessionId,
            totalChars: result.totalChars,
            offset: result.offset,
            truncated: result.truncated,
          },
          output: `Session Log: ${args.sessionId}
Total output: ${result.totalChars} chars
Offset: ${result.offset}
${result.truncated ? "⚠️ Output was truncated\n" : ""}
---
${result.output}`,
        };
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);

        if (errorMsg.includes("ECONNREFUSED") || errorMsg.includes("fetch failed")) {
          return {
            title: "Gateway Not Running",
            metadata: { error: "connection_failed" },
            output: formatConnectionError(errorMsg),
          };
        }

        return {
          title: "Log Error",
          metadata: { error: errorMsg },
          output: `Failed to get log: ${errorMsg}`,
        };
      }
    },
  }),
};

// =============================================================================
// Exports
// =============================================================================

export const PTY_SESSION_TOOLS = [
  ptyStartTool,
  ptyListTool,
  ptyPollTool,
  ptySendKeysTool,
  ptyPasteTool,
  ptyKillTool,
  ptyClearTool,
  ptyLogTool,
];

export function registerPtySessionTools(registry: { register: (tool: ToolDefinition, options: { source: string }) => void }): void {
  for (const tool of PTY_SESSION_TOOLS) {
    registry.register(tool, { source: "domain" });
  }
}
