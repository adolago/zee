/**
 * Persona Module - Identity and persona management
 *
 * This module handles loading and managing agent personas from various sources:
 * - Built-in personas (src/agent/personas/)
 * - Identity files (IDENTITY.md, SOUL.md)
 * - Project personas (.zee/agent/)
 * - Config overrides
 */

import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { z } from "zod";
import matter from "gray-matter";
import { AgentInfo, AgentMode, Permission, parseModelString } from "./agent";

/**
 * Soul layer - Core values and personality traits
 * Loaded from SOUL.md or soul.yaml
 */
export const Soul = z.object({
  /** Core truths/principles the agent follows */
  truths: z.array(z.string()),

  /** Boundaries the agent must respect */
  boundaries: z.array(z.string()),

  /** Personality and communication style */
  vibe: z.object({
    traits: z.array(z.string()),
    communication: z.string().optional(),
  }),

  /** Named directives (e.g., privacy, continuity) */
  directives: z.record(z.string(), z.string()).optional(),

  /** Goal or purpose */
  goal: z.string().optional(),
});
export type Soul = z.infer<typeof Soul>;

/**
 * Identity layer - Who the agent is
 * Loaded from IDENTITY.md or identity.yaml
 */
export const Identity = z.object({
  /** Agent name */
  name: z.string(),

  /** What kind of entity (e.g., "AI companion") */
  creature: z.string().optional(),

  /** Short description of personality/vibe */
  vibe: z.string().optional(),

  /** Optional emoji representation (or "none") */
  emoji: z.string().optional(),

  /** Extended about section */
  about: z.string().optional(),

  /** Infrastructure/context information */
  infrastructure: z.record(z.string(), z.string()).optional(),

  /** How identity persists across sessions */
  continuity: z.string().optional(),

  /** Core values */
  values: z.array(z.string()).optional(),
});
export type Identity = z.infer<typeof Identity>;

/**
 * Persona definition - Role-specific configuration
 * Loaded from persona YAML/MD files
 */
export const PersonaDefinition = z.object({
  // === Identity ===

  /** Persona name/identifier */
  name: z.string(),

  /** Description of when to use this persona */
  description: z.string(),

  /** Operating mode */
  mode: AgentMode.default("primary"),

  // === Categorization ===

  /** Use case category */
  useCase: z.enum(["stanley", "zee", "agent-core", "custom"]).optional(),

  /** Display color */
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .optional(),

  // === Model Configuration ===

  /** Model in format "provider/model" */
  model: z.string().optional(),

  /** Temperature for generation */
  temperature: z.number().min(0).max(2).optional(),

  /** Top-P sampling */
  topP: z.number().min(0).max(1).optional(),

  /** Maximum agentic steps */
  maxSteps: z.number().int().positive().optional(),

  // === Tools ===

  /** Tool overrides (true = enabled, false = disabled) */
  tools: z.record(z.string(), z.boolean()).optional(),

  // === Permissions ===

  /** Permission overrides */
  permission: z
    .object({
      edit: Permission.optional(),
      bash: z.union([Permission, z.record(z.string(), Permission)]).optional(),
      skill: z.union([Permission, z.record(z.string(), Permission)]).optional(),
      mcp: z.union([Permission, z.record(z.string(), Permission)]).optional(),
      webfetch: Permission.optional(),
      external_directory: Permission.optional(),
      doom_loop: Permission.optional(),
    })
    .optional(),

  // === Prompt ===

  /** System prompt content */
  prompt: z.string().optional(),

  // === Identity Files ===

  /** Paths to identity files to load */
  identityFiles: z.array(z.string()).optional(),

  // === Inheritance ===

  /** Parent persona to extend */
  extends: z.string().optional(),

  // === Visibility ===

  /** Whether to hide from user selection */
  hidden: z.boolean().optional(),

  /** Whether this is the default persona */
  default: z.boolean().optional(),
});
export type PersonaDefinition = z.infer<typeof PersonaDefinition>;

/**
 * Persona configuration for loading
 */
export const PersonaConfig = z.object({
  /** Path to IDENTITY.md file */
  identityPath: z.string().optional(),

  /** Path to SOUL.md file */
  soulPath: z.string().optional(),

  /** Directories to scan for personas */
  personaDirs: z.array(z.string()).optional(),

  /** Active persona name */
  activePersona: z.string().optional(),

  /** Default persona if none specified */
  defaultPersona: z.string().optional(),
});
export type PersonaConfig = z.infer<typeof PersonaConfig>;

