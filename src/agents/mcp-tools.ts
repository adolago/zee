/**
 * MCP-compatible tools for zee.
 * This excludes tools that depend on pi-* packages (like image-tool).
 */
import type { ZeeConfig } from "../config/config.js";
import { createAgentsListTool } from "./tools/agents-list-tool.js";
import { createBrowserTool } from "./tools/browser-tool.js";
import { createCanvasTool } from "./tools/canvas-tool.js";
import type { AnyAgentTool } from "./tools/common.js";
import { createCronTool } from "./tools/cron-tool.js";
import { createDiscordTool } from "./tools/discord-tool.js";
import { createGatewayTool } from "./tools/gateway-tool.js";
import { createNodesTool } from "./tools/nodes-tool.js";
import { createSessionsHistoryTool } from "./tools/sessions-history-tool.js";
import { createSessionsListTool } from "./tools/sessions-list-tool.js";
import { createSessionsSendTool } from "./tools/sessions-send-tool.js";
import { createSessionsSpawnTool } from "./tools/sessions-spawn-tool.js";
import { createSlackTool } from "./tools/slack-tool.js";
import { createTelegramTool } from "./tools/telegram-tool.js";
import { createWhatsAppTool } from "./tools/whatsapp-tool.js";

/**
 * Creates zee tools that are MCP-compatible (no pi-* dependencies).
 * Excludes: image-tool (requires pi-ai for vision LLM calls)
 */
export function createMcpCompatibleTools(options?: {
  browserControlUrl?: string;
  agentSessionKey?: string;
  agentProvider?: string;
  agentAccountId?: string;
  agentDir?: string;
  sandboxed?: boolean;
  config?: ZeeConfig;
}): AnyAgentTool[] {
  return [
    createBrowserTool({ defaultControlUrl: options?.browserControlUrl }),
    createCanvasTool(),
    createNodesTool(),
    createCronTool(),
    createDiscordTool(),
    createSlackTool({
      agentAccountId: options?.agentAccountId,
      config: options?.config,
    }),
    createTelegramTool(),
    createWhatsAppTool(),
    createGatewayTool({ agentSessionKey: options?.agentSessionKey }),
    createAgentsListTool({ agentSessionKey: options?.agentSessionKey }),
    createSessionsListTool({
      agentSessionKey: options?.agentSessionKey,
      sandboxed: options?.sandboxed,
    }),
    createSessionsHistoryTool({
      agentSessionKey: options?.agentSessionKey,
      sandboxed: options?.sandboxed,
    }),
    createSessionsSendTool({
      agentSessionKey: options?.agentSessionKey,
      sandboxed: options?.sandboxed,
    }),
    createSessionsSpawnTool({
      agentSessionKey: options?.agentSessionKey,
      sandboxed: options?.sandboxed,
    }),
    // Note: image-tool excluded as it requires pi-ai for vision LLM
  ];
}
