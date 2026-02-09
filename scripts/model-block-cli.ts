#!/usr/bin/env bun
/**
 * Model Block List CLI
 * 
 * Manage the model and provider block list with a deny-list approach.
 * All models are allowed by default; this tool only manages what to hide.
 * 
 * Usage:
 *   bun run scripts/model-block-cli.ts [command] [options]
 * 
 * Commands:
 *   list              List all blocked providers and models
 *   add-model         Add a model to the block list
 *   remove-model      Remove a model from the block list
 *   add-provider      Add a provider to the block list
 *   remove-provider   Remove a provider from the block list
 *   check             Check if a model/provider is blocked
 *   apply             Apply block list to active config
 *   validate          Validate block list syntax
 * 
 * Examples:
 *   bun run scripts/model-block-cli.ts list
 *   bun run scripts/model-block-cli.ts add-model openai gpt-4o
 *   bun run scripts/model-block-cli.ts add-provider xai
 *   bun run scripts/model-block-cli.ts remove-model openai gpt-4o
 */

import { readFile, writeFile, exists } from "fs/promises";
import { join, resolve } from "path";
import { homedir } from "os";

// ============================================================================
// Types
// ============================================================================

interface BlockList {
  blocked_providers: string[];
  blocked_models: Record<string, string[]>;
  blocked_capabilities?: {
    experimental?: boolean;
    alpha?: boolean;
    beta?: boolean;
    deprecated?: boolean;
  };
  blocked_agents?: string[];
  _meta?: {
    version: string;
    created: string;
    description: string;
    principle: string;
  };
}

interface Config {
  disabled_providers?: string[];
  provider?: Record<string, { blacklist?: string[]; whitelist?: string[] }>;
}

// ============================================================================
// Constants
// ============================================================================

const BLOCK_LIST_PATHS = [
  resolve(".zee/model-block-list.jsonc"),
  join(homedir(), ".config/agent-core/model-block-list.jsonc"),
  join(homedir(), ".zee/model-block-list.jsonc"),
];

const CONFIG_PATHS = [
  resolve("zee.jsonc"),
  join(homedir(), ".config/agent-core/zee.jsonc"),
  join(homedir(), ".zee/zee.jsonc"),
];

const DEFAULT_BLOCK_LIST: BlockList = {
  blocked_providers: [],
  blocked_models: {},
  blocked_capabilities: {},
  blocked_agents: [],
  _meta: {
    version: "1.0.0",
    created: new Date().toISOString().split("T")[0],
    description: "Block list for deprecated and unwanted models",
    principle: "Deny-list approach: all models allowed except blocked",
  },
};

// ============================================================================
// Utility Functions
// ============================================================================

function stripJsonComments(json: string): string {
  return json
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
}

async function findBlockList(): Promise<{ path: string; data: BlockList } | null> {
  for (const path of BLOCK_LIST_PATHS) {
    if (await exists(path)) {
      const content = await readFile(path, "utf-8");
      const data = JSON.parse(stripJsonComments(content));
      return { path, data };
    }
  }
  return null;
}

async function findConfig(): Promise<{ path: string; data: Config } | null> {
  for (const path of CONFIG_PATHS) {
    if (await exists(path)) {
      const content = await readFile(path, "utf-8");
      const data = JSON.parse(stripJsonComments(content));
      return { path, data };
    }
  }
  return null;
}

async function saveBlockList(path: string, data: BlockList): Promise<void> {
  const content = JSON.stringify(data, null, 2);
  await writeFile(path, content, "utf-8");
}

async function saveConfig(path: string, data: Config): Promise<void> {
  const content = JSON.stringify(data, null, 2);
  await writeFile(path, content, "utf-8");
}

function formatList(items: string[]): string {
  if (items.length === 0) return "  (none)";
  return items.map(item => `  - ${item}`).join("\n");
}

function formatModelList(models: Record<string, string[]>): string {
  const entries = Object.entries(models).filter(([_, models]) => models.length > 0);
  if (entries.length === 0) return "  (none)";
  
  return entries
    .map(([provider, models]) => `  ${provider}:\n${models.map(m => `    - ${m}`).join("\n")}`)
    .join("\n");
}

// ============================================================================
// Commands
// ============================================================================

