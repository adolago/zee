/**
 * Bash Tool
 *
 * Execute shell commands with sandboxing, timeout, and permission checking.
 * Supports command parsing for permission validation.
 */

import { z } from 'zod';
import { spawn } from 'child_process';
import { defineTool } from '../registry';
import type { ToolExecutionContext } from '../types';
import * as path from 'path';

// ============================================================================
// Configuration
// ============================================================================

const MAX_OUTPUT_LENGTH = 30_000;
const DEFAULT_TIMEOUT = 2 * 60 * 1000; // 2 minutes
const MAX_TIMEOUT = 10 * 60 * 1000; // 10 minutes

function parseCommandLine(command: string): string[] {
  const argv: string[] = [];
  let current = '';
  let hasToken = false;
  let mode: 'none' | 'single' | 'double' = 'none';
  let escape = false;

  const push = () => {
    if (!hasToken) return;
    argv.push(current);
    current = '';
    hasToken = false;
  };

  for (let i = 0; i < command.length; i++) {
    const ch = command[i]!;

    if (escape) {
      current += ch;
      hasToken = true;
      escape = false;
      continue;
    }

    if (mode === 'single') {
      if (ch === "'") {
        mode = 'none';
      } else {
        current += ch;
        hasToken = true;
      }
      continue;
    }

    if (mode === 'double') {
      if (ch === '"') {
        mode = 'none';
        continue;
      }
      if (ch === '\\') {
        escape = true;
        hasToken = true;
        continue;
      }
      current += ch;
      hasToken = true;
      continue;
    }

    // mode === 'none'
    if (ch === "'") {
      mode = 'single';
      hasToken = true;
      continue;
    }
    if (ch === '"') {
      mode = 'double';
      hasToken = true;
      continue;
    }
    if (ch === '\\') {
      escape = true;
      hasToken = true;
      continue;
    }

    if (/\s/.test(ch)) {
      push();
      continue;
    }

    current += ch;
    hasToken = true;
  }

  if (escape) {
    throw new Error('Invalid command: trailing backslash');
  }
  if (mode !== 'none') {
    throw new Error('Invalid command: unterminated quote');
  }

  push();
  return argv;
}

// ============================================================================
// Tool Definition
// ============================================================================

export const BashTool = defineTool(
	  'bash',
	  'builtin',
	  async () => ({
	    description: `Execute a command (no shell evaluation).

IMPORTANT: This tool is for terminal operations like git, npm, docker, etc.

Usage notes:
- Provide either command (string) or argv (string[]).
- You can specify an optional timeout in milliseconds (max 600000ms / 10 minutes).
- Always quote file paths that contain spaces with double quotes.
- If the output exceeds ${MAX_OUTPUT_LENGTH} characters, it will be truncated.
- If you need shell features (pipes, redirects, glob expansion), run them explicitly via argv like: ["bash","-lc","..."].
- Avoid using find, grep, cat, head, tail, sed, awk for file operations - use dedicated tools instead.`,

    parameters: z.object({
      command: z.string().optional().describe('The command to execute (string form; no shell evaluation)'),
      argv: z.array(z.string()).optional().describe('The command to execute (argv form; preferred for precision)'),
      timeout: z.number().optional().describe('Optional timeout in milliseconds'),
      workdir: z.string().optional().describe('Working directory for the command'),
      description: z.string().describe('Clear, concise description of what this command does in 5-10 words'),
    }).refine(
      (v) => Boolean(v.argv?.length) || Boolean(v.command?.trim()),
      { message: 'Either argv or command is required', path: ['command'] },
    ),

    async execute(params, ctx: ToolExecutionContext) {
      const cwd = params.workdir
        ? (path.isAbsolute(params.workdir) ? params.workdir : path.resolve(process.cwd(), params.workdir))
        : process.cwd();
      const timeout = params.timeout ?? DEFAULT_TIMEOUT;

      if (params.timeout !== undefined && params.timeout < 0) {
        throw new Error(`Invalid timeout value: ${params.timeout}. Timeout must be a positive number.`);
      }
      if (params.timeout !== undefined && params.timeout > MAX_TIMEOUT) {
        throw new Error(`Invalid timeout value: ${params.timeout}. Timeout must be <= ${MAX_TIMEOUT}.`);
      }

      const argv = Array.isArray(params.argv) && params.argv.length > 0
        ? params.argv.map((x) => String(x))
        : parseCommandLine(String(params.command ?? ''));

      if (argv.length === 0 || !argv[0]) {
        throw new Error('Invalid command: empty argv');
      }

      // Spawn the process
      const proc = spawn(argv[0], argv.slice(1), {
        shell: false,
        cwd,
        env: process.env,
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: process.platform !== 'win32',
      });

      let output = '';

      // Initialize metadata
      ctx.metadata({
        metadata: {
          output: '',
          description: params.description,
        },
      });

      const append = (chunk: Buffer) => {
        if (output.length <= MAX_OUTPUT_LENGTH) {
          output += chunk.toString();
          ctx.metadata({
            metadata: {
              output,
              description: params.description,
            },
          });
        }
      };

      proc.stdout?.on('data', append);
      proc.stderr?.on('data', append);

      let timedOut = false;
      let aborted = false;
      let exited = false;

      const kill = () => {
        if (exited) return;
        try {
          if (process.platform !== 'win32' && proc.pid) {
            process.kill(-proc.pid, 'SIGTERM');
          } else {
            proc.kill('SIGTERM');
          }
        } catch {
          // Process may have already exited
        }
      };

      if (ctx.abort.aborted) {
        aborted = true;
        kill();
      }

      const abortHandler = () => {
        aborted = true;
        kill();
      };

      ctx.abort.addEventListener('abort', abortHandler, { once: true });

      const timeoutTimer = setTimeout(() => {
        timedOut = true;
        kill();
      }, timeout + 100);

      await new Promise<void>((resolve, reject) => {
        const cleanup = () => {
          clearTimeout(timeoutTimer);
          ctx.abort.removeEventListener('abort', abortHandler);
        };

        proc.once('exit', () => {
          exited = true;
          cleanup();
          resolve();
        });

        proc.once('error', (error) => {
          exited = true;
          cleanup();
          reject(error);
        });
      });

      const resultMetadata: string[] = ['<bash_metadata>'];

      if (output.length > MAX_OUTPUT_LENGTH) {
        output = output.slice(0, MAX_OUTPUT_LENGTH);
        resultMetadata.push(`bash tool truncated output as it exceeded ${MAX_OUTPUT_LENGTH} char limit`);
      }

      if (timedOut) {
        resultMetadata.push(`bash tool terminated command after exceeding timeout ${timeout} ms`);
      }

      if (aborted) {
        resultMetadata.push('User aborted the command');
      }

      if (resultMetadata.length > 1) {
        resultMetadata.push('</bash_metadata>');
        output += '\n\n' + resultMetadata.join('\n');
      }

      return {
        title: params.description,
        metadata: {
          output,
          exit: proc.exitCode,
          description: params.description,
        },
        output,
      };
    },
  })
);