/**
 * Loaded identity context
 */
export interface IdentityContext {
  identity?: Identity;
  soul?: Soul;
  prompt?: string;
}

function resolveIdentityPath(inputPath: string, cwd?: string): string {
  let resolved = inputPath.replace(/\$\{([^}]+)\}/g, (_match, varName) => {
    return process.env[varName] ?? "";
  });

  if (resolved === "~") {
    resolved = homedir();
  } else if (resolved.startsWith("~/")) {
    resolved = path.join(homedir(), resolved.slice(2));
  }

  return path.isAbsolute(resolved) ? resolved : path.resolve(cwd ?? process.cwd(), resolved);
}

function mergeIdentity(base: Identity | undefined, next: Identity): Identity {
  if (!base) return next;

  return Identity.parse({
    name: next.name || base.name,
    creature: next.creature ?? base.creature,
    vibe: next.vibe ?? base.vibe,
    emoji: next.emoji ?? base.emoji,
    about: next.about ?? base.about,
    continuity: next.continuity ?? base.continuity,
    values: [...(base.values ?? []), ...(next.values ?? [])],
    infrastructure: {
      ...(base.infrastructure ?? {}),
      ...(next.infrastructure ?? {}),
    },
  });
}

function mergeSoul(base: Soul | undefined, next: Soul): Soul {
  if (!base) return next;

  return Soul.parse({
    truths: [...(base.truths ?? []), ...(next.truths ?? [])],
    boundaries: [...(base.boundaries ?? []), ...(next.boundaries ?? [])],
    vibe: {
      traits: [...(base.vibe?.traits ?? []), ...(next.vibe?.traits ?? [])],
      communication: next.vibe?.communication ?? base.vibe?.communication,
    },
    directives: { ...(base.directives ?? {}), ...(next.directives ?? {}) },
    goal: next.goal ?? base.goal,
  });
}

/**
 * Persona namespace for persona management
 */
export namespace Persona {
  /** Schema exports */
  export const Definition = PersonaDefinition;
  export const Config = PersonaConfig;

  /**
   * Parse markdown frontmatter from a persona file using gray-matter
   */
  export function parseFrontmatter(content: string): {
    data: Record<string, unknown>;
    content: string;
  } {
    const parsed = matter(content);
    return {
      data: parsed.data as Record<string, unknown>,
      content: parsed.content.trim(),
    };
  }

