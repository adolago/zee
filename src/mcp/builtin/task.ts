/**
 * Task Tool
 *
 * Spawn subagent tasks for parallel or specialized work.
 * Creates child sessions that can be monitored.
 */

import { z } from 'zod';
import { defineTool } from '../registry';
import type { ToolExecutionContext } from '../types';

// ============================================================================
// Tool Definition
// ============================================================================

// Get available subagents from context (placeholder)
const availableAgents = [
  { name: 'researcher', description: 'Research and analyze information' },
  { name: 'coder', description: 'Write and refactor code' },
  { name: 'tester', description: 'Write and run tests' },
  { name: 'reviewer', description: 'Review code and provide feedback' },
  { name: 'documenter', description: 'Write documentation' },
];

const agentList = availableAgents
  .map((a) => `- ${a.name}: ${a.description}`)
  .join('\n');

const TaskParameters = z.object({
  description: z.string().describe('A short (3-5 words) description of the task'),
  prompt: z.string().describe('The task for the agent to perform'),
  subagent_type: z.string().describe('The type of specialized agent to use for this task'),
  session_id: z.string().optional().describe('Existing Task session to continue'),
});

export const TaskTool = defineTool('task', 'builtin', {
  description: `Create a subagent task for parallel or specialized work.

Available subagents:
${agentList}

Usage:
- Provide a clear, specific prompt for the subagent
- The subagent runs in its own session with limited tools
- Results are returned when the task completes`,

  parameters: TaskParameters,

  async execute(params, execCtx: ToolExecutionContext) {
    // In a real implementation, this would spawn a subagent session.
    // For now, we return a placeholder that indicates the task pattern.

    const sessionId = params.session_id || `task-${Date.now()}`;

    execCtx.metadata({
      title: params.description,
      metadata: {
        sessionId,
        agentType: params.subagent_type,
      },
    });

    // This would normally:
    // 1. Create a new session with parentID = execCtx.sessionId
    // 2. Run the prompt through the specified subagent
    // 3. Return the results

    const output = [
      `Task started: ${params.description}`,
      `Agent: ${params.subagent_type}`,
      '',
      '<task_metadata>',
      `session_id: ${sessionId}`,
      '</task_metadata>',
    ].join('\n');

    return {
      title: params.description,
      metadata: {
        sessionId,
        agentType: params.subagent_type,
      },
      output,
    };
  },
});
