/**
 * @file Config Collector
 * @description Collects sanitized configuration for crash reports
 */

import * as fs from "fs/promises";
import * as path from "path";
import { PrivacyRedactor } from "../privacy/redactor";
import type { ConfigSummary } from "../types";
import { resolveConfigDir } from "../../global/dirs";

function getConfigDir(): string {
  return resolveConfigDir();
}

/**
 * Collect sanitized configuration summary
 */
export async function collectConfig(redactor: PrivacyRedactor): Promise<ConfigSummary> {
  const configPath = path.join(getConfigDir(), "agent-core.json");

  try {
    const content = await fs.readFile(configPath, "utf-8");
    const config = JSON.parse(content) as Record<string, unknown>;

    return {
      providers: extractProviderNames(config),
      features: extractFeatures(config),
      theme: extractTheme(config),
      customKeybinds: countKeybinds(config),
      mcpServerCount: countMCPServers(config),
      skills: extractSkills(config),
    };
  } catch {
    return {
      providers: [],
      features: [],
      theme: "default",
      customKeybinds: 0,
      mcpServerCount: 0,
      skills: [],
    };
  }
}

function extractProviderNames(config: Record<string, unknown>): string[] {
  const providers: string[] = [];

  // Check env vars for configured providers
  if (process.env.ANTHROPIC_API_KEY) providers.push("anthropic");
  if (process.env.OPENAI_API_KEY) providers.push("openai");
  if (process.env.GOOGLE_API_KEY) providers.push("gemini");

  // Check config for provider settings
  const providerConfig = config.provider as Record<string, unknown> | undefined;
  if (providerConfig?.model) {
    const model = String(providerConfig.model);
    if (model.includes("claude")) providers.push("anthropic");
    if (model.includes("gpt")) providers.push("openai");
    if (model.includes("gemini")) providers.push("gemini");
  }

  return [...new Set(providers)];
}

function extractFeatures(config: Record<string, unknown>): string[] {
  const features: string[] = [];

  const feat = config.features as Record<string, boolean> | undefined;
  if (feat) {
    for (const [name, enabled] of Object.entries(feat)) {
      if (enabled) features.push(name);
    }
  }

  return features;
}

function extractTheme(config: Record<string, unknown>): string {
  const ui = config.ui as Record<string, unknown> | undefined;
  return String(ui?.theme || config.theme || "default");
}

function countKeybinds(config: Record<string, unknown>): number {
  const keybinds = config.keybinds as Record<string, unknown> | undefined;
  return keybinds ? Object.keys(keybinds).length : 0;
}

function countMCPServers(config: Record<string, unknown>): number {
  const mcpServers = config.mcpServers as Record<string, unknown> | undefined;
  return mcpServers ? Object.keys(mcpServers).length : 0;
}

function extractSkills(config: Record<string, unknown>): string[] {
  const skills = config.skills as string[] | undefined;
  return skills || [];
}