  /**
   * Parse IDENTITY.md format
   */
  export function parseIdentityMd(content: string): Identity {
    const result: Partial<Identity> = {};

    // Parse bullet points with bold labels using matchAll to avoid lastIndex issues
    const labelMatches = content.matchAll(/\*\*([^*]+)\*\*:\s*(.+)/g);
    for (const match of labelMatches) {
      const label = match[1].toLowerCase();
      const value = match[2].trim();

      switch (label) {
        case "name":
          result.name = value;
          break;
        case "creature":
          result.creature = value;
          break;
        case "vibe":
          result.vibe = value;
          break;
        case "emoji":
          result.emoji = value === "(none)" ? undefined : value;
          break;
      }
    }

    // Parse "About Me" section
    const aboutMatch = content.match(/## About Me\s*\n([\s\S]*?)(?=\n##|$)/);
    if (aboutMatch) {
      result.about = aboutMatch[1].trim();
    }

    // Parse values from bullet points
    const valuesMatch = content.match(/I value:\s*\n((?:\s*-\s+\*\*[^*]+\*\*.*\n?)+)/);
    if (valuesMatch) {
      result.values = [];
      const valueRegex = /-\s+\*\*([^*]+)\*\*/g;
      let valueMatch;
      while ((valueMatch = valueRegex.exec(valuesMatch[1])) !== null) {
        result.values.push(valueMatch[1]);
      }
    }

    // Parse infrastructure
    const infraMatch = content.match(/## My Infrastructure\s*\n([\s\S]*?)(?=\n##|$)/);
    if (infraMatch) {
      result.infrastructure = {};
      const infraRegex = /-\s+\*\*([^*]+)\*\*:\s*(.+)/g;
      let infraItem;
      while ((infraItem = infraRegex.exec(infraMatch[1])) !== null) {
        result.infrastructure[infraItem[1].toLowerCase()] = infraItem[2].trim();
      }
    }

    // Parse continuity
    const continuityMatch = content.match(/## Continuity\s*\n([\s\S]*?)(?=\n##|$)/);
    if (continuityMatch) {
      result.continuity = continuityMatch[1].trim();
    }

    return Identity.parse(result);
  }

  /**
   * Parse SOUL.md format
   */
  export function parseSoulMd(content: string): Soul {
    const result: Partial<Soul> = {
      truths: [],
      boundaries: [],
      vibe: { traits: [] },
      directives: {},
    };

    // Parse Core Truths section
    const truthsMatch = content.match(/## Core Truths\s*\n([\s\S]*?)(?=\n##|$)/);
    if (truthsMatch) {
      const truthRegex = /\*\*([^*]+)\*\*/g;
      let truthMatch;
      while ((truthMatch = truthRegex.exec(truthsMatch[1])) !== null) {
        result.truths!.push(truthMatch[1]);
      }
    }

    // Parse Boundaries section
    const boundariesMatch = content.match(/## Boundaries\s*\n([\s\S]*?)(?=\n##|$)/);
    if (boundariesMatch) {
      const boundaryRegex = /-\s+(.+)/g;
      let boundaryMatch;
      while ((boundaryMatch = boundaryRegex.exec(boundariesMatch[1])) !== null) {
        result.boundaries!.push(boundaryMatch[1].trim());
      }
    }

    // Parse Vibe section
    const vibeMatch = content.match(/## Vibe\s*\n([\s\S]*?)(?=\n##|$)/);
    if (vibeMatch) {
      const traitRegex = /-\s+(.+)/g;
      let traitMatch;
      while ((traitMatch = traitRegex.exec(vibeMatch[1])) !== null) {
        result.vibe!.traits.push(traitMatch[1].trim());
      }
    }

    // Parse Privacy Directive
    const privacyMatch = content.match(/## Privacy Directive\s*\n([\s\S]*?)(?=\n##|$)/);
    if (privacyMatch) {
      result.directives!.privacy = privacyMatch[1].trim();
    }

    // Parse Syntony section as goal
    const syntonyMatch = content.match(/## Syntony\s*\n([\s\S]*?)(?=\n##|$)/);
    if (syntonyMatch) {
      result.goal = syntonyMatch[1].trim();
    }

    return Soul.parse(result);
  }

  /**
   * Load identity and soul files into a structured context.
   */
  export async function loadIdentityContext(
    identityFiles: string[] | undefined,
    opts?: { cwd?: string }
  ): Promise<IdentityContext | undefined> {
    if (!identityFiles || identityFiles.length === 0) {
      return undefined;
    }

    const context: IdentityContext = {};

    for (const rawPath of identityFiles) {
      const resolved = resolveIdentityPath(rawPath, opts?.cwd);
      let content: string;

      try {
        content = await readFile(resolved, "utf-8");
      } catch {
        continue;
      }

      const trimmed = content.trim();
      if (!trimmed) continue;

      const basename = path.basename(resolved).toLowerCase();
      const isIdentity = basename.includes("identity");
      const isSoul = basename.includes("soul");

      if (isIdentity) {
        try {
          context.identity = mergeIdentity(context.identity, parseIdentityMd(trimmed));
        } catch {
          continue;
        }
      } else if (isSoul) {
        try {
          context.soul = mergeSoul(context.soul, parseSoulMd(trimmed));
        } catch {
          continue;
        }
      } else {
        try {
          context.identity = mergeIdentity(context.identity, parseIdentityMd(trimmed));
          continue;
        } catch {}
        try {
          context.soul = mergeSoul(context.soul, parseSoulMd(trimmed));
        } catch {}
      }
    }

    if (!context.identity && !context.soul && !context.prompt) return undefined;
    return context;
  }

  /**
   * Compose the identity/soul prompt block.
   */
  export function composeIdentityPrompt(identity?: IdentityContext): string {
    if (!identity) return "";

    const parts: string[] = [];

    if (identity.prompt?.trim()) {
      parts.push(identity.prompt.trim());
      parts.push("");
    }

    if (identity.identity) {
      const id = identity.identity;
      parts.push(`# ${id.name}`);
      if (id.creature) {
        parts.push(`*${id.creature}*`);
      }
      if (id.vibe) {
        parts.push(`**Vibe:** ${id.vibe}`);
      }
      if (id.about) {
        parts.push(`\n${id.about}`);
      }
      parts.push("");
    }

    if (identity.soul) {
      const soul = identity.soul;

      if (soul.truths.length > 0) {
        parts.push("## Core Principles");
        for (const truth of soul.truths) {
          parts.push(`- ${truth}`);
        }
        parts.push("");
      }

      if (soul.boundaries.length > 0) {
        parts.push("## Boundaries");
        for (const boundary of soul.boundaries) {
          parts.push(`- ${boundary}`);
        }
        parts.push("");
      }

      if (soul.goal) {
        parts.push("## Goal");
        parts.push(soul.goal);
        parts.push("");
      }
    }

    return parts.join("\n").trim();
  }

  /**
   * Convert a persona definition to agent info
   */
  export function toAgentInfo(
    persona: PersonaDefinition,
    identity?: IdentityContext
  ): AgentInfo {
    const result: AgentInfo = {
      name: persona.name,
      description: persona.description,
      mode: persona.mode,
      native: false, // Personas are not native system agents
      hidden: persona.hidden ?? false,
      default: persona.default ?? false,
      color: persona.color,
      useCase: persona.useCase,
    };

    // Model configuration
    if (persona.model) {
      result.model = parseModelString(persona.model);
    }

    // Sampling parameters
    if (persona.temperature !== undefined) {
      result.temperature = persona.temperature;
    }
    if (persona.topP !== undefined) {
      result.topP = persona.topP;
    }
    if (persona.maxSteps !== undefined) {
      result.maxSteps = persona.maxSteps;
    }

    // Permissions - normalize to complete permission config
    if (persona.permission) {
      result.permission = {
        edit: persona.permission.edit ?? "ask",
        bash: persona.permission.bash ?? "ask",
        skill: persona.permission.skill ?? "allow",
        mcp: persona.permission.mcp ?? "allow",
        webfetch: persona.permission.webfetch ?? "allow",
        external_directory: persona.permission.external_directory ?? "ask",
        doom_loop: persona.permission.doom_loop ?? "ask",
      };
    }

    // Tools
    if (persona.tools) {
      result.tools = persona.tools;
    }

    // Compose prompt from identity and persona
    if (identity || persona.prompt) {
      result.prompt = composePrompt(persona, identity);
    }

    return result;
  }

  /**
   * Compose a system prompt from identity context and persona
   */
  function composePrompt(
    persona: PersonaDefinition,
    identity?: IdentityContext
  ): string {
    const parts: string[] = [];

    const identityPrompt = composeIdentityPrompt(identity);
    if (identityPrompt) {
      parts.push(identityPrompt);
    }

    if (persona.prompt) {
      parts.push(persona.prompt);
    }

    return parts.join("\n\n").trim();
  }

  /**
   * Merge two persona definitions
   * Child values override parent values
   */
  export function mergeDefinitions(
    parent: PersonaDefinition,
    child: Partial<PersonaDefinition>
  ): PersonaDefinition {
    const result = { ...parent, ...child };

    // Merge permissions
    if (parent.permission && child.permission) {
      result.permission = { ...parent.permission, ...child.permission };

      // Deep merge pattern-based permissions
      for (const key of ["bash", "skill", "mcp"] as const) {
        const parentVal = parent.permission[key];
        const childVal = child.permission[key];
        if (typeof parentVal === "object" && typeof childVal === "object") {
          (result.permission as any)[key] = { ...parentVal, ...childVal };
        }
      }
    }

    // Merge tools
    if (parent.tools && child.tools) {
      result.tools = { ...parent.tools, ...child.tools };
    }

    // Merge identity files
    if (parent.identityFiles && child.identityFiles) {
      result.identityFiles = [...parent.identityFiles, ...child.identityFiles];
    }

    return PersonaDefinition.parse(result);
  }

  /**
   * Get persona file extension handlers
   */
  export function getFormatHandlers(): Record<
    string,
    (content: string) => PersonaDefinition
  > {
    return {
      ".yaml": (content) => {
        // Parse YAML and validate
        const { data } = parseFrontmatter(`---\n${content}\n---\n`);
        return PersonaDefinition.parse(data);
      },
      ".yml": (content) => {
        const { data } = parseFrontmatter(`---\n${content}\n---\n`);
        return PersonaDefinition.parse(data);
      },
      ".md": (content) => {
        const { data, content: prompt } = parseFrontmatter(content);
        return PersonaDefinition.parse({ ...data, prompt });
      },
    };
  }
}
