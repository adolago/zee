/**
 * Task Tool
 *
 * Spawns a subagent execution via Claude Code CLI.
 * Supports specialized profiles with strict tool constraints.
 */

import { z } from 'zod';
import { defineTool } from '../registry';
import type { ToolExecutionContext, ToolExecutionResult } from '../types';
import { resolveToolSandbox } from '../security/sandbox';
import {
  DEFAULT_TIMEOUT_MS,
  MAX_TIMEOUT_MS,
  isClaudeCliInstalled,
  readClaudeCredentials,
  spawnClaudeCli,
} from '../../domain/zee/claude-code';

type Profile = {
  name: string;
  description: string;
  model?: 'opus' | 'sonnet' | 'haiku';
  allowedTools?: string[];
  disallowedTools?: string[];
  systemPrompt?: string;
};

const PROFILES: Record<string, Profile> = {
  researcher: {
    name: 'researcher',
    description: 'Research and analyze information with read-only tools',
    model: 'sonnet',
    allowedTools: ['Read', 'Glob', 'Grep', 'WebFetch', 'Bash(git status:*)', 'Bash(git log:*)'],
    disallowedTools: ['Edit', 'Write', 'Bash(git commit:*)', 'Bash(git push:*)'],
  },
  coder: {
    name: 'coder',
    description: 'Write and refactor code',
    model: 'sonnet',
  },
  tester: {
    name: 'tester',
    description: 'Run tests and diagnose failures',
    model: 'sonnet',
    disallowedTools: ['Bash(git push:*)'],
  },
  reviewer: {
    name: 'reviewer',
    description: 'Review changes and identify issues',
    model: 'sonnet',
    allowedTools: ['Read', 'Glob', 'Grep', 'WebFetch', 'Bash(git status:*)', 'Bash(git diff:*)', 'Bash(git log:*)'],
    disallowedTools: ['Edit', 'Write', 'Bash(git commit:*)', 'Bash(git push:*)'],
  },
  documenter: {
    name: 'documenter',
    description: 'Draft and improve technical documentation',
    model: 'sonnet',
  },
  librarian: {
    name: 'librarian',
    description: 'GitHub-focused read-only analysis specialist',
    model: 'sonnet',
    allowedTools: [
      'Read',
      'Glob',
      'Grep',
      'WebFetch',
      'Bash(gh:*)',
      'Bash(git status:*)',
      'Bash(git log:*)',
      'Bash(git diff:*)',
    ],
    disallowedTools: ['Edit', 'Write', 'Bash(git commit:*)', 'Bash(git push:*)', 'Bash(rm:*)'],
    systemPrompt:
      'You are a GitHub librarian subagent. Focus on repo/PR/issue inspection and factual summaries. ' +
      'Do not mutate repository state.',
  },
};

const PROFILE_ALIASES: Record<string, string> = {
  researcher: 'researcher',
  analyst: 'researcher',
  coder: 'coder',
  developer: 'coder',
  tester: 'tester',
  qa: 'tester',
  reviewer: 'reviewer',
  documenter: 'documenter',
  docs: 'documenter',
  librarian: 'librarian',
  'github-librarian': 'librarian',
  github: 'librarian',
  gh: 'librarian',
};

function normalizeSubagentType(input: string): string {
  const normalized = input.trim().toLowerCase();
  return PROFILE_ALIASES[normalized] ?? normalized;
}

function resolveProfile(requested: string): Profile {
  const resolved = normalizeSubagentType(requested);
  return PROFILES[resolved] ?? {
    name: resolved,
    description: 'General-purpose subagent',
    model: 'sonnet',
  };
}

export function resolveSubagentProfileName(requested: string): string {
  return resolveProfile(requested).name;
}

const agentList = Object.values(PROFILES)
  .map((profile) => `- ${profile.name}: ${profile.description}`)
  .join('\n');

const TaskParameters = z.object({
  description: z.string().describe('A short description of the task'),
  prompt: z.string().describe('The task for the subagent to perform'),
  subagent_type: z.string().describe('The type of specialized agent to use for this task'),
  session_id: z.string().optional().describe('Existing subagent session to continue'),
  task_id: z.string().optional().describe('Alias for session_id (backwards compatibility)'),
  timeoutMs: z.number().int().positive().optional().describe(`Timeout in ms (default: ${DEFAULT_TIMEOUT_MS})`),
  workingDir: z.string().optional().describe('Working directory override'),
});

export const TaskTool = defineTool('task', 'builtin', {
  description: `Create and run a subagent task.

Available subagents:
${agentList}

Behavior:
- Executes a real subagent run through Claude Code CLI
- Supports session continuation with session_id (or task_id)
- Applies profile-specific tool restrictions for safety`,

  parameters: TaskParameters,

  async execute(
    params,
    execCtx: ToolExecutionContext
  ): Promise<ToolExecutionResult<Record<string, unknown>>> {
    const profile = resolveProfile(params.subagent_type);
    const sandbox = resolveToolSandbox(execCtx);
    const workingDir = params.workingDir?.trim() || sandbox.cwd;
    const timeoutMs = Math.min(params.timeoutMs ?? DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS);
    const sessionId = params.session_id || params.task_id;

    execCtx.metadata({
      title: params.description,
      metadata: {
        sessionId,
        subagentType: profile.name,
        timeoutMs,
      },
    });

    if (execCtx.abort.aborted) {
      throw new Error('Task aborted before execution');
    }

    if (!isClaudeCliInstalled()) {
      return {
        title: params.description,
        metadata: {
          subagentType: profile.name,
          error: 'claude_not_installed',
        },
        output: [
          `Task failed: ${params.description}`,
          'Claude Code CLI is not installed.',
          'Install with: npm install -g @anthropic-ai/claude-code@latest',
        ].join('\n'),
      };
    }

    const credentials = readClaudeCredentials();
    if (!credentials) {
      return {
        title: params.description,
        metadata: {
          subagentType: profile.name,
          error: 'claude_not_authenticated',
        },
        output: [
          `Task failed: ${params.description}`,
          'Claude Code CLI is not authenticated.',
          'Run: claude login',
        ].join('\n'),
      };
    }

    const result = await spawnClaudeCli({
      prompt: params.prompt,
      model: profile.model,
      sessionId,
      workingDir,
      timeoutMs,
      dangerouslySkipPermissions: true,
      shareMcpConfig: true,
      shareSkills: true,
      additionalDirs: [sandbox.root],
      allowedTools: profile.allowedTools,
      disallowedTools: profile.disallowedTools,
      systemPrompt: profile.systemPrompt,
    });

    if (!result.success) {
      return {
        title: params.description,
        metadata: {
          sessionId: result.sessionId ?? sessionId,
          subagentType: profile.name,
          error: result.error ?? 'task_failed',
          durationMs: result.durationMs,
          model: result.model,
        },
        output: [
          `Task failed: ${params.description}`,
          `Agent: ${profile.name}`,
          `Error: ${result.error ?? 'Unknown error'}`,
        ].join('\n'),
      };
    }

    const outputSessionId = result.sessionId ?? sessionId ?? `task-${Date.now()}`;
    const output = [
      `task_id: ${outputSessionId}`,
      '',
      '<task_result>',
      result.output || '(No output)',
      '</task_result>',
    ].join('\n');

    return {
      title: params.description,
      metadata: {
        sessionId: outputSessionId,
        subagentType: profile.name,
        durationMs: result.durationMs,
        model: result.model,
      },
      output,
    };
  },
});
