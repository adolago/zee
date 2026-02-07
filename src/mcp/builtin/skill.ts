/**
 * Skill Tool
 *
 * Load specialized skill instructions for specific tasks.
 * Skills provide domain-specific knowledge and step-by-step guidance.
 */

import { z } from 'zod';
import { defineTool } from '../registry';
import type { ToolExecutionContext } from '../types';

// ============================================================================
// Skill Registry (placeholder - would be loaded from config/files)
// ============================================================================

interface Skill {
  name: string;
  description: string;
  location: string;
  content?: string;
}

const skillRegistry: Skill[] = [
  {
    name: 'code-review',
    description: 'Comprehensive code review with security, performance, and maintainability checks',
    location: '/skills/code-review.md',
  },
  {
    name: 'commit',
    description: 'Create well-formatted git commits following conventional commit standards',
    location: '/skills/commit.md',
  },
  {
    name: 'pr-create',
    description: 'Create pull requests with proper descriptions and checklists',
    location: '/skills/pr-create.md',
  },
  {
    name: 'tdd',
    description: 'Test-driven development workflow with red-green-refactor cycle',
    location: '/skills/tdd.md',
  },
  {
    name: 'refactor',
    description: 'Code refactoring patterns and best practices',
    location: '/skills/refactor.md',
  },
];

// ============================================================================
// Tool Definition
// ============================================================================

// Filter skills by agent permissions if available (placeholder)
const accessibleSkills = skillRegistry;

const skillList = accessibleSkills
  .map((s) => `  <skill>\n    <name>${s.name}</name>\n    <description>${s.description}</description>\n  </skill>`)
  .join('\n');

const SkillParameters = z.object({
  name: z.string().describe("The skill identifier from available_skills (e.g., 'code-review')"),
});

export const SkillTool = defineTool('skill', 'builtin', {
  description: `Load a skill to get detailed instructions for a specific task.

Skills provide specialized knowledge and step-by-step guidance.
Use this when a task matches an available skill's description.

<available_skills>
${skillList}
</available_skills>`,

  parameters: SkillParameters,

  async execute(params, _execCtx: ToolExecutionContext) {
    const skill = skillRegistry.find((s) => s.name === params.name);

    if (!skill) {
      const available = skillRegistry.map((s) => s.name).join(', ');
      throw new Error(`Skill "${params.name}" not found. Available skills: ${available || 'none'}`);
    }

    // In a real implementation, this would load the skill content from the file.
    const content =
      skill.content || `# Skill: ${skill.name}\n\n${skill.description}\n\n[Skill content would be loaded from ${skill.location}]`;

    const output = [
      `## Skill: ${skill.name}`,
      '',
      `**Location**: ${skill.location}`,
      '',
      content,
    ].join('\n');

    return {
      title: `Loaded skill: ${skill.name}`,
      output,
      metadata: {
        name: skill.name,
        location: skill.location,
      },
    };
  },
});