async function cmdList(): Promise<void> {
  const blockList = await findBlockList();
  
  if (!blockList) {
    console.log("No block list found. Creating default...");
    const path = BLOCK_LIST_PATHS[0];
    await saveBlockList(path, DEFAULT_BLOCK_LIST);
    console.log(`Created: ${path}`);
    return;
  }
  
  const { data } = blockList;
  
  console.log("=".repeat(60));
  console.log("MODEL BLOCK LIST");
  console.log("=".repeat(60));
  console.log();
  
  console.log("Blocked Providers:");
  console.log(formatList(data.blocked_providers));
  console.log();
  
  console.log("Blocked Models:");
  console.log(formatModelList(data.blocked_models));
  console.log();
  
  if (data.blocked_agents && data.blocked_agents.length > 0) {
    console.log("Blocked Agents:");
    console.log(formatList(data.blocked_agents));
    console.log();
  }
  
  if (data._meta) {
    console.log("Metadata:");
    console.log(`  Version: ${data._meta.version}`);
    console.log(`  Created: ${data._meta.created}`);
    console.log(`  Principle: ${data._meta.principle}`);
  }
  
  console.log();
  console.log(`Source: ${blockList.path}`);
}

async function cmdAddModel(provider: string, model: string): Promise<void> {
  const blockList = await findBlockList();
  const path = blockList?.path || BLOCK_LIST_PATHS[0];
  const data = blockList?.data || DEFAULT_BLOCK_LIST;
  
  if (!data.blocked_models[provider]) {
    data.blocked_models[provider] = [];
  }
  
  if (data.blocked_models[provider].includes(model)) {
    console.log(`Model already blocked: ${provider}/${model}`);
    return;
  }
  
  data.blocked_models[provider].push(model);
  await saveBlockList(path, data);
  
  console.log(`Added to block list: ${provider}/${model}`);
  console.log(`Updated: ${path}`);
}

async function cmdRemoveModel(provider: string, model: string): Promise<void> {
  const blockList = await findBlockList();
  
  if (!blockList) {
    console.log("No block list found.");
    return;
  }
  
  const { path, data } = blockList;
  
  if (!data.blocked_models[provider]?.includes(model)) {
    console.log(`Model not in block list: ${provider}/${model}`);
    return;
  }
  
  data.blocked_models[provider] = data.blocked_models[provider].filter(m => m !== model);
  
  // Clean up empty provider entries
  if (data.blocked_models[provider].length === 0) {
    delete data.blocked_models[provider];
  }
  
  await saveBlockList(path, data);
  
  console.log(`Removed from block list: ${provider}/${model}`);
  console.log(`Updated: ${path}`);
}

async function cmdAddProvider(provider: string): Promise<void> {
  const blockList = await findBlockList();
  const path = blockList?.path || BLOCK_LIST_PATHS[0];
  const data = blockList?.data || DEFAULT_BLOCK_LIST;
  
  if (data.blocked_providers.includes(provider)) {
    console.log(`Provider already blocked: ${provider}`);
    return;
  }
  
  data.blocked_providers.push(provider);
  await saveBlockList(path, data);
  
  console.log(`Added to block list: ${provider}`);
  console.log(`Updated: ${path}`);
}

async function cmdRemoveProvider(provider: string): Promise<void> {
  const blockList = await findBlockList();
  
  if (!blockList) {
    console.log("No block list found.");
    return;
  }
  
  const { path, data } = blockList;
  
  if (!data.blocked_providers.includes(provider)) {
    console.log(`Provider not in block list: ${provider}`);
    return;
  }
  
  data.blocked_providers = data.blocked_providers.filter(p => p !== provider);
  await saveBlockList(path, data);
  
  console.log(`Removed from block list: ${provider}`);
  console.log(`Updated: ${path}`);
}

async function cmdCheck(target: string): Promise<void> {
  const blockList = await findBlockList();
  
  if (!blockList) {
    console.log("No block list found.");
    return;
  }
  
  const { data } = blockList;
  
  // Check if provider is blocked
  if (data.blocked_providers.includes(target)) {
    console.log(`Provider '${target}' is BLOCKED`);
    return;
  }
  
  // Check if model is blocked (format: provider/model)
  if (target.includes("/")) {
    const [provider, model] = target.split("/");
    if (data.blocked_models[provider]?.includes(model)) {
      console.log(`Model '${target}' is BLOCKED`);
      return;
    }
  }
  
  // Check all models for provider
  const providerModels = data.blocked_models[target];
  if (providerModels && providerModels.length > 0) {
    console.log(`Provider '${target}' is NOT blocked, but has blocked models:`);
    console.log(formatList(providerModels));
    return;
  }
  
  console.log(`'${target}' is NOT blocked`);
}

