/**
 * Persona Mapping
 *
 * Maps personas (Zee, Stanley, Johny) to orchestration metadata.
 * Each persona can spawn drones that inherit their identity and capabilities.
 */

import type { PersonaId, OrchestrationPersona } from "./types";
import { ORCHESTRATION_PERSONAS } from "./types";
import { existsSync, readFileSync } from "fs";
import { join, dirname, resolve } from "path";

// Import AGENT_CONFIGS for tool injection
import { AGENT_CONFIGS } from "../agent/personas";

// =============================================================================
// Skill Loading
// =============================================================================

interface SkillFrontmatter {
  name: string;
  description?: string;
  includes?: string[];
}

interface LoadedSkill {
  frontmatter: SkillFrontmatter;
  content: string;
}

// Cache for loaded skills
const skillCache = new Map<string, LoadedSkill>();

/**
 * Find the skills directory (supports both dev and installed paths)
 */
/** Candidate skill directory names in precedence order. */
const SKILL_DIR_CANDIDATES = [".agents/skills", ".claude/skills"] as const;

function findSkillsDirFrom(startDir: string): string | undefined {
  let current = resolve(startDir);
  for (;;) {
    for (const rel of SKILL_DIR_CANDIDATES) {
      const candidate = join(current, rel);
      if (existsSync(candidate)) return candidate;
    }
    const parent = dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

function findSkillsDir(): string {
  const envRoot =
    process.env.ZEE_SOURCE || process.env.ZEE_ROOT;
  if (envRoot) {
    for (const rel of SKILL_DIR_CANDIDATES) {
      const envSkills = join(envRoot, rel);
      if (existsSync(envSkills)) return envSkills;
    }
  }

  const starts = [process.cwd(), dirname(process.execPath)];
  const argvPath = process.argv[1];
  if (argvPath) starts.push(dirname(resolve(argvPath)));

  for (const start of starts) {
    const skillsDir = findSkillsDirFrom(start);
    if (skillsDir) return skillsDir;
  }

  // Fallback to cwd
  return join(process.cwd(), ".agents", "skills");
}

/**
 * Parse YAML frontmatter from markdown content
 */
function parseFrontmatter(content: string): { frontmatter: SkillFrontmatter; body: string } {
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) {
    return { frontmatter: { name: "unknown" }, body: content };
  }

  const yamlContent = match[1];
  const body = match[2];

  // Simple YAML parsing for our use case
  const frontmatter: SkillFrontmatter = { name: "unknown" };
  const lines = yamlContent.split("\n");
  let currentKey = "";
  let inArray = false;
  const arrayValues: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Check for array item
    if (trimmed.startsWith("- ") && inArray) {
      arrayValues.push(trimmed.slice(2).trim());
      continue;
    }

    // If we were collecting an array, save it
    if (inArray && currentKey === "includes") {
      frontmatter.includes = [...arrayValues];
      arrayValues.length = 0;
      inArray = false;
    }

    // Check for key: value
    const colonIndex = trimmed.indexOf(":");
    if (colonIndex > 0) {
      currentKey = trimmed.slice(0, colonIndex).trim();
      const value = trimmed.slice(colonIndex + 1).trim();

      if (value) {
        // Simple value
        if (currentKey === "name") frontmatter.name = value;
        else if (currentKey === "description") frontmatter.description = value;
      } else {
        // Start of array or empty
        if (currentKey === "includes") {
          inArray = true;
        }
      }
    }
  }

  // Handle case where array is at the end
  if (inArray && currentKey === "includes" && arrayValues.length > 0) {
    frontmatter.includes = [...arrayValues];
  }

  return { frontmatter, body };
}

/**
 * Load a skill by name (handles includes recursively)
 */
function loadSkill(skillName: string, skillsDir: string, loaded = new Set<string>()): LoadedSkill | null {
  // Prevent infinite loops
  if (loaded.has(skillName)) {
    return null;
  }
  loaded.add(skillName);

  // Check cache
  if (skillCache.has(skillName)) {
    return skillCache.get(skillName)!;
  }

  // Try to load the skill file (check both plain and @-prefixed paths)
  let skillPath = join(skillsDir, skillName, "SKILL.md");
  if (!existsSync(skillPath)) {
    skillPath = join(skillsDir, `@${skillName}`, "SKILL.md");
    if (!existsSync(skillPath)) {
      return null;
    }
  }

  try {
    const content = readFileSync(skillPath, "utf-8");
    const { frontmatter, body } = parseFrontmatter(content);

    // Load included skills
    let combinedContent = body;
    if (frontmatter.includes?.length) {
      const includedParts: string[] = [];
      for (const includeName of frontmatter.includes) {
        const included = loadSkill(includeName, skillsDir, loaded);
        if (included) {
          includedParts.push(`\n<!-- Included from ${includeName} -->\n${included.content}`);
        }
      }
      if (includedParts.length > 0) {
        combinedContent = body + "\n" + includedParts.join("\n");
      }
    }

    const skill: LoadedSkill = {
      frontmatter,
      content: combinedContent,
    };

    skillCache.set(skillName, skill);
    return skill;
  } catch {
    return null;
  }
}

/**
 * Get loaded skill content for a persona
 */
export function getPersonaSkillContent(persona: PersonaId): string | null {
  const skillsDir = findSkillsDir();
  const skill = loadSkill(persona, skillsDir);
  return skill?.content ?? null;
}

