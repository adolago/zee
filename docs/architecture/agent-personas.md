# Agent Persona System Architecture

## Overview

The agent persona system provides a unified approach to agent identity and behavior configuration across three use cases:

1. **Stanley** - Professional financial analysis platform
2. **Zee** - Personal AI assistant
3. **Johny** - Learning and knowledge systems

## Design Principles

### 1. Layered Identity Model

```
+----------------------------------+
|          Soul Layer              |  <- Core values, personality
|    (SOUL.md / soul.yaml)         |
+----------------------------------+
|        Identity Layer            |  <- Name, description, vibe
|  (IDENTITY.md / identity.yaml)   |
+----------------------------------+
|        Persona Layer             |  <- Role-specific config
|    (personas/*.yaml)             |
+----------------------------------+
|       Capability Layer           |  <- Tools, permissions
|    (runtime configuration)       |
+----------------------------------+
```

### 2. Context Hierarchy

```
Global Identity (~/.config/zee/)
    |
    +-- Project Personas (.zee/agent/)
    |       |
    |       +-- Session Overrides (runtime)
    |
    +-- Built-in Personas (src/agent/personas/)
```

## Component Design

### Core Types (`src/agent/agent.ts`)

```typescript
import { z } from 'zod';

// Permission levels
export const Permission = z.enum(['allow', 'ask', 'deny']);
export type Permission = z.infer<typeof Permission>;

// Agent operating modes
export const AgentMode = z.enum(['primary', 'subagent', 'all']);
export type AgentMode = z.infer<typeof AgentMode>;

// Model configuration
export const ModelConfig = z.object({
  providerID: z.string(),
  modelID: z.string(),
});
export type ModelConfig = z.infer<typeof ModelConfig>;

// Permission configuration
export const PermissionConfig = z.object({
  edit: Permission.optional().default('allow'),
  bash: z.union([
    Permission,
    z.record(z.string(), Permission)
  ]).optional().default('allow'),
  skill: z.union([
    Permission,
    z.record(z.string(), Permission)
  ]).optional().default('allow'),
  mcp: z.union([
    Permission,
    z.record(z.string(), Permission)
  ]).optional().default('allow'),
  webfetch: Permission.optional().default('allow'),
  external_directory: Permission.optional().default('ask'),
});
export type PermissionConfig = z.infer<typeof PermissionConfig>;

// Tool configuration
export const ToolConfig = z.object({
  whitelist: z.array(z.string()).optional(),
  blacklist: z.array(z.string()).optional(),
  overrides: z.record(z.string(), z.boolean()).optional(),
});
export type ToolConfig = z.infer<typeof ToolConfig>;

// Base agent interface
export const AgentInfo = z.object({
  // Identity
  name: z.string(),
  description: z.string().optional(),

  // Mode
  mode: AgentMode.default('primary'),
  native: z.boolean().optional().default(false),
  hidden: z.boolean().optional().default(false),
  default: z.boolean().optional().default(false),

  // Model settings
  model: ModelConfig.optional(),
  temperature: z.number().min(0).max(2).optional(),
  topP: z.number().min(0).max(1).optional(),
  maxSteps: z.number().int().positive().optional(),

  // Behavior
  prompt: z.string().optional(),
  permission: PermissionConfig.optional(),
  tools: ToolConfig.optional(),

  // Metadata
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  options: z.record(z.string(), z.any()).optional(),
});
export type AgentInfo = z.infer<typeof AgentInfo>;
```

### Persona System (`src/agent/persona.ts`)

```typescript
import { z } from 'zod';
import { AgentInfo } from './agent';

// Soul layer - core values and personality
export const Soul = z.object({
  truths: z.array(z.string()),
  boundaries: z.array(z.string()),
  vibe: z.object({
    traits: z.array(z.string()),
    communication: z.string().optional(),
  }),
  directives: z.record(z.string(), z.string()).optional(),
});
export type Soul = z.infer<typeof Soul>;

// Identity layer - who the agent is
export const Identity = z.object({
  name: z.string(),
  creature: z.string().optional(),
  vibe: z.string().optional(),
  emoji: z.string().optional(),
  about: z.string().optional(),
  infrastructure: z.record(z.string(), z.string()).optional(),
  continuity: z.string().optional(),
});
export type Identity = z.infer<typeof Identity>;

// Persona definition - role-specific configuration
export const PersonaDefinition = z.object({
  // Frontmatter (markdown-style)
  name: z.string(),
  description: z.string(),
  mode: z.enum(['primary', 'subagent', 'all']).default('primary'),

  // Use case
  useCase: z.enum(['stanley', 'zee', 'johny', 'custom']).optional(), // legacy values omitted

  // Model preferences
  model: z.string().optional(), // format: provider/model
  temperature: z.number().optional(),
  topP: z.number().optional(),

  // Tool configuration
  tools: z.record(z.string(), z.boolean()).optional(),

  // Permission overrides
  permission: z.object({
    edit: z.enum(['allow', 'ask', 'deny']).optional(),
    bash: z.union([
      z.enum(['allow', 'ask', 'deny']),
      z.record(z.string(), z.enum(['allow', 'ask', 'deny']))
    ]).optional(),
  }).optional(),

  // System prompt (markdown content)
  prompt: z.string().optional(),

  // Inheritance
  extends: z.string().optional(),
});
export type PersonaDefinition = z.infer<typeof PersonaDefinition>;

// Persona loading configuration
export const PersonaConfig = z.object({
  // Identity files
  identityPath: z.string().optional(), // path to IDENTITY.md
  soulPath: z.string().optional(),      // path to SOUL.md

  // Persona directories
  personaDirs: z.array(z.string()).optional(),

  // Active persona
  activePersona: z.string().optional(),
});
export type PersonaConfig = z.infer<typeof PersonaConfig>;
```