async function cmdApply(): Promise<void> {
  const blockListResult = await findBlockList();
  const configResult = await findConfig();
  
  if (!blockListResult) {
    console.log("No block list found. Create one first with 'list' command.");
    return;
  }
  
  const { data: blockList } = blockListResult;
  const configPath = configResult?.path || CONFIG_PATHS[0];
  const config = configResult?.data || {};
  
  // Apply blocked providers
  if (blockList.blocked_providers.length > 0) {
    config.disabled_providers = [
      ...(config.disabled_providers || []),
      ...blockList.blocked_providers,
    ];
    // Deduplicate
    config.disabled_providers = [...new Set(config.disabled_providers)];
  }
  
  // Apply blocked models
  if (!config.provider) {
    config.provider = {};
  }
  
  for (const [provider, models] of Object.entries(blockList.blocked_models)) {
    if (models.length === 0) continue;
    
    if (!config.provider[provider]) {
      config.provider[provider] = {};
    }
    
    const existing = config.provider[provider].blacklist || [];
    config.provider[provider].blacklist = [
      ...existing,
      ...models,
    ];
    // Deduplicate
    config.provider[provider].blacklist = [...new Set(config.provider[provider].blacklist)];
  }
  
  await saveConfig(configPath, config);
  
  console.log("Block list applied to config.");
  console.log(`Updated: ${configPath}`);
  console.log();
  console.log("Summary:");
  console.log(`  Disabled providers: ${blockList.blocked_providers.length}`);
  console.log(`  Blacklisted models: ${Object.values(blockList.blocked_models).flat().length}`);
}

async function cmdValidate(): Promise<void> {
  const blockList = await findBlockList();
  
  if (!blockList) {
    console.log("No block list found.");
    process.exit(1);
  }
  
  const { path, data } = blockList;
  
  // Basic validation
  const errors: string[] = [];
  
  if (!Array.isArray(data.blocked_providers)) {
    errors.push("blocked_providers must be an array");
  }
  
  if (typeof data.blocked_models !== "object" || Array.isArray(data.blocked_models)) {
    errors.push("blocked_models must be an object");
  }
  
  for (const [provider, models] of Object.entries(data.blocked_models)) {
    if (!Array.isArray(models)) {
      errors.push(`blocked_models.${provider} must be an array`);
    }
  }
  
  if (errors.length > 0) {
    console.log("Validation FAILED:");
    errors.forEach(e => console.log(`  - ${e}`));
    process.exit(1);
  }
  
  console.log("Validation PASSED");
  console.log(`Source: ${path}`);
}

async function cmdInteractive(): Promise<void> {
  console.log("Model Block List Manager - Interactive Mode");
  console.log("=".repeat(50));
  console.log();
  console.log("Current status:");
  await cmdList();
}

// ============================================================================
// Main
// ============================================================================

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0];
  
  if (!command || command === "--help" || command === "-h") {
    console.log(`
Model Block List CLI

Manage the model and provider block list with a deny-list approach.
All models are allowed by default; this tool only manages what to hide.

Usage:
  bun run scripts/model-block-cli.ts [command] [options]

Commands:
  list                          List all blocked providers and models
  add-model <provider> <model>  Add a model to the block list
  remove-model <provider> <model>  Remove a model from the block list
  add-provider <provider>       Add a provider to the block list
  remove-provider <provider>    Remove a provider from the block list
  check <provider|model>        Check if a provider/model is blocked
  apply                         Apply block list to active config
  validate                      Validate block list syntax
  interactive                   Interactive mode

Examples:
  bun run scripts/model-block-cli.ts list
  bun run scripts/model-block-cli.ts add-model openai gpt-4o
  bun run scripts/model-block-cli.ts add-provider xai
  bun run scripts/model-block-cli.ts check openai/gpt-4o
  bun run scripts/model-block-cli.ts apply

Block List Locations (in order of priority):
  1. ./.zee/model-block-list.jsonc
  2. ~/.config/zee/model-block-list.jsonc
  3. ~/.zee/model-block-list.jsonc
`);
    return;
  }
  
  try {
    switch (command) {
      case "list":
        await cmdList();
        break;
        
      case "add-model":
        if (args.length < 3) {
          console.error("Usage: add-model <provider> <model>");
          process.exit(1);
        }
        await cmdAddModel(args[1], args[2]);
        break;
        
      case "remove-model":
        if (args.length < 3) {
          console.error("Usage: remove-model <provider> <model>");
          process.exit(1);
        }
        await cmdRemoveModel(args[1], args[2]);
        break;
        
      case "add-provider":
        if (args.length < 2) {
          console.error("Usage: add-provider <provider>");
          process.exit(1);
        }
        await cmdAddProvider(args[1]);
        break;
        
      case "remove-provider":
        if (args.length < 2) {
          console.error("Usage: remove-provider <provider>");
          process.exit(1);
        }
        await cmdRemoveProvider(args[1]);
        break;
        
      case "check":
        if (args.length < 2) {
          console.error("Usage: check <provider|model>");
          process.exit(1);
        }
        await cmdCheck(args[1]);
        break;
        
      case "apply":
        await cmdApply();
        break;
        
      case "validate":
        await cmdValidate();
        break;
        
      case "interactive":
        await cmdInteractive();
        break;
        
      default:
        console.error(`Unknown command: ${command}`);
        console.error("Run with --help for usage information.");
        process.exit(1);
    }
  } catch (error) {
    console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}

main();