/**
 * Clear the skill cache (useful for reloading)
 */
export function clearSkillCache(): void {
  skillCache.clear();
}

/**
 * Get persona-specific tools from AGENT_CONFIGS
 */
export function getPersonaTools(persona: PersonaId): string[] {
  const config = AGENT_CONFIGS[persona];
  if (!config?.tools) return [];

  // Extract domain-specific tools (those with persona prefix)
  const domainTools: string[] = [];
  for (const [tool, enabled] of Object.entries(config.tools)) {
    if (enabled && tool.includes(":")) {
      domainTools.push(tool);
    }
  }

  return domainTools;
}

/**
 * Get full tool configuration for a persona
 */
export function getPersonaToolConfig(persona: PersonaId): Record<string, boolean> {
  const config = AGENT_CONFIGS[persona];
  return config?.tools ?? {};
}

/**
 * Generate a system prompt for a persona drone.
 * Includes skill content from SKILL.md files.
 */
export function generateDronePrompt(
  persona: PersonaId,
  task: string,
  context?: {
    plan?: string;
    objectives?: string[];
    keyFacts?: string[];
    includeSkills?: boolean;
  }
): string {
  const config = getPersonaConfig(persona);
  const parts: string[] = [];

  // Identity
  parts.push(`# Identity\n`);
  parts.push(`You are a ${config.displayName} drone - a background worker maintaining the ${config.displayName} persona identity.`);
  parts.push(`Domain: ${config.domain}`);
  parts.push(``);

  // Persona traits
  parts.push(`# Persona Traits`);
  config.systemPromptAdditions.forEach((trait) => {
    parts.push(`- ${trait}`);
  });
  parts.push(``);

  // Load and include skill content (if enabled, default true)
  const includeSkills = context?.includeSkills !== false;
  if (includeSkills) {
    parts.push(`# Capabilities and Tools\n`);

    // Include domain-specific tools from AGENT_CONFIGS
    const domainTools = getPersonaTools(persona);
    if (domainTools.length > 0) {
      parts.push(`## Available Domain Tools`);
      for (const tool of domainTools) {
        parts.push(`- \`${tool}\``);
      }
      parts.push(``);
    }

    // Include condensed skill content from SKILL.md
    const skillContent = getPersonaSkillContent(persona);
    if (skillContent) {
      const condensed = condenseSkillContent(skillContent, persona);
      parts.push(condensed);
      parts.push(``);
    }
  }

  // Context from queen
  if (context?.plan) {
    parts.push(`# Current Plan`);
    parts.push(context.plan);
    parts.push(``);
  }

  if (context?.objectives?.length) {
    parts.push(`# Active Objectives`);
    context.objectives.forEach((obj, i) => {
      parts.push(`${i + 1}. ${obj}`);
    });
    parts.push(``);
  }

  if (context?.keyFacts?.length) {
    parts.push(`# Key Context`);
    context.keyFacts.forEach((fact) => {
      parts.push(`- ${fact}`);
    });
    parts.push(``);
  }

  // Task
  parts.push(`# Your Task`);
  parts.push(task);
  parts.push(``);

  // Instructions
  parts.push(`# Instructions`);
  parts.push(`1. Complete the task above while maintaining ${config.displayName}'s perspective and expertise.`);
  parts.push(`2. When finished, summarize your results clearly.`);
  parts.push(`3. Note any important findings that should be shared with the queen.`);
  parts.push(`4. If you encounter blockers, document them clearly.`);

  return parts.join("\n");
}

/**
 * Condense skill content for drone prompts (extract key sections)
 */
function condenseSkillContent(content: string, persona: PersonaId): string {
  const parts: string[] = [];

  // Extract Domain Tools section if present
  const toolsMatch = content.match(/## Domain Tools[\s\S]*?\n\n(?=##|$)/);
  if (toolsMatch) {
    parts.push(toolsMatch[0].trim());
  }

  // Extract Core Capabilities section if present
  const capsMatch = content.match(/## Core Capabilities[\s\S]*?\n\n(?=##|$)/);
  if (capsMatch) {
    // Just get the headers, not all the code blocks
    const capsContent = capsMatch[0];
    const headers = capsContent.match(/### [^\n]+/g);
    if (headers) {
      parts.push(`Available capabilities: ${headers.map(h => h.replace("### ", "")).join(", ")}`);
    }
  }

  // If no structured content found, provide a summary based on persona
  if (parts.length === 0) {
    const summaries: Record<PersonaId, string> = {
      zee: "Memory storage/search, messaging (WhatsApp), calendar, contacts, notifications, Splitwise expense sharing, CodexBar usage tracking",
      stanley: "Market data, portfolio management, SEC filings, research, NautilusTrader backtesting",
      johny: "Knowledge graph, spaced repetition, concept mapping, practice problems, learning progress",
    };
    parts.push(`Tools: ${summaries[persona]}`);
  }

  return parts.join("\n\n");
}

/**
 * Get persona config by ID
 */
export function getPersonaConfig(id: PersonaId): OrchestrationPersona {
  return ORCHESTRATION_PERSONAS[id];
}

/**
 * Generate a worker name
 */
export function generateWorkerName(persona: PersonaId, role: "queen" | "drone", index?: number): string {
  const config = getPersonaConfig(persona);
  if (role === "queen") {
    return `${config.displayName} (Queen)`;
  }
  return `${config.displayName}-drone-${index ?? Math.floor(Math.random() * 1000)}`;
}