### Permission Evaluation (`src/agent/permission.ts`)

```typescript
import { z } from 'zod';
import { Permission, PermissionConfig } from './agent';

// Permission request context
export const PermissionContext = z.object({
  type: z.enum(['edit', 'bash', 'skill', 'mcp', 'webfetch', 'external_directory']),
  pattern: z.union([z.string(), z.array(z.string())]).optional(),
  sessionID: z.string(),
  messageID: z.string(),
  callID: z.string().optional(),
  metadata: z.record(z.string(), z.any()).optional(),
});
export type PermissionContext = z.infer<typeof PermissionContext>;

// Permission evaluation result
export const PermissionResult = z.object({
  allowed: z.boolean(),
  requiresAsk: z.boolean(),
  matchedRule: z.string().optional(),
  reason: z.string().optional(),
});
export type PermissionResult = z.infer<typeof PermissionResult>;

/**
 * Permission evaluation functions
 */
export namespace PermissionEvaluator {

  /**
   * Evaluate permission for a given context
   */
  export function evaluate(
    config: PermissionConfig,
    context: PermissionContext
  ): PermissionResult {
    const { type, pattern } = context;

    // Get the permission rule for this type
    const rule = config[type as keyof PermissionConfig];

    if (rule === undefined) {
      return { allowed: true, requiresAsk: false };
    }

    // Simple permission value
    if (typeof rule === 'string') {
      return evaluateSimple(rule as Permission);
    }

    // Pattern-based permission (bash, skill, mcp)
    if (typeof rule === 'object' && pattern) {
      return evaluatePattern(rule, pattern);
    }

    return { allowed: true, requiresAsk: false };
  }

  function evaluateSimple(permission: Permission): PermissionResult {
    switch (permission) {
      case 'allow':
        return { allowed: true, requiresAsk: false };
      case 'ask':
        return { allowed: false, requiresAsk: true };
      case 'deny':
        return { allowed: false, requiresAsk: false, reason: 'Permission denied' };
    }
  }

  function evaluatePattern(
    rules: Record<string, Permission>,
    pattern: string | string[]
  ): PermissionResult {
    const patterns = Array.isArray(pattern) ? pattern : [pattern];

    for (const pat of patterns) {
      // Check exact match first
      if (rules[pat]) {
        return evaluateSimple(rules[pat]);
      }

      // Check wildcard patterns
      for (const [rulePattern, permission] of Object.entries(rules)) {
        if (wildcardMatch(pat, rulePattern)) {
          return { ...evaluateSimple(permission), matchedRule: rulePattern };
        }
      }
    }

    // Default to wildcard rule or allow
    const defaultRule = rules['*'];
    if (defaultRule) {
      return { ...evaluateSimple(defaultRule), matchedRule: '*' };
    }

    return { allowed: true, requiresAsk: false };
  }

  function wildcardMatch(value: string, pattern: string): boolean {
    if (pattern === '*') return true;
    if (pattern.endsWith('*')) {
      return value.startsWith(pattern.slice(0, -1));
    }
    return value === pattern;
  }

  /**
   * Merge permission configurations (override takes precedence)
   */
  export function merge(
    base: PermissionConfig,
    override: Partial<PermissionConfig>
  ): PermissionConfig {
    const result: PermissionConfig = { ...base };

    for (const [key, value] of Object.entries(override)) {
      if (value === undefined) continue;

      const baseValue = base[key as keyof PermissionConfig];

      // If both are objects, deep merge
      if (typeof baseValue === 'object' && typeof value === 'object') {
        result[key as keyof PermissionConfig] = {
          ...baseValue,
          ...value
        } as any;
      } else {
        result[key as keyof PermissionConfig] = value as any;
      }
    }

    return result;
  }
}
```

## Persona Sources

Personas are defined in `.agents/skills/` and loaded at runtime. The core repo does not ship built-in development agents; add or override personas per project under `.zee/agent/` or in user config at `~/.config/zee/agent/`.

## Configuration Files

### zee.jsonc

```json
{
  "persona": {
    "default": "zee/assistant",
    "identityPath": "~/.config/zee/IDENTITY.md",
    "soulPath": "~/.config/zee/SOUL.md",
    "personaDirs": [
      ".zee/agent",
      "~/.config/zee/agent"
    ]
  },
  "agent": {
    "stanley/analyst": {
      "model": "anthropic/claude-sonnet-4",
      "temperature": 0.3
    }
  }
}
```

## Security Considerations

1. **Permission Isolation**: Each persona has explicit permission boundaries
2. **Tool Restrictions**: Personas can blacklist dangerous tools
3. **Audit Trail**: All persona switches logged
4. **Identity Protection**: Soul.md privacy directives enforced
5. **External Access**: `external_directory` permission controls scope

## Migration Path

### From legacy modes

1. Existing `mode/*.md` files map to personas
2. `agent/*.md` files become custom personas
3. Permission config preserved
4. Tool config preserved

### From Zee

1. IDENTITY.md and SOUL.md become identity layer
2. Existing prompts become persona prompts
3. Memory integration preserved

---

*Document Version: 1.0*
*Created: 2026-01-04*
*Author: System Architecture Designer*
