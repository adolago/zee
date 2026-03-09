/**
 * Built-in Assistants
 *
 * Single-assistant runtime: Zee is the only active assistant.
 * Tool namespaces remain (`zee:*`, `zee:invest-*`, `zee:learn-*`) and load under Zee.
 */

import type { AssistantProfile, AgentConfig, AssistantTheme } from "./types";
import type { AssistantProfileConfig } from "../config/types";
import { assistantPalettes } from "../theme/rosetta";
import { assistantModels } from "./model-rosetta";

export const ZEE_THEME: AssistantTheme = {
  primaryColor: assistantPalettes.zee.primary.hex,
  accentColor: assistantPalettes.zee.accent.hex,
  borderColor: `rgba(${assistantPalettes.zee.primary.rgb.join(", ")}, 0.45)`,
  bgGradient: `linear-gradient(135deg, rgba(${assistantPalettes.zee.primary.rgb.join(", ")}, 0.16) 0%, rgba(${assistantPalettes.zee.primary.rgb.join(", ")}, 0.08) 100%)`,
};

export const ZEE_ASSISTANT: AssistantProfile = {
  id: "zee",
  displayName: "Zee",
  description: "Personal assistant for professional and personal intersection",
  avatar: "Z",
  icon: "Z",
  theme: ZEE_THEME,
  defaultSession: "zee-personal",
  personality: [
    "Friendly and approachable",
    "Helpful without being intrusive",
    "Adapts communication style to context",
    "Remembers important details about conversations",
    "Balances professionalism with warmth",
  ],
  greeting: "Hey! I'm Zee, your assistant. What can I help you with?",
  signature: "- Zee",
};

export const ZEE_AGENT_CONFIG: AgentConfig = {
  name: "zee",
  description: "Chief of Staff - Professional/Personal intersection. Powered by Zee gateway.",
  mode: "primary",
  native: true,
  default: true,
  model: assistantModels.zee,
  temperature: 0.7,
  topP: 0.95,
  modelParams: {
    opus: { temperature: 0.7 },
    "gpt-5": null,
    "gemini-3": { temperature: 0.9, topP: 0.95, topK: 40 },
    "grok-4": { temperature: 0.7 },
    "kimi-k2.5-thinking": { temperature: 1.0, topP: 0.95 },
    "kimi-k2": { temperature: 0.6, topP: 0.95 },
    "glm-4.7": { temperature: 1.0 },
    "minimax-m2": { temperature: 1.0, topP: 0.95, topK: 40 },
    qwen3: { temperature: 0.6, topP: 1.0 },
  },
  color: assistantPalettes.zee.accent.hex,
  permission: {
    edit: "allow",
    bash: {
      "git:*": "allow",
      "*": "ask",
    },
    skill: {
      "*": "allow",
    },
    webfetch: "allow",
    externalDirectory: "deny",
  },
  // PermissionNext.Ruleset format - used directly by agent bootstrap
  permissionRuleset: [
    { permission: "edit", pattern: "*", action: "allow" },
    { permission: "bash", pattern: "git:*", action: "allow" },
    { permission: "bash", pattern: "*", action: "ask" },
    { permission: "skill", pattern: "*", action: "allow" },
    { permission: "webfetch", pattern: "*", action: "allow" },
    { permission: "external_directory", pattern: "*", action: "deny" },
  ],
  tools: {
    bash: true,
    read: true,
    write: true,
    edit: true,
    glob: true,
    grep: true,
    webfetch: true,
    websearch: true,
    task: true,
    skill: true,
    "zee:memory-store": true,
    "zee:memory-query": true,
    "zee:messaging": true,
    "zee:calendar": true,
    "zee:splitwise": true,
    "zee:codexbar": true,
    "zee:invest-market-data": true,
    "zee:invest-portfolio": true,
    "zee:invest-research": true,
    "zee:invest-sec-filings": true,
    "zee:invest-nautilus": true,
    "zee:invest-estimates": true,
    "zee:invest-insider-trades": true,
    "zee:invest-segments": true,
    "zee:invest-scratchpad": true,
    "zee:invest-status": true,
    "zee:learn-study": true,
    "zee:learn-knowledge": true,
    "zee:learn-mastery": true,
    "zee:learn-review": true,
    "zee:learn-practice": true,
  },
  options: {},
  maxSteps: 50,
};

export const ZEE_ASSISTANT_CONFIG: AssistantProfileConfig = {
  ...ZEE_ASSISTANT,
  defaultAgent: "zee",
  surfaces: ["cli", "web", "api", "whatsapp"],
  identityFiles: ["~/.config/zee/IDENTITY.md", "~/.config/zee/SOUL.md"],
  systemPromptAdditions: `
You are Zee, a unified personal assistant handling life admin, investing, and learning.

## Capabilities
- Long-term memory: store and recall information across conversations
- Messaging: WhatsApp coordination
- Email: compose, search, organize via neomutt/notmuch
- Calendar: scheduling, reminders via khal
- Contacts: lookup and management via khard
- Expenses: shared expense tracking via Splitwise
- Usage: API usage monitoring via CodexBar
- Investing: market data (zee:invest-*), portfolio, SEC filings, NautilusTrader
- Learning: knowledge graph (zee:learn-*), mastery tracking, spaced repetition, deliberate practice

## Approach
- Proactive: surface relevant information without being asked
- Context-aware: adapt tone to platform (casual on messaging, formal in email)
- Privacy-first: never share personal information externally
- Efficient: minimize friction in daily tasks

## Response Format
- Messaging platforms: keep responses concise (1-3 sentences when possible)
- Email/formal: use proper structure with greeting and sign-off
- Technical queries: use markdown formatting

## Style
- Friendly but professional
- No emojis in any output
- Remember and reference previous conversations
- Offer follow-up reminders when appropriate
`,
  knowledge: [
    "~/.config/zee/IDENTITY.md",
    "~/.config/zee/SOUL.md",
  ],
  mcpServers: ["calendar", "kernel"],
};

export const ASSISTANTS = {
  zee: ZEE_ASSISTANT_CONFIG,
};

export const AGENT_CONFIGS = {
  zee: ZEE_AGENT_CONFIG,
};

export function getAssistant(id: string): AssistantProfileConfig | undefined {
  return ASSISTANTS[id as keyof typeof ASSISTANTS];
}

export function getAgentConfig(name: string): AgentConfig | undefined {
  return AGENT_CONFIGS[name as keyof typeof AGENT_CONFIGS];
}

export function listAssistants(): AssistantProfileConfig[] {
  return Object.values(ASSISTANTS);
}
